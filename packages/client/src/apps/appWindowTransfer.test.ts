import { afterEach, describe, expect, it, vi } from 'vitest';

import { finishAppWindowTransfer, prepareAppWindowTransfer, registerAppWindowTransferGuard, trackAppWindowTargetUpdate } from './appWindowTransfer.js';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

describe('app window transfer preparation', () => {
  it('holds a releasing guard through handoff, rejects concurrent preparation and resumes on cancellation', async () => {
    const release = vi.fn(); const prepare = vi.fn(async () => true); const id = 'held-transfer';
    cleanups.push(registerAppWindowTransferGuard(id, prepare, release));
    expect(await prepareAppWindowTransfer(id)).toBe(true);
    expect(await prepareAppWindowTransfer(id)).toBe(false);
    expect(prepare).toHaveBeenCalledOnce(); expect(release).not.toHaveBeenCalled();
    finishAppWindowTransfer(id); expect(release).toHaveBeenCalledOnce();
    expect(await prepareAppWindowTransfer(id)).toBe(true);
    finishAppWindowTransfer(id); expect(release).toHaveBeenCalledTimes(2);
  });
  it('keeps successful teardown frozen until unregistration, then releases exactly once', async () => {
    const release = vi.fn(); const id = 'successful-handoff';
    const unregister = registerAppWindowTransferGuard(id, async () => true, release); cleanups.push(unregister);
    expect(await prepareAppWindowTransfer(id)).toBe(true);
    finishAppWindowTransfer(id, true); expect(release).not.toHaveBeenCalled();
    unregister(); unregister(); expect(release).toHaveBeenCalledOnce();
  });
  it.each(['refused', 'throw', 'target'] as const)('releases a quiesced editor after %s preparation failure', async failure => {
    const release = vi.fn(); const id = `release-${failure}`;
    cleanups.push(registerAppWindowTransferGuard(id, async () => {
      if (failure === 'throw') throw new Error('failed');
      if (failure === 'target') trackAppWindowTargetUpdate(id, Promise.reject(new Error('IPC unavailable')));
      return failure !== 'refused';
    }, release));
    expect(await prepareAppWindowTransfer(id)).toBe(false); expect(release).toHaveBeenCalledOnce();
  });
  it('allows a window with no pending work to move', async () => {
    expect(await prepareAppWindowTransfer('no-pending-work')).toBe(true);
  });

  it.each(['refused', 'rejected'] as const)('blocks a transfer when saving is %s', async (failure) => {
    const id = `guard-${failure}`;
    cleanups.push(registerAppWindowTransferGuard(id, async () => {
      if (failure === 'rejected') throw new Error('Save failed');
      return false;
    }));
    expect(await prepareAppWindowTransfer(id)).toBe(false);
  });

  it('waits for the target published by the save guard before moving', async () => {
    const id = 'saved-target';
    const save = deferred<boolean>();
    const target = deferred<unknown>();
    trackAppWindowTargetUpdate(id, Promise.resolve());
    cleanups.push(registerAppWindowTransferGuard(id, async () => {
      await save.promise;
      trackAppWindowTargetUpdate(id, target.promise);
      return true;
    }));
    const settled = vi.fn();
    const pending = prepareAppWindowTransfer(id).then(result => { settled(result); return result; });
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    save.resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    target.resolve(true);
    expect(await pending).toBe(true);
    expect(settled).toHaveBeenCalledWith(true);
  });

  it('blocks a failed target update until a successful replacement is published', async () => {
    const id = 'failed-target';
    trackAppWindowTargetUpdate(id, Promise.reject(new Error('Target IPC failed')));
    expect(await prepareAppWindowTransfer(id)).toBe(false);
    expect(await prepareAppWindowTransfer(id)).toBe(false);

    trackAppWindowTargetUpdate(id, Promise.resolve(true));
    expect(await prepareAppWindowTransfer(id)).toBe(true);
  });

  it('also waits for a newer target published while the previous acknowledgement is pending', async () => {
    const id = 'target-changed-while-awaiting';
    const first = deferred<unknown>();
    const latest = deferred<unknown>();
    trackAppWindowTargetUpdate(id, first.promise);
    const done = vi.fn();
    const pending = prepareAppWindowTransfer(id).then(done);
    trackAppWindowTargetUpdate(id, latest.promise);
    first.resolve(true);
    await Promise.resolve(); await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    latest.resolve(true);
    await pending;
    expect(done).toHaveBeenCalledWith(true);
  });

  it('keeps a replacement guard when an older registration is cleaned up', async () => {
    const id = 'replaced-guard';
    const oldGuard = vi.fn(async () => true);
    const currentGuard = vi.fn(async () => false);
    const removeOld = registerAppWindowTransferGuard(id, oldGuard);
    const removeCurrent = registerAppWindowTransferGuard(id, currentGuard);
    cleanups.push(removeOld, removeCurrent);
    removeOld();

    expect(await prepareAppWindowTransfer(id)).toBe(false);
    expect(oldGuard).not.toHaveBeenCalled();
    expect(currentGuard).toHaveBeenCalledOnce();
    removeCurrent();
    expect(await prepareAppWindowTransfer(id)).toBe(true);
  });
});
