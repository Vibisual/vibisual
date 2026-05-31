import { contextBridge, ipcRenderer } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';
import type { UpdateState } from '@vibisual/shared';

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

// SCENARIO.md §5.4 #14-1 (v2.29) — 별창 detach/redock IPC surface.
export type DetachKindWire = 'project' | 'iframe';
export interface DetachedTabInfoWire {
  windowId: number;
  tabKey: string;
  kind: DetachKindWire;
}
export interface DetachPayloadWire {
  kind: DetachKindWire;
  tabKey: string;
  cursor?: { x: number; y: number };
}
export interface RectWire { x: number; y: number; width: number; height: number }
export interface PointWire { x: number; y: number }

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
  /** §5.4 #14-1 별창 surface. */
  window: {
    detach: (payload: DetachPayloadWire): Promise<{ windowId: number; reused: boolean }> =>
      ipcRenderer.invoke('vibisual:window:detach', payload),
    closeDetached: (tabKey: string): Promise<boolean> =>
      ipcRenderer.invoke('vibisual:window:close-detached', tabKey),
    closeSelf: (): Promise<boolean> => ipcRenderer.invoke('vibisual:window:close-self'),
    minimizeSelf: (): Promise<boolean> => ipcRenderer.invoke('vibisual:window:minimize-self'),
    toggleMaximizeSelf: (): Promise<boolean> =>
      ipcRenderer.invoke('vibisual:window:toggle-maximize-self'),
    /** main 이 maximize/unmaximize 시 푸시하는 자기 창의 최대화 상태 구독(아이콘 토글용). */
    onMaximizeState: (cb: (payload: { maximized: boolean }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { maximized: boolean }): void => cb(payload);
      ipcRenderer.on('vibisual:window:maximize-state', listener);
      return () => ipcRenderer.removeListener('vibisual:window:maximize-state', listener);
    },
    listDetached: (): Promise<DetachedTabInfoWire[]> =>
      ipcRenderer.invoke('vibisual:window:list-detached'),
    hasTab: (tabKey: string): Promise<boolean> =>
      ipcRenderer.invoke('vibisual:window:has-tab', tabKey),
    cursorScreen: (): Promise<PointWire> => ipcRenderer.invoke('vibisual:window:cursor-screen'),
    mainBounds: (): Promise<RectWire | null> =>
      ipcRenderer.invoke('vibisual:window:main-bounds'),
    redockDrag: (tabKey: string, hovering: boolean): Promise<void> =>
      ipcRenderer.invoke('vibisual:window:redock-drag', { tabKey, hovering }),
    redockCommit: (tabKey: string): Promise<boolean> =>
      ipcRenderer.invoke('vibisual:window:redock-commit', tabKey),
    /** 모든 창에 푸시되는 현재 detached 목록 — 메인 TabBar 가 그 키 숨김. */
    onDetachedList: (cb: (list: DetachedTabInfoWire[]) => void): (() => void) => {
      const listener = (_e: unknown, list: DetachedTabInfoWire[]): void => cb(list);
      ipcRenderer.on('vibisual:detached:list', listener);
      return () => ipcRenderer.removeListener('vibisual:detached:list', listener);
    },
    /** 별창에서 보낸 redock-drag 가 메인의 탭바 위에 있을 때 메인에 푸시. */
    onRedockHover: (cb: (payload: { tabKey: string; hovering: boolean }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { tabKey: string; hovering: boolean }): void => cb(payload);
      ipcRenderer.on('vibisual:tab:redock-hover', listener);
      return () => ipcRenderer.removeListener('vibisual:tab:redock-hover', listener);
    },
    /** 별창이 redock 확정 시 메인에 푸시 — 메인 TabBar 가 탭 재등장. */
    onRedockCommit: (cb: (payload: { tabKey: string; kind: DetachKindWire | null }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { tabKey: string; kind: DetachKindWire | null }): void => cb(payload);
      ipcRenderer.on('vibisual:tab:redock-commit', listener);
      return () => ipcRenderer.removeListener('vibisual:tab:redock-commit', listener);
    },
    // §5.4 #14-1 v2.30 — 별창 미니 타이틀바 드래그 시작/종료. 본체가 mini ghost 로 축소되어
    // cursor 따라가게 한다(main 의 windowManager 가 폴링).
    startDetachDrag: (): Promise<boolean> => ipcRenderer.invoke('vibisual:window:detach-drag-start'),
    endDetachDrag: (commit: boolean): Promise<boolean> =>
      ipcRenderer.invoke('vibisual:window:detach-drag-end', commit),
    /** main 의 polling 이 별창 자신에게 dragging/hovering 상태 변경을 푸시. */
    onDragState: (cb: (payload: { dragging: boolean; hovering: boolean }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { dragging: boolean; hovering: boolean }): void => cb(payload);
      ipcRenderer.on('vibisual:tab:redock-drag-state', listener);
      return () => ipcRenderer.removeListener('vibisual:tab:redock-drag-state', listener);
    },
  },
  /** §4 v2.44 자동 업데이트 surface — VS Code 식 업데이트 버튼. */
  update: {
    /** 수동 체크 트리거(부팅 직후·주기 체크는 main 이 자동). 갱신된 상태를 반환. */
    check: (): Promise<UpdateState> => ipcRenderer.invoke('vibisual:update:check'),
    /** 다운로드 완료 상태에서 재시작+설치. true=실행됨. */
    install: (): Promise<boolean> => ipcRenderer.invoke('vibisual:update:install'),
    /** 현재 업데이트 상태 1회 조회(마운트 시 초기값 채우기). */
    getState: (): Promise<UpdateState> => ipcRenderer.invoke('vibisual:update:get-state'),
    /** main 이 푸시하는 업데이트 상태 구독 — checking/available/downloading/downloaded/error. */
    onStatus: (cb: (state: UpdateState) => void): (() => void) => {
      const listener = (_e: unknown, state: UpdateState): void => cb(state);
      ipcRenderer.on('vibisual:update:status', listener);
      return () => ipcRenderer.removeListener('vibisual:update:status', listener);
    },
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
