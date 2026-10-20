import { describe, expect, it, vi } from 'vitest';
import { createQuitConfirmationGate } from './quitConfirmation';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred() { let resolve!: (answer: boolean) => void; const promise = new Promise<boolean>((done) => { resolve = done; }); return { promise, resolve }; }

describe('asynchronous quit confirmation', () => {
  it('coalesces repeated close requests and continues exactly once after acceptance', async () => {
    const pending = deferred(); const ask = vi.fn(() => pending.promise);
    const accepted = vi.fn(); const failed = vi.fn(); const gate = createQuitConfirmationGate();
    gate.request(ask, accepted, failed); gate.request(ask, accepted, failed);
    await settle(); expect(ask).toHaveBeenCalledOnce(); expect(accepted).not.toHaveBeenCalled();
    pending.resolve(true); await settle();
    expect(accepted).toHaveBeenCalledOnce(); expect(failed).not.toHaveBeenCalled();
  });

  it('keeps the app alive on cancel or failed dialog and permits a later retry', async () => {
    const ask = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('renderer unavailable')).mockResolvedValueOnce(true);
    const accepted = vi.fn(); const failed = vi.fn(); const gate = createQuitConfirmationGate();
    gate.request(ask, accepted, failed); await settle(); expect(accepted).not.toHaveBeenCalled();
    gate.request(ask, accepted, failed); await settle(); expect(accepted).not.toHaveBeenCalled(); expect(failed).toHaveBeenCalledOnce();
    gate.request(ask, accepted, failed); await settle(); expect(accepted).toHaveBeenCalledOnce();
  });
});
