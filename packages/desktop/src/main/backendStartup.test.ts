import { describe, expect, it, vi } from 'vitest';
import { startBackendBeforeWindow } from './backendStartup';

function harness() {
  return { boot: vi.fn(async () => {}), openApp: vi.fn(), askRestart: vi.fn(async () => false),
    relaunch: vi.fn(), quit: vi.fn(), reportError: vi.fn() };
}

describe('desktop startup failure ownership', () => {
  it('opens the application only after backend startup resolves', async () => {
    const h = harness();
    let ready!: () => void;
    h.boot.mockImplementationOnce(() => new Promise<void>((resolve) => { ready = resolve; }));
    const startup = startBackendBeforeWindow(h);
    expect(h.openApp).not.toHaveBeenCalled();
    ready();
    await startup;
    expect(h.openApp).toHaveBeenCalledOnce();
    expect(h.askRestart).not.toHaveBeenCalled();
    expect(h.quit).not.toHaveBeenCalled();
  });

  it.each([false, true])('does not open a disconnected application after boot failure; restart choice=%s', async (restart) => {
    const h = harness();
    const error = new Error('injected boot failure');
    h.boot.mockRejectedValueOnce(error);
    h.askRestart.mockResolvedValueOnce(restart);
    await startBackendBeforeWindow(h);
    expect(h.openApp).not.toHaveBeenCalled();
    expect(h.reportError).toHaveBeenCalledWith(error);
    expect(h.askRestart).toHaveBeenCalledOnce();
    expect(h.relaunch).toHaveBeenCalledTimes(restart ? 1 : 0);
    expect(h.quit).toHaveBeenCalledOnce();
    expect(h.boot).toHaveBeenCalledOnce();
  });

  it('handles a synchronous boot exception and a failed native recovery dialog', async () => {
    const h = harness();
    h.boot.mockImplementationOnce(() => { throw new Error('sync boot error'); });
    h.askRestart.mockRejectedValueOnce(new Error('dialog unavailable'));
    await startBackendBeforeWindow(h);
    expect(h.openApp).not.toHaveBeenCalled();
    expect(h.relaunch).not.toHaveBeenCalled();
    expect(h.reportError).toHaveBeenCalledTimes(2);
    expect(h.quit).toHaveBeenCalledOnce();
  });
});
