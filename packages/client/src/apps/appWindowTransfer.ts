type Prepare = () => Promise<boolean>;
interface Guard { prepare: Prepare; release?: () => void }
const guards = new Map<string, Guard>();
const active = new Map<string, Guard>();
const updates = new Map<string, Promise<unknown>>();

/** A mounted shell must have registered before a task can snapshot its live edits. */
export function hasAppWindowTransferGuard(id: string): boolean { return guards.has(id); }

export function registerAppWindowTransferGuard(id: string, prepare: Prepare, release?: () => void): () => void {
  const guard = { prepare, release }; guards.set(id, guard);
  return () => {
    if (guards.get(id) === guard) guards.delete(id);
    if (active.get(id) === guard) { active.delete(id); guard.release?.(); }
  };
}

/** Successful ownership handoff stays frozen until the old shell unmounts. Failed/cancelled moves resume it. */
export function finishAppWindowTransfer(id: string, transferred = false): void {
  const guard = active.get(id);
  if (!guard || transferred) return;
  active.delete(id); guard.release?.();
}

export function trackAppWindowTargetUpdate(id: string, update: Promise<unknown>): void {
  updates.set(id, update);
  // Keep failures observable to the next transfer without an unhandled rejection.
  void update.catch(() => undefined);
}

export async function prepareAppWindowTransfer(id: string): Promise<boolean> {
  if (active.has(id)) return false;
  const guard = guards.get(id);
  // Legacy guards need no lifetime hold; a releasing guard owns the whole handoff, not only its save.
  if (guard?.release) active.set(id, guard);
  let prepared = false;
  try {
    if (guard && !await guard.prepare()) return false;
    let pending: Promise<unknown> | undefined;
    do {
      pending = updates.get(id);
      await pending;
    } while (pending !== updates.get(id));
    prepared = true; return true;
  } catch { return false; }
  finally { if (!prepared && active.get(id) === guard) finishAppWindowTransfer(id); }
}
