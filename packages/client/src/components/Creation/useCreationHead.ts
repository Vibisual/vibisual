import { useEffect, useState } from 'react';
import type { CreationHead } from '@vibisual/shared';
import { readCreationHead } from './creationApi.js';

export const CREATION_HEAD_POLL_MS = 2_000;

export function sameCreationHead(a: CreationHead | null, b: CreationHead | null): boolean {
  return !!a && !!b && a.id === b.id && a.revision === b.revision && a.candidateStamp === b.candidateStamp
    && a.pendingCandidates === b.pendingCandidates && a.updatedAt === b.updatedAt;
}
function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/**
 * §5.13 (R-10) — the only poll an editable-source screen runs (revision + candidate stamp), only while `enabled` and the window is visible.
 * Returns a new object only on a real change, so consumers re-read the document or candidates only then.
 */
export function useCreationHead(
  projectId: string, docId: string | null | undefined, options: { enabled?: boolean; intervalMs?: number } = {},
): CreationHead | null {
  const { enabled = true, intervalMs = CREATION_HEAD_POLL_MS } = options;
  const [state, setState] = useState<{ key: string; head: CreationHead | null }>({ key: '', head: null });
  const key = `${projectId}\u0000${docId ?? ''}`;
  useEffect(() => {
    if (!projectId || !docId || !enabled) return undefined;
    let stopped = false;
    let pending = false;
    const tick = async (): Promise<void> => {
      if (stopped || pending || pageHidden()) return;
      pending = true;
      try {
        const head = await readCreationHead(projectId, docId);
        if (!stopped) setState((previous) => previous.key === key && sameCreationHead(previous.head, head) ? previous : { key, head });
      } catch { /* A failed poll keeps the last good head; explicit actions report errors. */ }
      finally { pending = false; }
    };
    void tick();
    const timer = setInterval(() => { void tick(); }, intervalMs);
    const onVisible = (): void => { if (!pageHidden()) void tick(); };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  }, [projectId, docId, enabled, intervalMs, key]);
  return state.key === key ? state.head : null;
}
