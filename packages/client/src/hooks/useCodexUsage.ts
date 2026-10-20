import { useEffect } from 'react';
import { create } from 'zustand';
import type { CodexAuthStatus, ProviderUsage } from '@vibisual/shared';
const useUsageStore = create<{ usage: ProviderUsage | null; busy: boolean; scope: string }>(() => ({ usage: null, busy: false, scope: 'unknown' }));
let inflight: Promise<void> | null = null;
let activeScope = 'unknown';
let generation = 0;

function accountScope(auth: CodexAuthStatus | null): string {
  // Named accounts survive routine status polls; unnamed accounts must use the auth revision.
  return auth?.error ? activeScope : !auth ? 'unknown' : !auth.loggedIn ? 'logged-out'
    : JSON.stringify([auth.authMethod, auth.account || auth.checkedAt]);
}

function synchronizeAccount(scope: string): void {
  if (scope === activeScope) return;
  activeScope = scope;
  generation += 1;
  inflight = null;
  useUsageStore.setState({ usage: null, busy: false, scope });
}
/** Keep the last successful measurement (including its timestamp) on transient failures. */
export function reconcileCodexUsage(previous: ProviderUsage | null, incoming: ProviderUsage): ProviderUsage {
  const incomingHasMeasurements = incoming.windows.length > 0 || incoming.credits !== undefined || incoming.resetCredits !== undefined;
  const previousHasMeasurements = previous && (previous.windows.length > 0 || previous.credits !== undefined || previous.resetCredits !== undefined);
  if (incoming.error && !incomingHasMeasurements && previousHasMeasurements) {
    return { ...previous, error: incoming.error };
  }
  // RPC object insertion order is not a display order. Keep each bucket's primary/secondary together.
  return { ...incoming, windows: [...incoming.windows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) };
}
export function refreshCodexUsage(): Promise<void> {
  if (inflight) return inflight;
  const requestGeneration = generation;
  useUsageStore.setState({ busy: true });
  inflight = (async () => {
    try {
      const response = await fetch('/api/codex-usage');
      if (!response.ok) throw new Error('usage');
      const incoming = await response.json() as ProviderUsage;
      if (requestGeneration !== generation) return;
      useUsageStore.setState(state => ({ usage: reconcileCodexUsage(state.usage, incoming) }));
    } catch {
      if (requestGeneration !== generation) return;
      useUsageStore.setState(state => ({ usage: reconcileCodexUsage(state.usage, { windows: [], fetchedAt: Date.now(), error: 'unavailable' }) }));
    }
    finally {
      if (requestGeneration === generation) { useUsageStore.setState({ busy: false }); inflight = null; }
    }
  })();
  return inflight;
}
export function useCodexUsage(enabled: boolean, auth: CodexAuthStatus | null): ReturnType<typeof useUsageStore.getState> {
  const state = useUsageStore();
  const scope = accountScope(auth);
  useEffect(() => {
    synchronizeAccount(scope);
    if (!enabled) return;
    void refreshCodexUsage();
    const timer = setInterval(() => { void refreshCodexUsage(); }, 60_000);
    return () => clearInterval(timer);
  }, [enabled, scope]);
  // Mask the old balance immediately on render, before the account-change effect commits.
  return state.scope === scope ? state : { usage: null, busy: false, scope };
}
