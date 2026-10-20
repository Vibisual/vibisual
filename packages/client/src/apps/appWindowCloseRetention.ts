import { useEffect, useRef } from 'react';
import { confirmAppWindowClose, DETACHED_APP_WINDOW } from './appWindowCloseGuard.js';
import { useAppWindowsStore } from './appWindows.js';

type Retain = () => boolean;
const retainers = new Map<string, Retain>();
const pending = new Map<string, Promise<boolean>>();

/** The document owner may outlive the person's view of its window. */
export function registerAppWindowCloseRetention(id: string, retain: Retain): () => void {
  retainers.set(id, retain);
  return () => { if (retainers.get(id) === retain) retainers.delete(id); };
}

export function isAppWindowCloseRetained(id: string): boolean {
  return retainers.get(id)?.() ?? false;
}

/** Ask about human edits first, then hide a retained editor without saving or unmounting it. */
export function requestAppWindowClose(id: string, close: () => unknown): Promise<boolean> {
  const current = pending.get(id);
  if (current) return current;
  const operation = (async () => {
    try {
      if (!await confirmAppWindowClose(id)) return false;
      if (isAppWindowCloseRetained(id)) {
        if (id === DETACHED_APP_WINDOW) return await window.api?.app?.hideSelf?.() === true;
        const store = useAppWindowsStore.getState();
        if (!store.windows.some(win => win.id === id)) return false;
        store.hide(id);
      } else await close();
      return true;
    } catch { return false; }
  })();
  pending.set(id, operation);
  void operation.finally(() => { if (pending.get(id) === operation) pending.delete(id); });
  return operation;
}

export function useAppWindowCloseRetention(params: Readonly<Record<string, string>>, retain: Retain): void {
  const latest = useRef(retain); latest.current = retain;
  const nativeRetention = useRef<boolean>();
  const id = params['appWindowId'] || DETACHED_APP_WINDOW;
  useEffect(() => {
    const unregister = registerAppWindowCloseRetention(id, () => latest.current());
    return () => {
      unregister();
      nativeRetention.current = undefined;
      if (id === DETACHED_APP_WINDOW) void window.api?.app?.setCloseRetention?.(false).catch(() => undefined);
    };
  }, [id]);
  // The callback reads imperative editor refs, which can change while keeping the same window id.
  useEffect(() => {
    const api = window.api?.app;
    if (id !== DETACHED_APP_WINDOW || !api?.setCloseRetention) return;
    const retained = latest.current();
    if (nativeRetention.current === retained) return;
    nativeRetention.current = retained;
    void api.setCloseRetention(retained).then(ok => {
      if (!ok && nativeRetention.current === retained) nativeRetention.current = undefined;
    }).catch(() => { if (nativeRetention.current === retained) nativeRetention.current = undefined; });
  });
}
