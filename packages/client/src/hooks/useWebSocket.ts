import { useEffect, useRef, useCallback, useState } from 'react';
import type { WSMessage, GraphSnapshot, GraphSnapshotWire, SubAgentStreamEvent, ProjectHydratedPayload, ProjectUnloadedPayload, IframeLogInitPayload, IframeLogAppendPayload, ServerLogInitPayload, ServerLogAppendPayload, PermissionRequest, PermissionDecision, ClaudeInstallProgress, AskUserQuestionRequest, AskUserQuestionDecision } from '@vibisual/shared';
import { applyKeyedSliceDelta, MAX_RECONNECT_ATTEMPTS, RECONNECT_BASE_DELAY, WS_BATCH_INTERVAL, WS_STREAM_BATCH_INTERVAL, WS_BATCH_INTERVAL_MAX, WS_BATCH_BACKOFF_FACTOR } from '@vibisual/shared';
import { useGraphStore } from '../stores/graphStore.js';
import { iframeLogEvents } from '../bubble-map/api/iframeLogEvents.js';
import { serverLogEvents } from '../bubble-map/api/serverLogEvents.js';
import { setDiagnosticsSender } from '../utils/diagnostics.js';
import { registerTerminalWsSender, dispatchTerminalFrame } from '../transport/mobileTerminalBridge.js';
import i18n from '../i18n/index.js';
import {
  playCompletionChime,
  showBrowserNotification,
  requestNotificationPermission,
  claimCompletionChime,
} from '../utils/notification.js';
import { detectCustomAgentCompletions } from '../utils/completionChime.js';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface UseWebSocketReturn {
  status: ConnectionStatus;
  send: (message: WSMessage) => void;
}

function isWSMessage(data: unknown): data is WSMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    'timestamp' in data
  );
}

function isGraphSnapshot(data: unknown): data is GraphSnapshotWire {
  return (
    typeof data === 'object' &&
    data !== null &&
    'agents' in data &&
    'topFolders' in data &&
    Array.isArray((data as GraphSnapshot).agents) &&
    Array.isArray((data as GraphSnapshot).topFolders)
  );
}

