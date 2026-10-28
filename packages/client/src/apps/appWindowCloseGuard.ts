import { useEffect, useRef } from 'react';

/**
 * §5.13 (R-10) — unsaved-changes guard for user-initiated closes (title-bar close, Escape, OS close button): closing asks every guard
 * of that window and stops on a no. Programmatic moves in/out do not ask — their transfer guard saves first.
 */
type Guard = () => boolean | Promise<boolean>;
const guards = new Map<string, Set<Guard>>();
const pending = new Map<string, Promise<boolean>>();
/** The id a shell running in its own OS window registers under (that renderer hosts one app). */
export const DETACHED_APP_WINDOW = '@detached';

export function registerAppWindowCloseGuard(windowId: string, guard: Guard): () => void {
  let set = guards.get(windowId);
  if (!set) { set = new Set(); guards.set(windowId, set); }
  set.add(guard);
  return () => {
    const current = guards.get(windowId);
    current?.delete(guard);
    if (current && current.size === 0) guards.delete(windowId);
  };
}
/** True when the window may close now (no guard, or every guard agreed). */
export function confirmAppWindowClose(windowId: string): Promise<boolean> {
  const existing = pending.get(windowId);
  if (existing) return existing;
  const snapshot = [...guards.get(windowId) ?? []];
  const confirmation = (async () => {
    try {
      for (const guard of snapshot) {
        if (!await guard()) return false;
      }
      // A replaced/unmounted editor must never inherit another editor's discard answer.
      const current = guards.get(windowId);
      return snapshot.length === (current?.size ?? 0) && snapshot.every((guard) => current?.has(guard));
    } catch { return false; }
  })();
  pending.set(windowId, confirmation);
  void confirmation.finally(() => { if (pending.get(windowId) === confirmation) pending.delete(windowId); });
  return confirmation;
}
export function useAppWindowCloseGuard(params: Readonly<Record<string, string>>, guard: Guard): void {
  const latest = useRef(guard);
  latest.current = guard;
  const id = params['appWindowId'] || DETACHED_APP_WINDOW;
  useEffect(() => registerAppWindowCloseGuard(id, () => latest.current()), [id]);
}
