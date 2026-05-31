import { ipcMain, type WebContents } from 'electron';
import { inject, type DispatchFunc } from 'light-my-request';
import type { Express } from 'express';
import {
  handleClientMessage,
  buildConnectionMessages,
  shutdownIframeLogStreamer,
  shutdownServerLogService,
  type ClientConnection,
} from '@vibisual/server';
import {
  openDetached,
  closeByTabKey,
  closeByWindowId,
  minimizeByWindowId,
  toggleMaximizeByWindowId,
  listDetached,
  hasTabKey,
  getCursorScreenPoint,
  getMainContentBounds,
  pushRedockHover,
  redockCommit,
  startDetachDragByWindowId,
  endDetachDragByWindowId,
  type DetachKind,
} from './windowManager';
import { checkForUpdates, quitAndInstall, getUpdateState } from './updaterManager';
import type { UpdateState } from '@vibisual/shared';

// IPC hub — SCENARIO.md §3.7 (in-process 통합).
//
// renderer↔server 는 소켓 없이 Electron IPC 직결. 채널:
//   - vibisual:server-info  → renderer 가 패키지 모드인지 확인용(in-process라 포트 의미 없음).
//   - vibisual:fetch        → HTTP 요청을 in-process Express app 으로 합성 디스패치
//                             (light-my-request — fake req/res 주입, TCP 소켓 없음).
//   - vibisual:send         → renderer→server WS 메시지(hydrate/unload/iframe-log) 직접 처리.
//   - vibisual:ws-connect   → renderer 의 IpcWebSocket 생성 시 초기 ack+snapshot 푸시.
//   - vibisual:ws (push)    → server broadcast sink(main/index.ts)가 renderer 로 푸시.

interface FetchInitWire {
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
  /** `body` 가 base64 인코딩 바이너리(FormData/Blob 등)임을 표시 — multipart 업로드 경로. */
  bodyEncoding?: 'base64';
}

interface FetchResponseWire {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  /** `body` 가 base64 인코딩 바이너리임을 표시 — 비텍스트 응답(이미지 등) 무손실 전달. */
  bodyEncoding?: 'base64';
}

export interface IpcHub {
  stop(): void;
}

/** iframeLogStreamer.safeSend 가 OPEN 여부를 readyState 로 확인하므로 1(OPEN) 을 부여한다. */
type RendererConnection = ClientConnection & { readyState: number };

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// 텍스트 계열 Content-Type 판정 — 그 외(이미지/폰트/옥텟 스트림 등)는 base64 로 무손실 전송.
// IPC 와이어가 텍스트 전용이라 비텍스트 응답을 res.payload(문자열)로 보내면 바이트가 깨진다.
function isTextualContentType(contentType: string | undefined): boolean {
  if (!contentType) return true;
  const v = contentType.toLowerCase();
  return (
    v.startsWith('text/') ||
    v.includes('json') ||
    v.includes('javascript') ||
    v.includes('xml') ||
    v.includes('urlencoded') ||
    v.includes('image/svg')
  );
}

