import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { broadcastWindowMessage } from './windowDelivery';

function recipient(windowDestroyed = false, contentsDestroyed = false): {
  isDestroyed: () => boolean;
  webContents: { isDestroyed: () => boolean; send: Mock<(channel: string, payload: unknown) => void> };
} {
  return {
    isDestroyed: () => windowDestroyed,
    webContents: { isDestroyed: () => contentsDestroyed, send: vi.fn() },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('window notification delivery', () => {
  it('skips closed windows before touching their webContents', () => {
    const closed = { isDestroyed: (): boolean => true, get webContents(): never { throw new Error('Object has been destroyed'); } };
    const alive = recipient();
    expect(() => broadcastWindowMessage([closed, alive], 'list', ['한국어 😀'])).not.toThrow();
    expect(alive.webContents.send).toHaveBeenCalledWith('list', ['한국어 😀']);
  });

  it('skips destroyed webContents even while their window is alive', () => {
    const tornDown = recipient(false, true);
    const alive = recipient();
    broadcastWindowMessage([tornDown, alive], 'list', []);
    expect(tornDown.webContents.send).not.toHaveBeenCalled();
    expect(alive.webContents.send).toHaveBeenCalledOnce();
  });

  it('continues after native accessor or send failures, including a broken diagnostic output', () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => { throw new Error('closed stderr'); });
    const detached = { isDestroyed: (): boolean => false, get webContents(): never { throw new Error('native teardown'); } };
    const broken = recipient();
    broken.webContents.send.mockImplementation(() => { throw new Error('Object has been destroyed'); });
    const alive = recipient();
    expect(() => broadcastWindowMessage([detached, broken, alive], 'list', { value: 'literal <>&' })).not.toThrow();
    expect(log).toHaveBeenCalledTimes(2);
    expect(alive.webContents.send).toHaveBeenCalledWith('list', { value: 'literal <>&' });
  });
});
