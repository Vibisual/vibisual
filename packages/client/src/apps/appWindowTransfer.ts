type Prepare = () => Promise<boolean>;
const guards = new Map<string, Prepare>();
const updates = new Map<string, Promise<unknown>>();

export function registerAppWindowTransferGuard(id: string, prepare: Prepare): () => void {
  guards.set(id, prepare);
  return () => { if (guards.get(id) === prepare) guards.delete(id); };
}

export function trackAppWindowTargetUpdate(id: string, update: Promise<unknown>): void {
  updates.set(id, update);
  // Keep failures observable to the next transfer without an unhandled rejection.
  void update.catch(() => undefined);
}

export async function prepareAppWindowTransfer(id: string): Promise<boolean> {
  try {
    if (guards.has(id) && !await guards.get(id)!()) return false;
    let pending: Promise<unknown> | undefined;
    do {
      pending = updates.get(id);
      await pending;
    } while (pending !== updates.get(id));
    return true;
  } catch { return false; }
}