export function setupIpc(expressApp: Express): IpcHub {
  // webContents 별 ClientConnection — handleClientMessage 응답·iframeLogStreamer 구독의
  // 대상 식별에 쓴다. 같은 webContents 면 같은 conn 객체를 재사용해야 unsubscribe 가 맞는다.
  const connections = new Map<number, RendererConnection>();

  const connFor = (sender: WebContents): RendererConnection => {
    const existing = connections.get(sender.id);
    if (existing) return existing;
    const conn: RendererConnection = {
      readyState: 1,
      send: (data: string): void => {
        if (!sender.isDestroyed()) sender.send('vibisual:ws', safeParse(data));
      },
    };
    connections.set(sender.id, conn);
    sender.once('destroyed', () => connections.delete(sender.id));
    return conn;
  };

  ipcMain.handle('vibisual:server-info', () => ({ port: 0, running: true }));

  ipcMain.handle(
    'vibisual:fetch',
    async (_event, path: string, init?: FetchInitWire): Promise<FetchResponseWire> => {
      if (typeof path !== 'string' || !path.startsWith('/')) {
        throw new Error(`vibisual:fetch path must start with "/" (got ${String(path)})`);
      }
      // base64 와이어 본문(FormData/Blob 등)은 Buffer 로 복원해야 multer/busboy 가
      // multipart 를 파싱한다. 텍스트 본문은 그대로 합성 디스패치한다.
      const payload =
        init?.body == null
          ? undefined
          : init.bodyEncoding === 'base64'
            ? Buffer.from(init.body, 'base64')
            : init.body;
      const res = await inject(expressApp as unknown as DispatchFunc, {
        method: (init?.method ?? 'GET') as 'GET',
        url: path,
        headers: init?.headers,
        payload,
      });
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) {
        if (v == null) continue;
        headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
      }
      const textual = isTextualContentType(headers['content-type']);
      const wire: FetchResponseWire = {
        ok: res.statusCode < 400,
        status: res.statusCode,
        statusText: res.statusMessage ?? '',
        headers,
        body: textual ? res.payload : res.rawPayload.toString('base64'),
      };
      if (!textual) wire.bodyEncoding = 'base64';
      return wire;
    },
  );

  ipcMain.handle('vibisual:send', (event, message: unknown) => {
    const msg = typeof message === 'string' ? safeParse(message) : message;
    if (msg && typeof msg === 'object') {
      handleClientMessage(msg as { type?: string; payload?: unknown }, connFor(event.sender));
    }
  });

  ipcMain.handle('vibisual:ws-connect', (event) => {
    // renderer 의 IpcWebSocket 생성 직후 호출 — standalone ws 의 'connection' 이벤트와
    // 동일하게 connection_ack + 현재 graph_snapshot 을 그 renderer 에만 보낸다.
    connFor(event.sender);
    for (const m of buildConnectionMessages()) {
      if (!event.sender.isDestroyed()) event.sender.send('vibisual:ws', m);
    }
    // SCENARIO.md §5.4 #14-1 — 별창/메인 모두 현재 detached 목록을 즉시 알아야 한다.
    if (!event.sender.isDestroyed()) {
      event.sender.send('vibisual:detached:list', listDetached());
    }
  });

  // ─── §5.4 #14-1 (v2.29) Detach/Redock 채널 ───────────────────────────────
  ipcMain.handle(
    'vibisual:window:detach',
    (
      _event,
      payload: { kind: DetachKind; tabKey: string; cursor?: { x: number; y: number } },
    ): { windowId: number; reused: boolean } => {
      if (!payload || (payload.kind !== 'project' && payload.kind !== 'iframe')) {
        throw new Error('vibisual:window:detach — invalid kind');
      }
      if (typeof payload.tabKey !== 'string' || payload.tabKey.length === 0) {
        throw new Error('vibisual:window:detach — tabKey required');
      }
      return openDetached({
        kind: payload.kind,
        tabKey: payload.tabKey,
        cursor: payload.cursor,
      });
    },
  );

  ipcMain.handle('vibisual:window:close-detached', (_event, tabKey: string): boolean => {
    return closeByTabKey(tabKey);
  });

  ipcMain.handle('vibisual:window:close-self', (event): boolean => {
    // 별창의 X 가 아니라 별창 안의 "메인으로 합치기" 버튼 같은 데서 자기 창 직접 닫기용.
    const wcId = event.sender.id;
    // detached 매핑이 있는 창이면 closeByWindowId, 아니면 BrowserWindow.fromWebContents 로 닫음.
    return closeByWindowId(wcId);
  });

  // §5.4 #14-1 — 별창 자기 창의 최소화/최대화(복원) 토글. 닫기(close-self) 와 동일하게
  // event.sender.id 로 자기 창을 식별한다.
  ipcMain.handle('vibisual:window:minimize-self', (event): boolean => {
    return minimizeByWindowId(event.sender.id);
  });
  ipcMain.handle('vibisual:window:toggle-maximize-self', (event): boolean => {
    return toggleMaximizeByWindowId(event.sender.id);
  });

  ipcMain.handle('vibisual:window:list-detached', () => listDetached());
  ipcMain.handle('vibisual:window:has-tab', (_e, tabKey: string) => hasTabKey(tabKey));

  ipcMain.handle('vibisual:window:cursor-screen', () => getCursorScreenPoint());
  ipcMain.handle('vibisual:window:main-bounds', () => getMainContentBounds());

  ipcMain.handle(
    'vibisual:window:redock-drag',
    (_e, payload: { tabKey: string; hovering: boolean }): void => {
      if (typeof payload?.tabKey !== 'string') return;
      pushRedockHover(payload.tabKey, !!payload.hovering);
    },
  );

  ipcMain.handle('vibisual:window:redock-commit', (_e, tabKey: string): boolean => {
    if (typeof tabKey !== 'string' || tabKey.length === 0) return false;
    return redockCommit(tabKey);
  });

  // §5.4 #14-1 v2.30 — 별창 미니 타이틀바 드래그 시작/종료.
  ipcMain.handle('vibisual:window:detach-drag-start', (event): boolean => {
    return startDetachDragByWindowId(event.sender.id);
  });
  ipcMain.handle('vibisual:window:detach-drag-end', (event, commit: boolean): boolean => {
    return endDetachDragByWindowId(event.sender.id, !!commit);
  });

  // ─── §4 v2.44 자동 업데이트 채널 ──────────────────────────────────────────
  // 상태 push 는 updaterManager 가 직접 webContents 로 보낸다(vibisual:update:status).
  // 여기서는 renderer→main 의 invoke 액션만 등록한다.
  ipcMain.handle('vibisual:update:check', (): Promise<UpdateState> => checkForUpdates());
  ipcMain.handle('vibisual:update:install', (): boolean => quitAndInstall());
  ipcMain.handle('vibisual:update:get-state', (): UpdateState => getUpdateState());

  return {
    stop(): void {
      ipcMain.removeHandler('vibisual:server-info');
      ipcMain.removeHandler('vibisual:fetch');
      ipcMain.removeHandler('vibisual:send');
      ipcMain.removeHandler('vibisual:ws-connect');
      ipcMain.removeHandler('vibisual:window:detach');
      ipcMain.removeHandler('vibisual:window:close-detached');
      ipcMain.removeHandler('vibisual:window:close-self');
      ipcMain.removeHandler('vibisual:window:minimize-self');
      ipcMain.removeHandler('vibisual:window:toggle-maximize-self');
      ipcMain.removeHandler('vibisual:window:list-detached');
      ipcMain.removeHandler('vibisual:window:has-tab');
      ipcMain.removeHandler('vibisual:window:cursor-screen');
      ipcMain.removeHandler('vibisual:window:main-bounds');
      ipcMain.removeHandler('vibisual:window:redock-drag');
      ipcMain.removeHandler('vibisual:window:redock-commit');
      ipcMain.removeHandler('vibisual:window:detach-drag-start');
      ipcMain.removeHandler('vibisual:window:detach-drag-end');
      ipcMain.removeHandler('vibisual:update:check');
      ipcMain.removeHandler('vibisual:update:install');
      ipcMain.removeHandler('vibisual:update:get-state');
      shutdownIframeLogStreamer();
      shutdownServerLogService();
      connections.clear();
    },
  };
}
