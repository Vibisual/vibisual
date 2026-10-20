import { useEffect, useRef } from 'react';
import { selectShellImmersive, useProjectImmersionStore } from '../stores/projectImmersion.js';

/** React chrome alone cannot hide Electron's OS-owned titleBarOverlay controls. */
export function useImmersiveWindow(immersive: boolean): void {
  const pending = useRef(false);
  const requestVersion = useRef(0);
  const nativeState = useRef<boolean | undefined>(undefined);
  const browser = useRef<ReturnType<typeof createBrowserImmersion> | null>(null);

  useEffect(() => {
    const api = window.api?.window;
    if (!api?.setImmersiveSelf) return;
    const off = api.onImmersiveState?.((state) => {
      nativeState.current = state.immersive;
      // Native requests can finish asynchronously (macOS). Old replies cannot cancel a newer entry.
      if (!state.immersive && !pending.current && selectShellImmersive(useProjectImmersionStore.getState())) {
        useProjectImmersionStore.getState().exit();
      }
    });
    return () => {
      off?.();
      requestVersion.current += 1;
      void api.setImmersiveSelf?.(false).catch((error: unknown) => console.warn('Could not restore immersive window', error));
    };
  }, []);

  useEffect(() => {
    const api = window.api?.window;
    if (!api?.setImmersiveSelf) return;
    const version = ++requestVersion.current;
    nativeState.current = undefined;
    pending.current = true;
    void api.setImmersiveSelf(immersive).catch((error: unknown) => {
      console.warn('Could not change immersive window', error);
      if (version === requestVersion.current && immersive) useProjectImmersionStore.getState().exit();
    }).finally(() => {
      if (version === requestVersion.current) {
        pending.current = false;
        // An external native exit can also cancel an entry that was still pending.
        if (immersive && nativeState.current === false) useProjectImmersionStore.getState().exit();
      }
    });
  }, [immersive]);

  useEffect(() => {
    if (window.api?.window?.setImmersiveSelf || typeof document === 'undefined') return;
    const controller = createBrowserImmersion();
    browser.current = controller;
    return () => { browser.current = null; controller.dispose(); };
  }, []);

  useEffect(() => {
    browser.current?.setEnabled(immersive);
  }, [immersive]);
}

/** Keep ownership across async requests, including exit/re-entry before the first request resolves. */
function createBrowserImmersion(): { setEnabled(enabled: boolean): void; dispose(): void } {
  const root = document.documentElement;
  let desired = false;
  let owned = false;
  let transition: boolean | null = null;
  let disposed = false;
  let version = 0;
  const reconcile = (): void => {
    if (transition !== null) return;
    let operation: Promise<void>;
    if (desired && !document.fullscreenElement && root.requestFullscreen) {
      owned = true;
      transition = true;
      operation = root.requestFullscreen();
    } else if (!desired && owned && document.fullscreenElement === root) {
      transition = false;
      operation = document.exitFullscreen();
    } else {
      if (!desired) owned = false;
      return;
    }
    const operationVersion = version;
    void operation.catch((error: unknown) => {
      if (operationVersion !== version) return;
      console.warn('Could not change browser fullscreen', error);
      desired = false;
      owned = false;
      if (!disposed) useProjectImmersionStore.getState().exit();
    }).finally(() => {
      transition = null;
      reconcile();
    });
  };
  const onChange = (): void => {
    // An expected exit may have a new entry queued; only an external exit cancels it.
    if (!document.fullscreenElement && transition !== false && desired) {
      desired = false;
      if (!disposed) useProjectImmersionStore.getState().exit();
    }
  };
  document.addEventListener('fullscreenchange', onChange);
  return {
    setEnabled(enabled): void { version += 1; desired = enabled; reconcile(); },
    dispose(): void {
      disposed = true;
      document.removeEventListener('fullscreenchange', onChange);
      desired = false;
      reconcile();
    },
  };
}
