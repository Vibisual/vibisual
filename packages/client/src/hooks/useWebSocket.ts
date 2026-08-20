import { useEffect, useRef, useCallback, useState } from 'react';
import type { WSMessage, GraphSnapshot, GraphSnapshotWire, SubAgentStreamEvent, ProjectHydratedPayload, ProjectUnloadedPayload, IframeLogInitPayload, IframeLogAppendPayload, ServerLogInitPayload, ServerLogAppendPayload, PermissionRequest, PermissionDecision, ClaudeInstallProgress, ClaudeSetupProgress, AskUserQuestionRequest, AskUserQuestionDecision, DebugEventPayload, HookFiredPayload } from '@vibisual/shared';
import { applyKeyedSliceDelta, MAX_RECONNECT_ATTEMPTS, RECONNECT_BASE_DELAY, WS_BATCH_INTERVAL, WS_STREAM_BATCH_INTERVAL, WS_BATCH_INTERVAL_MAX, WS_BATCH_BACKOFF_FACTOR } from '@vibisual/shared';
import { useGraphStore } from '../stores/graphStore.js';
// §5.5 #17-20 ⑩ v4.94 — 디버그 세션은 프로세스 수명이라 그래프 스토어가 아닌 런타임 스토어가 받는다.
import { useDebugSessions } from '../stores/debugSessions.js';
import { useHookFires } from '../stores/hookFires.js';
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

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface UseWebSocketReturn {
  status: ConnectionStatus;
  send: (message: WSMessage) => void;
  /**
   * §5.12 (J) — 지금 붙어 있는 소켓을 끊고 **즉시 다시 붙는다**. 서버가 새 연결에 보내는
   * `buildConnectionMessages()`(연결 ack + 전체 스냅샷)가 곧 "새로고침"이다 — 스냅샷을 다시
   * 달라는 새 메시지 타입을 만들지 않고 이미 있는 계약을 쓴다.
   */
  reconnect: () => void;
  /**
   * §5.12 (J) — 마지막으로 `graph_snapshot` 을 화면에 반영한 시각(0 = 아직 없음).
   * **state 가 아니라 ref 를 읽는 함수**다 — 스냅샷마다 setState 하면 이 훅을 쓰는 모든 창이
   * 16ms 주기로 리렌더된다. 필요한 쪽이 자기 틱에서 읽어 간다.
   */
  getLastSnapshotAt: () => number;
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
  // §5.12 (J) — 마지막으로 스냅샷을 반영한 시각. ref 라 리렌더를 유발하지 않는다(위 주석 참조).
  const lastSnapshotAtRef = useRef(0);
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
    // §9 스코프드 구독 — 프로젝트별 에이전트 집계(탭 배지). **구독 범위 밖 프로젝트도 들어 있다.**
    //   같은 이유로 별도 액션(loadSnapshot 위치 인자 ❌).
    useGraphStore.getState().applyProjectAgentCounts(snap.projectAgentCounts ?? {});
    // §5.13 v4.45 — 앱 버블은 별도 액션으로 반영한다(loadSnapshot 의 위치 인자를 늘리면
    //   호출부 한 곳만 어긋나도 조용히 다른 값이 들어간다).
    useGraphStore.getState().applyAppBubbles(snap.appBubbles ?? []);
    // §5.14 v4.62 — 플레이 버블도 같은 이유로 별도 액션.
    useGraphStore.getState().applyPlayBubbles(snap.playBubbles ?? []);
    // §5.15 — 스펙 보드도 같은 이유로 별도 액션.
    useGraphStore.getState().applySpecDocs(snap.specDocs ?? []);
    // §5.18 — 에이전트 랩도 같은 이유로 별도 액션(비교 표는 서버 값 그대로 그린다).
    useGraphStore.getState().applyLabRuns(snap.labRuns ?? []);
    // §5.20 — 스크립트 선반도 같은 이유로 별도 액션(항목의 마지막 결과는 서버 값 그대로 그린다).
    useGraphStore.getState().applyShelfBubbles(snap.shelfBubbles ?? []);
    // §5.21 — 비용·토큰 지도. 기간 합계·정렬까지 서버가 접어 실어 주므로 그대로 넣는다.
    useGraphStore.getState().applyCostMaps(snap.costMaps ?? []);
    // §5.22 — 감사 원장. 위험·거부 집계까지 서버가 접어 실어 주므로 그대로 넣는다.
    useGraphStore.getState().applyAuditLogs(snap.auditLogs ?? []);
    // §5.16 — 리뷰·승인 레인. 서버가 전량을 싣고, 사람이 치운 리뷰는 곧 사라짐으로 반영된다.
    useGraphStore.getState().applyReviewRequests(snap.reviewRequests ?? []);
    // §5.5 #17-20 ⑩ v4.94 — 중단점(프로젝트별). 세션이 없어도 편집창 gutter 가 이 값을 그린다.
    useGraphStore.getState().applyDebugBreakpoints(snap.debugBreakpoints ?? {});
    // §5.11 v4.65 — 집행 플러그인의 실측(프로젝트별). 켠 것이 없으면 서버가 필드를 안 실으므로 빈 맵으로 비운다.
    useGraphStore.getState().applyPluginFacts(snap.pluginFacts ?? {});
    const _tLoad = PERF ? performance.now() : 0;
    store.applyStubProjects(snap.stubProjects ?? {});
    store.applyAppState(snap.appState);
    if (snap.uiLocale) store.applyUiLocale(snap.uiLocale);
    store.applyLayoutBoundsByProject(snap.layoutBoundsByProject);
    store.applyV150Metrics(snap.recentToolDurations, snap.compactCounts, snap.rateLimits, snap.claudeUsage);
    // §4 v4.82 — Claude 로그인 상태(글로벌). 미로그인이면 LoginWindow 가 이 값을 보고 뜬다.
    store.applyClaudeAuth(snap.claudeAuth);
    // §4 (첫 실행 설치 온보딩) — CLI 설치 판정(글로벌). 미설치면 ClaudeSetupGate 가 이 값을 보고 뜬다.
    store.applyClaudeSetup(snap.claudeSetup);
    store.applySkillUsageCounts(snap.skillUsageCounts);
    store.applyAutoAgentSummaries(snap.autoAgentSummaries);
    store.applyAutoAgentRuns(snap.autoAgentRuns);
    store.applyRunningSubagentTasks(snap.runningSubagentTasks);
    store.applyFinishedSubagentTasks(snap.finishedSubagentTasks);
    store.applyAgentReports(snap.agentReports);
    store.applyAgentQuestions(snap.agentQuestions);
    store.applyAgentReviews(snap.agentReviews);
    store.applyAgentLists(snap.agentLists);
    store.applyAgentFeedbacks(snap.agentFeedbacks);
    store.applySessionLoops(snap.sessionLoops);
    // §5.5 #17-17 v4.46 — 세션 목표(활동바 퍼센트 배지 + 목표 패널의 원본).
    store.applySessionGoals(snap.sessionGoals);
    store.applyDiagnosticLog(snap.diagnosticLog);
    store.applyModelRegistry(snap.modelRegistry);
    // §5.19 — 로컬 LLM 상태(엔진·모델·내려받기). 스냅샷이 진실이고, 사이사이는 아래 진행 push 가 채운다.
    store.applyLocalLlm(snap.localLlm);
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
    lastSnapshotAtRef.current = Date.now();
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

          // §5.5 #17-20 ⑩ v4.94 — 공통 디버그 층의 상태/출력. 세션은 프로세스 수명이라
          // graph_snapshot 이 아니라 이 메시지로만 흐른다(런타임 스토어가 받는다).
          case 'debug_event': {
            const p = parsed.payload as DebugEventPayload;
            if (p && typeof p.sessionId === 'string') {
              useDebugSessions.getState().applyEvent(p);
            }
            break;
          }

          // §5.5 #17-32 ⑤ — 훅이 방금 울렸다. 서버가 짧은 창으로 모아 배열 한 건으로 보낸다.
          // 순간의 표시 신호라 graph_snapshot 이 아니라 이 메시지로만 흐른다(런타임 스토어가 받는다).
          case 'hook_fired': {
            const fired = parsed.payload as HookFiredPayload[];
            if (Array.isArray(fired) && fired.length > 0) {
              useHookFires.getState().applyFired(fired.filter((f) => f && typeof f.event === 'string'));
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

          // §4 (첫 실행 설치 온보딩) — 네이티브 인스톨러 진행. 게이트가 이 값으로 로그를 보여준다.
          case 'claude_setup_progress': {
            const p = parsed.payload as ClaudeSetupProgress;
            if (p && typeof p.setupId === 'string') {
              store.setClaudeSetupProgress(p);
            }
            break;
          }
          case 'model_registry_updated': {
            // §4 v2.38 — 시드→api-merged 전환 또는 TTL refresh 시 단독 push.
            store.applyModelRegistry(parsed.payload as import('@vibisual/shared').ModelRegistry);
            break;
          }
          case 'local_engine_progress': {
            // §5.19 — 엔진 설치 진행. 스냅샷을 기다리면 막대가 뚝뚝 끊긴다.
            store.applyLocalEngineProgress(parsed.payload as import('@vibisual/shared').LocalEngineProgress);
            break;
          }
          case 'local_model_progress': {
            // §5.19 — 모델 내려받기 진행(수 GB 라 이 줄이 사실상 유일한 피드백이다).
            store.applyLocalModelProgress(parsed.payload as import('@vibisual/shared').LocalModelDownloadProgress);
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

  /**
   * §5.12 (J) 새로고침 — 지금 소켓을 버리고 새로 붙는다(서버가 전체 스냅샷을 다시 준다).
   *
   * 닫기 전에 기존 소켓의 `onclose` 를 떼는 것이 핵심이다 — 그대로 두면 backoff 재연결이 **여기서
   * 여는 소켓과 별개로** 하나 더 예약되어 창 하나가 두 소켓을 물게 된다. 예약돼 있던 재시도 타이머도
   * 같은 이유로 걷어내고 시도 횟수를 0 으로 되돌린다(사용자가 직접 누른 것이 곧 새 시작이다).
   */
  const reconnect = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    attemptRef.current = 0;
    const ws = wsRef.current;
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.onopen = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      wsRef.current = null; // connect() 의 "이미 열려 있으면 무시" 가드를 지나가게 한다.
    }
    connect();
  }, [connect]);

  const getLastSnapshotAt = useCallback(() => lastSnapshotAtRef.current, []);

  // ─── §9 스코프드 스냅샷 구독 ───────────────────────────────────────────────
  //
  // 이 창이 **지금 그리는 프로젝트**를 서버에 선언한다. 모든 shell(메인 · 별창 · 지휘통제실 ·
  // 오버레이)이 자기 창의 활성 프로젝트를 `activeProject` 로 들고 있으므로(별창·통제실은
  // `setActiveProjectLocal`), 선언 지점을 이 훅 하나로 모을 수 있다.
  //
  // ⚠ `activeProject` 가 아직 정해지지 않았으면(부팅 첫 스냅샷 전) **선언하지 않는다** —
  //   서버는 "선언한 창이 하나도 없으면 전부 보낸다"가 기본값이라, 침묵이 곧 안전 쪽이다.
  //   여기서 성급히 `[]` 를 보내면 활성 프로젝트를 정하기도 전에 데이터가 끊긴다.
  const activeProject = useGraphStore((s) => s.activeProject);
  const declaredScopeRef = useRef<string | null>(null);
  useEffect(() => {
    if (status !== 'connected') {
      declaredScopeRef.current = null; // 재연결하면 다시 선언해야 한다(서버 쪽 선언은 창과 함께 사라진다)
      return;
    }
    if (!activeProject || declaredScopeRef.current === activeProject) return;
    declaredScopeRef.current = activeProject;
    send({
      type: 'set-project-scope',
      timestamp: Date.now(),
      payload: { projects: [activeProject] },
    });
  }, [status, activeProject, send]);

  return { status, send, reconnect, getLastSnapshotAt };
}
