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
  });

  return {
    stop(): void {
      ipcMain.removeHandler('vibisual:server-info');
      ipcMain.removeHandler('vibisual:fetch');
      ipcMain.removeHandler('vibisual:send');
      ipcMain.removeHandler('vibisual:ws-connect');
      shutdownIframeLogStreamer();
      shutdownServerLogService();
      connections.clear();
    },
  };
}
