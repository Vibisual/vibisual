import { useEffect } from 'react';
import { openAppWindow } from './appWindows.js';
import { getInternalApp } from './registry.js';
import type { PackagedAppApi } from '../transport/install-packaged-transport.js';

export function receiveAppWindow(api: PackagedAppApi, payload: Parameters<Parameters<NonNullable<PackagedAppApi['onRedock']>>[0]>[0]): boolean {
  const app = getInternalApp(payload.appId);
  const projectId = payload.params['projectId'];
  if (!app || !projectId || !api.ackRedock) return false;
  const opened = openAppWindow({
    appId: app.id, projectId, ref: payload.params[app.refKey], file: payload.params['file'],
    title: payload.params['_windowTitle'], geometry: payload.geometry,
  });
  if (opened) void api.ackRedock(payload.requestId).catch(() => undefined);
  return opened;
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

export function useAppWindowRedock(): void {
  useEffect(() => {
    const api = window.api?.app;
    if (!api?.onRedock) return;
    const off = api.onRedock(payload => { receiveAppWindow(api, payload); });
    const offDrag = subscribeAppWindowDragRelease(api);
    return () => { off(); offDrag(); };
  }, []);
}
