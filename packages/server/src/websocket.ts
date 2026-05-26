import type { WebSocket } from 'ws';
import type {
  WSMessage,
  HydrateProjectPayload,
  ProjectHydratedPayload,
  UnloadProjectPayload,
  ProjectUnloadedPayload,
  IframeLogSubscribePayload,
  IframeLogUnsubscribePayload,
  ServerEntry,
} from '@vibisual/shared';
import { logger } from './logger.js';
import { graphManager } from './services/projectGraphManager.js';
import { IframeLogStreamer } from './services/iframeLogStreamer.js';
import { diagnosticService } from './services/diagnosticService.js';
import { serverLogService } from './services/serverLogService.js';
import { setBroadcastSink, broadcast } from './broadcastBus.js';

/** 클라이언트 연결 최소 인터페이스 — standalone(ws) / desktop(Electron IPC) 공통 */
export interface ClientConnection {
  send(data: string): void;
}

/** §7.11 v1.44 / v2.5 — `(shellId, port)` 별 lazy iframe 서버 로그 스트리머.
 *
 *  resolveOutputFile: 구독한 `(port, shellId)` 에 대응하는 ServerEntry 를
 *  `runningServers` 에서 §7.11 "ServerEntry 매칭" 규칙으로 찾아 그 `outputFile` 만 쓴다.
 *    - shellId 있음: `(shellId AND port)` 정확 일치 → 같은 shellId 의 다른 entry
 *      (한 셸이 FE/BE 다중 포트를 열어도 outputFile 은 셸 단위로 동일) 순.
 *      bare-port fallback 은 하지 않는다 — 다른 셸의 같은 포트로 새면 §3.5 격리 위반.
 *    - shellId 없음(레거시 위성): `port` 일치 entry.
 *  죽은 서버도 ServerEntry 는 보존(§7.11)되므로 그 마지막 outputFile 을 tail —
 *  서버가 꺼져 있으면 파일이 자라지 않아 새 라인도 없다. 매칭 실패 시 null →
 *  init 이 `unavailable:'no-server-entry'` 로 표기.
 *
 *  v2.5 이전의 디스크 `.output` 스캔(`scanDiskForPort` — 포트 숫자를 sniff 해
 *  "가장 최근 자란 파일" 선택)은 폐기됐다: 꺼진 서버의 팝업이 무관한 live 프로세스
 *  (다른 셸·에이전트 task 출력)의 로그를 흘리는 버그의 직접 원인이었다.
 */
const iframeLogStreamer = new IframeLogStreamer(
  (port: number, shellId?: string): string | null => {
    const snapshot = graphManager.getSnapshot();
    let shellMatch: string | null = null;
    let portMatch: string | null = null;
    for (const entries of Object.values(snapshot.runningServers ?? {})) {
      for (const e of entries as ServerEntry[]) {
        if (!e.outputFile) continue;
        if (shellId) {
          if (e.shellId === shellId && e.port === port) return e.outputFile;
          if (e.shellId === shellId && shellMatch == null) shellMatch = e.outputFile;
        } else if (e.port === port && portMatch == null) {
          portMatch = e.outputFile;
        }
      }
    }
    return shellId ? shellMatch : portMatch;
  },
);

/** graceful shutdown — 프로세스 종료 시 호출 가능하도록 export */
export function shutdownIframeLogStreamer(): void {
  iframeLogStreamer.shutdown();
}

/** graceful shutdown — §7.7 v1.99 서버 코어 로그 스트리머 타이머·구독 정리. */
export function shutdownServerLogService(): void {
  serverLogService.shutdown();
}

/**
 * ws.on('message') 콜백 본문을 독립 함수로 추출 — desktop inprocess 모드에서
 * Electron IPC 메시지 수신 시에도 같은 로직을 재사용한다.
 */
export function handleClientMessage(
  message: { type?: string; payload?: unknown },
  conn: ClientConnection,
): void {
  if (message.type === 'hydrate-project') {
    const { projectName } = (message.payload ?? {}) as HydrateProjectPayload;
    const result = graphManager.hydrateProject(projectName);
    const responsePayload: ProjectHydratedPayload = {
      projectName,
      success: result.ok,
      ...(result.reason ? { reason: result.reason } : {}),
    };
    const response: WSMessage = {
      type: 'project-hydrated',
      timestamp: Date.now(),
      payload: responsePayload,
    };
    conn.send(JSON.stringify(response));
    if (result.ok) {
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getSnapshot() });
    }
    return;
  }

  if (message.type === 'unload-project') {
    const { projectName } = (message.payload ?? {}) as UnloadProjectPayload;
    const result = graphManager.unloadProject(projectName);
    if (result.ok) {
      const responsePayload: ProjectUnloadedPayload = { projectName };
      const response: WSMessage = {
        type: 'project-unloaded',
        timestamp: Date.now(),
        payload: responsePayload,
      };
      conn.send(JSON.stringify(response));
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getSnapshot() });
    } else {
      logger.warn(`unload-project: "${projectName}" ${result.reason ?? 'failed'} — ignoring`);
    }
    return;
  }

  // §7.11 v1.44 / v2.5 iframe 서버 로그 스트리밍 — 식별자 (shellId, port)
  if (message.type === 'subscribe_iframe_log') {
    const { port, shellId } = (message.payload ?? {}) as IframeLogSubscribePayload;
    if (typeof port === 'number' && Number.isFinite(port)) {
      iframeLogStreamer.subscribe(port, shellId, conn as unknown as WebSocket);
    }
    return;
  }
  if (message.type === 'unsubscribe_iframe_log') {
    const { port, shellId } = (message.payload ?? {}) as IframeLogUnsubscribePayload;
    if (typeof port === 'number' && Number.isFinite(port)) {
      iframeLogStreamer.unsubscribe(port, shellId, conn as unknown as WebSocket);
    }
    return;
  }

  // §7.7 v1.99 — Vibisual 서버 코어 로그 스트리밍 (단일 전역 스트림)
  if (message.type === 'subscribe_server_log') {
    serverLogService.subscribe(conn as unknown as WebSocket);
    return;
  }
  if (message.type === 'unsubscribe_server_log') {
    serverLogService.unsubscribe(conn as unknown as WebSocket);
    return;
  }

  // §4 v1.98 — renderer 가 잡은 JS 에러를 진단 로그(diagnosticService)에 적재.
  if (message.type === 'client_error') {
    const p = (message.payload ?? {}) as { level?: unknown; message?: unknown; stack?: unknown };
    if (typeof p.message === 'string' && p.message.trim()) {
      diagnosticService.record({
        source: 'renderer',
        level: p.level === 'warn' ? 'warn' : 'error',
        message: p.message,
        ...(typeof p.stack === 'string' ? { stack: p.stack } : {}),
      });
    }
    return;
  }
}

/**
 * 신규 클라이언트 접속 직후 보내는 초기 메시지(연결 ack + 현재 그래프 스냅샷).
 * standalone ws(`wss.on('connection')`) 와 desktop IPC(renderer 구독 시점) 양쪽이 공유 —
 * desktop in-process 모드엔 ws 'connection' 이벤트가 없으므로 IPC 레이어가 이걸 직접 보낸다.
 */
export function buildConnectionMessages(): WSMessage[] {
  return [
    { type: 'connection_ack', timestamp: Date.now(), payload: { message: 'Connected to Vibisual server' } },
    { type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getSnapshot() },
  ];
}

