import { contextBridge, ipcRenderer } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';

// Preload — SCENARIO.md §3.7 / §3.4 contextBridge surface.
//
// renderer 의 transport 어댑터(install-packaged-transport.ts)가 global fetch + WebSocket 을
// 이 채널들로 monkey-patch 한다(window.api 존재 시). UI 소스는 손대지 않는다.

export interface FetchInitWire {
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
  /** `body` 가 base64 인코딩 바이너리(FormData/Blob 등)임을 표시 — multipart 업로드 경로. */
  bodyEncoding?: 'base64';
}

export interface FetchResponseWire {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  /** `body` 가 base64 인코딩 바이너리임을 표시 — 비텍스트 응답(이미지 등) 무손실 전달. */
  bodyEncoding?: 'base64';
}

export interface ServerInfo {
  port: number;
  running: boolean;
}

const api = {
  serverInfo: (): Promise<ServerInfo> => ipcRenderer.invoke('vibisual:server-info'),
  request: (path: string, init?: FetchInitWire): Promise<FetchResponseWire> =>
    ipcRenderer.invoke('vibisual:fetch', path, init),
  send: (message: unknown): Promise<void> => ipcRenderer.invoke('vibisual:send', message),
  /** IpcWebSocket 생성 시 호출 → main 이 초기 connection_ack + graph_snapshot 을 푸시한다. */
  connect: (): Promise<void> => ipcRenderer.invoke('vibisual:ws-connect'),
  onMessage: (cb: (payload: unknown) => void): (() => void) => {
    const listener = (_e: unknown, payload: unknown): void => cb(payload);
    ipcRenderer.on('vibisual:ws', listener);
    return () => ipcRenderer.removeListener('vibisual:ws', listener);
  },
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error('[preload] contextBridge expose failed', error);
  }
} else {
  console.error('[preload] contextIsolation is OFF — refusing to expose api (security invariant).');
}

export type DesktopApi = typeof api;
