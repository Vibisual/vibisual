import { afterEach, describe, expect, it, vi } from 'vitest';
import { vibi3dCommandProgress } from './vibi3dCommandProgress.js';

afterEach(() => vi.useRealTimers());
describe('native command heartbeat', () => {
  it('sends monotonic progress outside the command queue and keeps a fixed deadline', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const sent: number[] = [];
    const context = vibi3dCommandProgress({ expiresAt: 8000, signal: new AbortController().signal,
      post: async value => { sent.push(value); }, finalError: () => false });
    await context.progress(0.3); await context.progress(0.1);
    expect(sent).toEqual([0.3]);
    await vi.advanceTimersByTimeAsync(5000); expect(sent).toEqual([0.3, 0.3]);
    await context.progress(0.7); await vi.advanceTimersByTimeAsync(2000);
    expect(context.assertActive).toThrow('command-expired'); context.dispose();
  });
  it('surfaces a final server rejection but tolerates a transient connection failure', async () => {
    let rejected = false;
    const context = vibi3dCommandProgress({ signal: new AbortController().signal,
      post: async () => { throw new Error(rejected ? 'command-not-pending' : 'offline'); }, finalError: error => (error as Error).message !== 'offline' });
    await context.progress(0); context.assertActive(); rejected = true;
    await expect(context.progress(1)).rejects.toThrow('command-not-pending');
    expect(context.assertActive).toThrow('command-not-pending'); context.dispose();
  });
});
