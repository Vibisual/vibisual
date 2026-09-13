import { useEffect } from 'react';
import { create } from 'zustand';
import type { ProviderUsage } from '@vibisual/shared';
const useUsageStore = create<{ usage: ProviderUsage | null; busy: boolean }>(() => ({ usage: null, busy: false }));
let inflight: Promise<void> | null = null;
export function refreshCodexUsage(): Promise<void> {
  if (inflight) return inflight;
  useUsageStore.setState({ busy: true });
  inflight = (async () => {
    try {
      const response = await fetch('/api/codex-usage');
      if (!response.ok) throw new Error('usage');
      useUsageStore.setState({ usage: await response.json() });
    } catch { useUsageStore.setState({ usage: { windows: [], fetchedAt: Date.now(), error: 'unavailable' } }); }
    finally { useUsageStore.setState({ busy: false }); inflight = null; }
  })();
  return inflight;
}
export function useCodexUsage(enabled: boolean): ReturnType<typeof useUsageStore.getState> {
  const state = useUsageStore();
  useEffect(() => {
    if (!enabled) return;
    void refreshCodexUsage();
    const timer = setInterval(() => { void refreshCodexUsage(); }, 60_000);
    return () => clearInterval(timer);
  }, [enabled]);
  return state;
}
