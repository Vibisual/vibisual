import { useEffect, useRef, useCallback, useState } from 'react';
import type { WSMessage, GraphSnapshot, SubAgentStreamEvent, ProjectHydratedPayload, ProjectUnloadedPayload, IframeLogInitPayload, IframeLogAppendPayload, ServerLogInitPayload, ServerLogAppendPayload, PermissionRequest, PermissionDecision, ClaudeInstallProgress, AskUserQuestionRequest, AskUserQuestionDecision } from '@vibisual/shared';
import { MAX_RECONNECT_ATTEMPTS, RECONNECT_BASE_DELAY, WS_BATCH_INTERVAL, WS_STREAM_BATCH_INTERVAL } from '@vibisual/shared';
import { useGraphStore } from '../stores/graphStore.js';
import { iframeLogEvents } from '../bubble-map/api/iframeLogEvents.js';
import { serverLogEvents } from '../bubble-map/api/serverLogEvents.js';
import { setDiagnosticsSender } from '../utils/diagnostics.js';
import i18n from '../i18n/index.js';
import {
  playCompletionChime,
  showBrowserNotification,
  requestNotificationPermission,
} from '../utils/notification.js';

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

function isGraphSnapshot(data: unknown): data is GraphSnapshot {
  return (
    typeof data === 'object' &&
    data !== null &&
    'agents' in data &&
    'topFolders' in data &&
    Array.isArray((data as GraphSnapshot).agents) &&
    Array.isArray((data as GraphSnapshot).topFolders)
  );
}

function isAgentStatusPayload(
  data: unknown,
): data is { sessionId: string; isActive: boolean } {
  return (
    typeof data === 'object' &&
    data !== null &&
    'isActive' in data &&
    typeof (data as Record<string, unknown>)['isActive'] === 'boolean'
  );
}

export function useWebSocket(url: string): UseWebSocketReturn {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // graph_snapshot 코얼레스 — 버스트 시 마지막 스냅샷만 적용 (16ms 트레일링).
  const snapshotPendingRef = useRef<GraphSnapshot | null>(null);
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // §9 — sub_agent_stream 배치 — 도착분을 16ms 창에 모았다가 store action 1회로 합쳐 적용.
  // 커스텀 에이전트 다중 실행 시 매 스트림 라인마다 구독자 전원 재평가하던 것을 16ms당 1회로.
  const streamPendingRef = useRef<SubAgentStreamEvent[]>([]);
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyGraphSnapshot = useCallback((snap: GraphSnapshot) => {
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
      snap.contis ?? {},
      snap.activeContiWork ?? {},
    );
    store.applyStubProjects(snap.stubProjects ?? {});
    store.applyAppState(snap.appState);
    if (snap.uiLocale) store.applyUiLocale(snap.uiLocale);
    store.applyLayoutBoundsByProject(snap.layoutBoundsByProject);
    store.applyV150Metrics(snap.recentToolDurations, snap.compactCounts, snap.rateLimits);
    store.applySkillUsageCounts(snap.skillUsageCounts);
    store.applyAutoAgentSummaries(snap.autoAgentSummaries);
    store.applyAgentReports(snap.agentReports);
    store.applyAgentQuestions(snap.agentQuestions);
    store.applyAgentReviews(snap.agentReviews);
    store.applyAgentLists(snap.agentLists);
    store.applyAgentFeedbacks(snap.agentFeedbacks);
    store.applyDiagnosticLog(snap.diagnosticLog);
    store.applyModelRegistry(snap.modelRegistry);
    store.applyUserDefaults(snap.userDefaults);
  }, []);

  const flushSnapshot = useCallback(() => {
    snapshotTimerRef.current = null;
    const snap = snapshotPendingRef.current;
    snapshotPendingRef.current = null;
    if (snap) applyGraphSnapshot(snap);
  }, [applyGraphSnapshot]);

  const flushStreamEvents = useCallback(() => {
    streamTimerRef.current = null;
    const buffered = streamPendingRef.current;
    streamPendingRef.current = [];
    if (buffered.length > 0) useGraphStore.getState().appendStreamEvents(buffered);
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
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const parsed: unknown = JSON.parse(String(event.data));
        if (!isWSMessage(parsed)) return;

        const store = useGraphStore.getState();

        switch (parsed.type) {
          case 'graph_snapshot':
            if (isGraphSnapshot(parsed.payload)) {
              // 16ms 트레일링 코얼레스 — 액티브 에이전트 버스트 시 매 메시지마다
              // 전체 스냅샷 재구축/풀 재동기화하던 것을 최신 1건으로 합침 (60fps 예산 보호).
              snapshotPendingRef.current = parsed.payload;
              if (snapshotTimerRef.current === null) {
                snapshotTimerRef.current = setTimeout(flushSnapshot, WS_BATCH_INTERVAL);
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
                streamTimerRef.current = setTimeout(flushStreamEvents, WS_STREAM_BATCH_INTERVAL);
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
                streamTimerRef.current = setTimeout(flushStreamEvents, WS_STREAM_BATCH_INTERVAL);
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
            // phase는 서버 스냅샷이 관리 — 여기선 알림만
            if (isAgentStatusPayload(parsed.payload) && !parsed.payload.isActive) {
              playCompletionChime();
              showBrowserNotification(
                'Vibisual',
                i18n.t('common.notifications.agentCompleted'),
                () => store.requestFocus(),
              );
            }
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
  }, [url, flushSnapshot, flushStreamEvents]);

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