export function useWebSocket(url: string): UseWebSocketReturn {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // graph_snapshot 코얼레스 — 버스트 시 마지막 스냅샷만 적용 (16ms 트레일링).
  const snapshotPendingRef = useRef<GraphSnapshotWire | null>(null);
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // §9 v3.40 — 부하 적응형 배치 창. loadSnapshot 풀 재구축이 16ms 예산을 넘기면
  // 다음 flush 창을 직전 실측 비용 × 배수로 늘려(상한 250ms) 렌더/입력이 굶지 않게 한다.
  // 비용이 낮아지면 즉시 기본 주기 복귀 — 경부하 체감 불변.
  const snapshotDelayRef = useRef(WS_BATCH_INTERVAL);
  // §9 — sub_agent_stream 배치 — 도착분을 16ms 창에 모았다가 store action 1회로 합쳐 적용.
  // 커스텀 에이전트 다중 실행 시 매 스트림 라인마다 구독자 전원 재평가하던 것을 16ms당 1회로.
  const streamPendingRef = useRef<SubAgentStreamEvent[]>([]);
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // §9 v3.40 — 스트림 반영도 동일 적응(기본 50ms, 상한 250ms). 배수는 3 — 스트림 텍스트는
  // 지연에 더 민감해 스냅샷(×4)보다 완만하게 늘린다.
  const streamDelayRef = useRef(WS_STREAM_BATCH_INTERVAL);

  /**
   * §9 v3.89 — 증분으로 온 키맵 슬라이스를 복원하기 위한 **최신 전체 맵**(수신 시점 기준).
   *
   * `fileEdits`·`bashHistory` 는 diff/명령 출력 원문이라 스냅샷 부피의 78% 를 차지하면서도 대부분
   * 그대로다. 서버는 바뀐 키만 실어 보내고, 여기서 이전 값 위에 얹어 종전과 **똑같은 전체 맵**으로
   * 되돌린다(스토어·컴포넌트는 이 최적화를 모른다).
   *
   * ⚠ **합치는 시점이 중요하다** — 아래 스냅샷 코얼레스는 창 안에서 마지막 1건만 적용하고 나머지를
   * 버린다. 증분은 누적이라 버려진 메시지의 변경분은 영영 사라진다. 그래서 합성은 flush 가 아니라
   * **메시지가 도착할 때마다** 한다(비용은 얕은 복사 1회).
   */
  const keyedShadowRef = useRef<{
    fileEdits: NonNullable<GraphSnapshotWire['fileEdits']>;
    bashHistory: NonNullable<GraphSnapshotWire['bashHistory']>;
  }>({ fileEdits: {}, bashHistory: {} });

  /** 전선에서 온 스냅샷 → 증분을 푼 완전한 스냅샷(이후 경로는 종전과 동일). */
  const materializeSnapshot = useCallback((wire: GraphSnapshotWire): GraphSnapshotWire => {
    const shadow = keyedShadowRef.current;
    shadow.fileEdits = wire.deltas?.fileEdits
      ? applyKeyedSliceDelta(shadow.fileEdits, wire.deltas.fileEdits)
      : (wire.fileEdits ?? {});
    shadow.bashHistory = wire.deltas?.bashHistory
      ? applyKeyedSliceDelta(shadow.bashHistory, wire.deltas.bashHistory)
      : (wire.bashHistory ?? {});
    if (!wire.deltas) return wire;
    const full: GraphSnapshotWire = { ...wire, fileEdits: shadow.fileEdits, bashHistory: shadow.bashHistory };
    delete full.deltas;
    return full;
  }, []);

  const applyGraphSnapshot = useCallback((snap: GraphSnapshotWire) => {
    // [perf-snapshot] 계측 — 콘솔에서 `__VIBI_PERF__ = true` 로 켠다(기본 off, 프로덕션 비용 0).
    // loadSnapshot(그래프 전체 재구축) vs 이후 apply*(~22개 슬라이스 set) 중 어디가 무거운지 분리 측정.
    const PERF = !!(globalThis as unknown as { __VIBI_PERF__?: boolean }).__VIBI_PERF__;
    const _t0 = PERF ? performance.now() : 0;
    const store = useGraphStore.getState();
    store.loadSnapshot(
      snap.projects ?? {},
      snap.agents,
      snap.topFolders,
      snap.children,
      snap.edges,
      snap.innerEdges,
      snap.satellites,
      snap.bashHistory ?? {},
      snap.runningServers ?? {},
      snap.agentEvents ?? {},
      snap.agentProjects ?? {},
      snap.nodeProjects ?? {},
      snap.fileEdits ?? {},
      snap.commandQueues ?? {},
      snap.completedCommands ?? {},
      snap.subAgents ?? {},
      snap.agentPhase ?? 'waiting',
      snap.activeAgentCount ?? 0,
      snap.satellitePositions ?? {},
      snap.pipelineChildren ?? {},
      snap.pipelines ?? {},
      snap.agentConfigs ?? {},
      snap.taskEdges ?? {},
      snap.worktreeProjects ?? {},
      snap.gitDirty ?? {},
      snap.commentBoxes ?? [],
      snap.captureBubbles ?? [],
      snap.contis ?? {},
      snap.activeContiWork ?? {},
      snap.brain ?? {},
      snap.brainInjections ?? {},
    );
    const _tLoad = PERF ? performance.now() : 0;
    store.applyStubProjects(snap.stubProjects ?? {});
    store.applyAppState(snap.appState);
    if (snap.uiLocale) store.applyUiLocale(snap.uiLocale);
    store.applyLayoutBoundsByProject(snap.layoutBoundsByProject);
    store.applyV150Metrics(snap.recentToolDurations, snap.compactCounts, snap.rateLimits, snap.claudeUsage);
    store.applySkillUsageCounts(snap.skillUsageCounts);
    store.applyAutoAgentSummaries(snap.autoAgentSummaries);
    store.applyRunningSubagentTasks(snap.runningSubagentTasks);
    store.applyAgentReports(snap.agentReports);
    store.applyAgentQuestions(snap.agentQuestions);
    store.applyAgentReviews(snap.agentReviews);
    store.applyAgentLists(snap.agentLists);
    store.applyAgentFeedbacks(snap.agentFeedbacks);
    store.applySessionLoops(snap.sessionLoops);
    store.applyDiagnosticLog(snap.diagnosticLog);
    store.applyModelRegistry(snap.modelRegistry);
    store.applyUserDefaults(snap.userDefaults);
    if (PERF) {
      const _t1 = performance.now();
      const subs = snap.subAgents ? Object.keys(snap.subAgents).length : 0;
      // eslint-disable-next-line no-console
      console.warn(
        `[perf-snapshot] applyGraphSnapshot total=${(_t1 - _t0).toFixed(1)}ms ` +
        `loadSnapshot=${(_tLoad - _t0).toFixed(1)}ms apply*=${(_t1 - _tLoad).toFixed(1)}ms subAgents=${subs}`,
      );
    }
  }, []);

  const flushSnapshot = useCallback(() => {
    snapshotTimerRef.current = null;
    const snap = snapshotPendingRef.current;
    snapshotPendingRef.current = null;
    if (!snap) return;
    const t0 = performance.now();
    applyGraphSnapshot(snap);
    // v3.76 — 완료음·완료 알림의 유일한 발화 지점. 사용자가 만든 커스텀 에이전트가 이번 스냅샷에서
    // completed 로 넘어온 건만 울린다(서버가 서브에이전트 대차대조까지 반영해 매긴 상태라, 배경
    // 서브가 남아 있는 동안에는 넘어오지 않는다).
    // §5.5 #17-11 ⑦ v3.84 — 세션 루프가 도는 동안에는 회차마다 오는 완료 전이를 침묵시키고
    // 루프 묶음이 끝날 때 한 번만 울리므로, 판정에 스냅샷의 `sessionLoops` 를 함께 넘긴다.
    for (const finished of detectCustomAgentCompletions(snap.agents, snap.sessionLoops)) {
      if (!claimCompletionChime()) break;
      playCompletionChime();
      const body = i18n.t(
        finished.reason === 'loop'
          ? 'common.notifications.loopCompleted'
          : 'common.notifications.agentCompleted',
      );
      showBrowserNotification(
        'Vibisual',
        finished.agent.label ? `${finished.agent.label} — ${body}` : body,
        () => useGraphStore.getState().requestFocus(),
      );
    }
    const cost = performance.now() - t0;
    snapshotDelayRef.current = Math.min(
      Math.max(WS_BATCH_INTERVAL, cost * WS_BATCH_BACKOFF_FACTOR),
      WS_BATCH_INTERVAL_MAX,
    );
  }, [applyGraphSnapshot]);

  const flushStreamEvents = useCallback(() => {
    streamTimerRef.current = null;
    const buffered = streamPendingRef.current;
    streamPendingRef.current = [];
    if (buffered.length === 0) return;
    const t0 = performance.now();
    useGraphStore.getState().appendStreamEvents(buffered);
    const cost = performance.now() - t0;
    streamDelayRef.current = Math.min(
      Math.max(WS_STREAM_BATCH_INTERVAL, cost * 3),
      WS_BATCH_INTERVAL_MAX,
    );
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus('connecting');
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      attemptRef.current = 0;
      requestNotificationPermission();
      // store에 WS send 핸들러 등록 — hydrateProject/closeProject가 직접 발송 가능하도록
      useGraphStore.getState()._registerWsSend((msg: WSMessage) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        }
      });
      // §4 v1.98 — 진단 에러 캡처 sender 주입 (연결 시 큐 flush).
      setDiagnosticsSender((msg) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
      });
      // §4 v3.33 — 모바일 임베디드 터미널 프레임 sender 등록(데스크톱은 window.api.terminal 이라 미사용).
      registerTerminalWsSender((frame) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
      });
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        // §9 v3.40 — 통합 앱은 IPC 브리지(IpcWebSocket)가 구조화 클론된 객체를 그대로 실어
        // 보낸다(대형 스냅샷의 stringify→parse 왕복 제거). dev/web/모바일 ws 는 종전대로 문자열.
        const raw: unknown = event.data;
        const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
        // §4 v3.33 — 터미널 다중화 프레임(term_*)은 WSMessageType 유니온 밖 — 브리지로 먼저 라우팅.
        if (
          parsed && typeof parsed === 'object' &&
          typeof (parsed as { type?: unknown }).type === 'string' &&
          (parsed as { type: string }).type.startsWith('term_')
        ) {
          dispatchTerminalFrame(parsed as { type: string; payload?: unknown });
          return;
        }
        if (!isWSMessage(parsed)) return;

        const store = useGraphStore.getState();

        switch (parsed.type) {
          case 'graph_snapshot':
            if (isGraphSnapshot(parsed.payload)) {
              // 16ms 트레일링 코얼레스 — 액티브 에이전트 버스트 시 매 메시지마다
              // 전체 스냅샷 재구축/풀 재동기화하던 것을 최신 1건으로 합침 (60fps 예산 보호).
              // §9 v3.89 — 증분(deltas)은 누적이라 **버려지는 메시지 것도 여기서 먼저** 반영한다.
              snapshotPendingRef.current = materializeSnapshot(parsed.payload);
              if (snapshotTimerRef.current === null) {
                snapshotTimerRef.current = setTimeout(flushSnapshot, snapshotDelayRef.current);
              }
            }
            break;

          case 'project-hydrated': {
            const p = parsed.payload as ProjectHydratedPayload;
            if (p && typeof p.projectName === 'string') {
              store.onProjectHydrated(p.projectName, p.success, p.reason);
            }
            break;
          }

          case 'project-unloaded': {
            const p = parsed.payload as ProjectUnloadedPayload;
            if (p && typeof p.projectName === 'string') {
              store.onProjectUnloaded(p.projectName);
            }
            break;
          }

          case 'sub_agent_stream': {
            const event = parsed.payload as SubAgentStreamEvent;
            if (event && typeof event.subAgentId === 'string') {
              // 스트림 배치 — 도착 순서대로 큐에 모았다가 flush 시 한 번에 합쳐 적용.
              // 스냅샷(16ms)과 달리 WS_STREAM_BATCH_INTERVAL(50ms)로 묶어 StreamRenderer 재구축 빈도를 낮춘다.
              streamPendingRef.current.push(event);
              if (streamTimerRef.current === null) {
                streamTimerRef.current = setTimeout(flushStreamEvents, streamDelayRef.current);
              }
            }
            break;
          }

          case 'sub_agent_stream_batch': {
            // 서버가 40ms 창으로 coalescing 한 배열. 클라 스트림 배치 큐(50ms)에 그대로 합류.
            const batch = parsed.payload as SubAgentStreamEvent[];
            if (Array.isArray(batch) && batch.length > 0) {
              for (const event of batch) {
                if (event && typeof event.subAgentId === 'string') {
                  streamPendingRef.current.push(event);
                }
              }
              if (streamTimerRef.current === null) {
                streamTimerRef.current = setTimeout(flushStreamEvents, streamDelayRef.current);
              }
            }
            break;
          }

          case 'liveness_probe': {
            const p = parsed.payload as {
              sessionId: string; cwd: string; inUse: boolean;
              durationMs: number; reason: string; output: string; command: string;
            };
            if (import.meta.env.DEV) {
              const tag = p.inUse ? '%c[INUSE]' : '%c[FREE]';
              const color = p.inUse ? 'color:#10b981;font-weight:bold' : 'color:#f43f5e;font-weight:bold';
              console.log(
                tag + ' sess=%s dur=%dms via=%s',
                color, p.sessionId.slice(0, 8), p.durationMs, p.reason,
              );
              console.log('  cwd:    ', p.cwd);
              console.log('  command:', p.command);
              console.log('  output: ', p.output || '(empty)');
            }
            break;
          }

          case 'agent_status':
            // v3.76 — **여기서 완료음을 울리지 않는다.** 이 신호는 "시스템 전체 활성 세션 0" 전이일
            // 뿐이라 두뇌 리플렉션 자식·외부 폴더의 claude 세션·훅 세션의 매 턴 종료까지 전부 완료로
            // 잡혀, 사용자가 아무 명령도 안 내린 유휴 상태에서 소리가 났다. 완료음은 flushSnapshot 의
            // 커스텀 에이전트 completed 전이가 발화한다. phase 는 서버 스냅샷이 관리.
            break;

          // §5.3 #12-1 v1.43 — 권한 승인 요청 스택
          case 'permission_request': {
            const p = parsed.payload as PermissionRequest;
            if (p && typeof p.requestId === 'string') {
              store.addPendingPermission(p);
            }
            break;
          }
          case 'permission_resolved': {
            const p = parsed.payload as PermissionDecision;
            if (p && typeof p.requestId === 'string') {
              store.removePendingPermission(p.requestId);
            }
            break;
          }

          // §5.3 #12-2 v2.26 — AskUserQuestion IDE 인라인 카드
          case 'ask_user_question': {
            const p = parsed.payload as AskUserQuestionRequest;
            if (p && typeof p.requestId === 'string') {
              store.addPendingAskQuestion(p);
            }
            break;
          }
          case 'ask_user_question_resolved': {
            const p = parsed.payload as AskUserQuestionDecision;
            if (p && typeof p.requestId === 'string') {
              store.removePendingAskQuestion(p.requestId);
            }
            break;
          }

          // §7.11 v1.44 / v2.5 — iframe 서버 로그 스트리밍. shellId 는 (port, shellId) 필터용 echo.
          case 'iframe_log_init': {
            const p = parsed.payload as IframeLogInitPayload;
            if (p && typeof p.port === 'number' && Array.isArray(p.lines)) {
              const ev: Parameters<typeof iframeLogEvents.emit>[0] = {
                port: p.port,
                kind: 'init',
                lines: p.lines,
              };
              if (p.shellId) ev.shellId = p.shellId;
              if (p.unavailable) ev.unavailable = p.unavailable;
              iframeLogEvents.emit(ev);
            }
            break;
          }
          case 'iframe_log_append': {
            const p = parsed.payload as IframeLogAppendPayload;
            if (p && typeof p.port === 'number' && Array.isArray(p.lines)) {
              const ev: Parameters<typeof iframeLogEvents.emit>[0] = {
                port: p.port,
                kind: 'append',
                lines: p.lines,
              };
              if (p.shellId) ev.shellId = p.shellId;
              iframeLogEvents.emit(ev);
            }
            break;
          }

          // §7.7 v1.99 — Vibisual 서버 코어 로그 스트리밍
          case 'server_log_init': {
            const p = parsed.payload as ServerLogInitPayload;
            if (p && Array.isArray(p.lines)) {
              serverLogEvents.emit({ kind: 'init', lines: p.lines });
            }
            break;
          }
          case 'server_log_append': {
            const p = parsed.payload as ServerLogAppendPayload;
            if (p && Array.isArray(p.lines)) {
              serverLogEvents.emit({ kind: 'append', lines: p.lines });
            }
            break;
          }

          // §5.7 #23-1 v1.59 — Claude Code 업데이트 설치 진행
          case 'claude_install_progress': {
            const p = parsed.payload as ClaudeInstallProgress;
            if (p && typeof p.installId === 'string') {
              store.setClaudeInstallProgress(p);
            }
            break;
          }
          case 'model_registry_updated': {
            // §4 v2.38 — 시드→api-merged 전환 또는 TTL refresh 시 단독 push.
            store.applyModelRegistry(parsed.payload as import('@vibisual/shared').ModelRegistry);
            break;
          }
          case 'user_defaults_updated': {
            // §4 v2.42 — 사용자가 Options 창에서 Apply → 다른 창들도 즉시 반영.
            store.applyUserDefaults(parsed.payload as import('@vibisual/shared').UserDefaults);
            break;
          }
        }
      } catch {
        // 파싱 실패 시 무시
      }
    };

    ws.onclose = () => {
      setStatus('disconnected');
      wsRef.current = null;
      setDiagnosticsSender(null); // §4 v1.98 — 끊긴 동안 발생한 에러는 큐잉됐다 재연결 시 flush.
      registerTerminalWsSender(null); // §4 v3.33 — 끊기면 터미널 프레임 전송 중단(재연결 시 재등록).

      if (attemptRef.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = RECONNECT_BASE_DELAY * Math.pow(2, attemptRef.current);
        attemptRef.current += 1;
        console.warn(
          `[Vibisual] Reconnect attempt ${attemptRef.current}/${MAX_RECONNECT_ATTEMPTS} (in ${(delay / 1000).toFixed(1)}s)`,
        );
        timerRef.current = setTimeout(connect, delay);
      } else {
        console.warn(
          `[Vibisual] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) exceeded. Run pnpm dev to start the server.`,
        );
      }
    };

    ws.onerror = () => {
      console.warn(`[Vibisual] Cannot connect to server (${url}). Check if the server is running.`);
      ws.close();
    };
  }, [url, flushSnapshot, flushStreamEvents, materializeSnapshot]);

  useEffect(() => {
    connect();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
      if (streamTimerRef.current) clearTimeout(streamTimerRef.current);
      const ws = wsRef.current;
      if (ws) {
        ws.onerror = null;
        ws.onclose = null;
        ws.onopen = () => ws.close();
        if (ws.readyState === WebSocket.OPEN) ws.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  const send = useCallback((message: WSMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { status, send };
}
