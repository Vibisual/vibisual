import type { WebSocket } from 'ws';
import type {
  WSMessage,
  HydrateProjectPayload,
  ProjectHydratedPayload,
  UnloadProjectPayload,
  ProjectUnloadedPayload,
  SetProjectScopePayload,
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

/**
 * §7.11 — `(shellId, port)` 별 lazy iframe 서버 로그 스트리머. `runningServers` 에서 ServerEntry 를 찾아 그 `outputFile` 만 tail 한다:
 * shellId 있으면 `(shellId AND port)` → 같은 shellId 의 다른 entry 순, bare-port fallback ❌(다른 셸로 새면 §3.5 격리 위반). 없으면(레거시) `port` 일치.
 * 죽은 서버도 entry 가 남아 마지막 파일을 본다. 못 찾으면 null(`unavailable:'no-server-entry'`). 디스크 `.output` 포트 스캔은 쓰지 않는다 — 무관한 로그가 샌다.
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

/**
 * §9 — 창이 닫혔을 때 그 창의 구독 선언을 지운다(desktop ipc 의 webContents 'destroyed',
 * 모바일 소켓 close 에서 호출). 남겨 두면 합집합이 넓어진 채 굳어 스코프드 구독이 무력해지고,
 * 배경 탭 유휴 해제도 "누군가 보고 있다"는 이유로 영영 걸리지 않는다.
 */
export function handleClientDisconnect(conn: ClientConnection): void {
  graphManager.clearClientProjectScope(conn);
}

/** graceful shutdown — 프로세스 종료 시 호출 가능하도록 export */
export function shutdownIframeLogStreamer(): void {
  iframeLogStreamer.shutdown();
}

/** graceful shutdown — §7.7 서버 코어 로그 스트리머 타이머·구독 정리. */
export function shutdownServerLogService(): void {
  serverLogService.shutdown();
}

/** ws.on('message') 본문 — desktop inprocess 모드의 Electron IPC 수신도 같은 로직을 쓴다. */
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
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getBroadcastSnapshot() });
    }
    return;
  }

  // §9 스코프드 스냅샷 구독 — 이 창이 지금 그리는 프로젝트를 선언한다(응답은 스냅샷 1벌).
  if (message.type === 'set-project-scope') {
    const { projects, folders, slices } = (message.payload ?? {}) as SetProjectScopePayload;
    if (!Array.isArray(projects)) return;
    // §9 폴더·슬라이스 스코프 — 같은 메시지에 얹는다(따로 오면 그 사이 스냅샷이 어긋난 범위로 나간다).
    // 배열이 아니면(구버전 클라) 미선언 그대로 넘긴다 — `[]` 로 바꾸면 그 창의 폴더 내부가 비고 읽는 슬라이스가 영영 안 온다.
    graphManager.setClientProjectScope(
      conn,
      projects,
      Array.isArray(folders) ? folders : undefined,
      Array.isArray(slices) ? slices : undefined,
    );
    // ⚠ **즉시 1벌을 돌려주는 것이 필수다.** 브로드캐스트는 "무언가 바뀔 때" 나가므로, 조용한
    //   프로젝트로 탭을 옮기면 다음 변경이 올 때까지 캔버스가 빈 채로 남는다. 첫 연결
    //   (`buildConnectionMessages`)과 같은 이유·같은 형태(증분 아닌 전체)로 한 벌 보낸다.
    conn.send(JSON.stringify({
      type: 'graph_snapshot',
      timestamp: Date.now(),
      payload: graphManager.getBroadcastSnapshot(),
    } satisfies WSMessage));
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
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getBroadcastSnapshot() });
    } else {
      logger.warn(`unload-project: "${projectName}" ${result.reason ?? 'failed'} — ignoring`);
    }
    return;
  }

  // §7.11 iframe 서버 로그 스트리밍 — 식별자 (shellId, port)
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

  // §7.7 — 서버 코어 로그 스트리밍(단일 전역 스트림)
  if (message.type === 'subscribe_server_log') {
    serverLogService.subscribe(conn as unknown as WebSocket);
    return;
  }
  if (message.type === 'unsubscribe_server_log') {
    serverLogService.unsubscribe(conn as unknown as WebSocket);
    return;
  }

  // §4 — renderer 가 잡은 JS 에러를 진단 로그(diagnosticService)에 적재.
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

/** 접속 직후 초기 메시지(ack + 스냅샷). standalone ws 와 desktop IPC 가 공유한다(in-process 엔 'connection' 이 없어 IPC 가 직접 보낸다). */
export function buildConnectionMessages(): WSMessage[] {
  return [
    { type: 'connection_ack', timestamp: Date.now(), payload: { message: 'Connected to Vibisual server' } },
    { type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getBroadcastSnapshot() },
  ];
}

