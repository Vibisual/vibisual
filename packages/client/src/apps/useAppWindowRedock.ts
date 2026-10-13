import { useEffect } from 'react';
import { openAppWindow, useAppWindowsStore } from './appWindows.js';
import { outsideAppWindowsFrom } from './appWindowFocus.js';
import { getInternalApp } from './registry.js';
import type { AppWindowListWire, PackagedAppApi } from '../transport/install-packaged-transport.js';

export function receiveAppWindow(api: PackagedAppApi, payload: Parameters<Parameters<NonNullable<PackagedAppApi['onRedock']>>[0]>[0]): boolean {
  const app = getInternalApp(payload.appId);
  const projectId = payload.params['projectId'];
  if (!app || !projectId || !api.ackRedock) return false;
  // §5.13 (S-11) 되돌아오는 길 — 밖의 그 창은 닫히는 중인데 목록에는 아직 있다. 밖을 보면 자기 자신을 앞으로 세운다.
  const opened = openAppWindow({
    appId: app.id, projectId, ref: payload.params[app.refKey], file: payload.params['file'],
    title: payload.params['_windowTitle'], geometry: payload.geometry,
  }, { redock: true });
  if (opened) void api.ackRedock(payload.requestId).catch(() => undefined);
  return opened;
}

/**
 * §5.13 (S-11) — main 이 든 **밖에 떠 있는 앱 창** 목록을 이 창의 store 에 비춘다. 이 목록이 있어야 그 문서를 다시 열 때
 * 앱 안에 한 벌 더 세우지 않고 밖의 그 창을 앞으로 세운다(`openAppWindow`).
 *
 * 구독을 붙이기 전에 지나간 알림은 놓치므로 처음 한 번은 직접 묻는다(`useOverlaySync` 와 같은 보강). 그 답이 알림보다
 * 늦게 오면 옛것이라 버린다 — 늦은 답이 최신 목록을 덮으면 방금 닫힌 창을 "떠 있다"로 읽는다.
 */
export function subscribeOutsideAppWindows(api: PackagedAppApi): () => void {
  if (!api.onList) return () => undefined;
  const apply = (list: AppWindowListWire): void => {
    useAppWindowsStore.getState().setOutside(outsideAppWindowsFrom(list, (appId) => getInternalApp(appId)?.refKey ?? null));
  };
  let alive = true;
  let pushed = false;
  void api.list?.().then((list) => { if (alive && !pushed) apply(list); }, () => undefined);
  const off = api.onList((list) => {
    pushed = true;
    apply(list);
  });
  return () => { alive = false; off(); };
}

/** Both the source and destination listen for mouse release while a native ghost is visible. */
export function subscribeAppWindowDragRelease(api: PackagedAppApi): () => void {
  let active: string | null = null;
  const up = (event: MouseEvent): void => {
    if (active && event.button === 0) {
      const appId = active; active = null;
      void api.endDrag?.(undefined, appId).catch(() => undefined);
    }
  };
  const key = (event: KeyboardEvent): void => {
    if (active && event.key === 'Escape') {
      const appId = active; active = null;
      event.preventDefault();
      void api.endDrag?.(false, appId).catch(() => undefined);
    }
  };
  const off = api.onDragState?.(({ appId, dragging }) => {
    active = dragging ? appId : null;
  });
  window.addEventListener('mouseup', up, true);
  window.addEventListener('keydown', key, true);
  return () => {
    off?.();
    window.removeEventListener('mouseup', up, true);
    window.removeEventListener('keydown', key, true);
  };
}

/** 캔버스가 있는 창(본체·별창)이 앱 창 IPC 를 듣는 자리 — 되돌아오는 창 받기 · 끌기 뗌 · 밖의 창 목록(S-11). */
export function useAppWindowRedock(): void {
  useEffect(() => {
    const api = window.api?.app;
    if (!api?.onRedock) return;
    const off = api.onRedock(payload => { receiveAppWindow(api, payload); });
    const offDrag = subscribeAppWindowDragRelease(api);
    const offOutside = subscribeOutsideAppWindows(api);
    return () => { off(); offDrag(); offOutside(); };
  }, []);
}
