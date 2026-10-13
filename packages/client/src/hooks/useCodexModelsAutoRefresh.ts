import { useEffect } from 'react';
import { CODEX_MODELS_REFRESH_INTERVAL_MS } from '@vibisual/shared';
import { useGraphStore } from '../stores/graphStore.js';

/** One main-window subscription; server TTL coalesces focus, dialogs and other windows. */
export function useCodexModelsAutoRefresh(): void {
  const ready = useGraphStore((state) => state.codexSetup?.phase === 'ready');
  const refresh = useGraphStore((state) => state.refreshCodexModels);
  useEffect(() => {
    if (!ready) return;
    const refreshVisible = (): void => {
      if (!document.hidden) void refresh(false);
    };
    refreshVisible();
    const timer = window.setInterval(refreshVisible, CODEX_MODELS_REFRESH_INTERVAL_MS);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [ready, refresh]);
}
