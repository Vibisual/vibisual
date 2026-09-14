import { useEffect } from 'react';
import { create } from 'zustand';
import type { ProviderUsage } from '@vibisual/shared';
const useUsageStore = create<{ usage: ProviderUsage | null; busy: boolean }>(() => ({ usage: null, busy: false }));
let inflight: Promise<void> | null = null;
/** Keep the last successful measurement (including its timestamp) on transient failures. */
export function reconcileCodexUsage(previous: ProviderUsage | null, incoming: ProviderUsage): ProviderUsage {
  if (incoming.error && incoming.windows.length === 0 && previous?.windows.length) {
    return { ...previous, error: incoming.error };
  }
  // RPC object insertion order is not a display order. Keep each bucket's primary/secondary together.
  return { ...incoming, windows: [...incoming.windows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) };
}
export function refreshCodexUsage(): Promise<void> {
  if (inflight) return inflight;
  useUsageStore.setState({ busy: true });
  inflight = (async () => {
    try {
      const response = await fetch('/api/codex-usage');
      if (!response.ok) throw new Error('usage');
      const incoming = await response.json() as ProviderUsage;
      useUsageStore.setState(state => ({ usage: reconcileCodexUsage(state.usage, incoming) }));
    } catch {
      useUsageStore.setState(state => ({ usage: reconcileCodexUsage(state.usage, { windows: [], fetchedAt: Date.now(), error: 'unavailable' }) }));
    }
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
