import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmAppWindowClose, registerAppWindowCloseGuard } from './appWindowCloseGuard.js';

const dispose: Array<() => void> = [];
afterEach(() => { for (const off of dispose.splice(0)) off(); });
function guard(id: string, fn: () => boolean | Promise<boolean>): void {
  dispose.push(registerAppWindowCloseGuard(id, fn));
}
function deferred() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('app window close confirmation', () => {
  it('allows clean windows and stops at a refusing guard', async () => {
    expect(await confirmAppWindowClose('clean')).toBe(true);
    const last = vi.fn(() => true);
    guard('dirty', () => false); guard('dirty', last);
    expect(await confirmAppWindowClose('dirty')).toBe(false);
    expect(last).not.toHaveBeenCalled();
  });

  it('awaits the designed popup and shares repeat close requests until it is answered', async () => {
    const answer = deferred(); const ask = vi.fn(() => answer.promise);
    guard('pending', ask);
    const first = confirmAppWindowClose('pending');
    const repeat = confirmAppWindowClose('pending');
    expect(first).toBe(repeat); expect(ask).toHaveBeenCalledOnce();
    const done = vi.fn(); void first.then(done);
    await Promise.resolve(); expect(done).not.toHaveBeenCalled();
    answer.resolve(false); expect(await first).toBe(false);
    expect(await confirmAppWindowClose('pending')).toBe(false);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('does not apply a discard answer to a replaced editor or a removed guard', async () => {
    const answer = deferred();
    const off = registerAppWindowCloseGuard('replaced', () => answer.promise);
    const pending = confirmAppWindowClose('replaced');
    off(); guard('replaced', () => true);
    answer.resolve(true);
    expect(await pending).toBe(false);
  });

  it('fails closed on exceptions and keeps other windows independent', async () => {
    guard('failed', async () => { throw new Error('editor unavailable'); });
    expect(await confirmAppWindowClose('failed')).toBe(false);
    expect(await confirmAppWindowClose('other')).toBe(true);
  });
});
