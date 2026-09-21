import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSnapshotBroadcastScheduler, type SnapshotBroadcastScheduler } from './snapshotBroadcastScheduler.js';

const schedulers: SnapshotBroadcastScheduler[] = [];
const defaults = { minDelayMs: 16, maxDelayMs: 250, backoffFactor: 2 };
let service: typeof import('./diagnosticService.js').diagnosticService;

beforeEach(async (): Promise<void> => {
  vi.resetModules();
  service = (await import('./diagnosticService.js')).diagnosticService;
});
afterEach((): void => {
  for (const scheduler of schedulers.splice(0)) scheduler.dispose();
  vi.useRealTimers();
});

function track(scheduler: SnapshotBroadcastScheduler): SnapshotBroadcastScheduler {
  schedulers.push(scheduler);
  return scheduler;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('snapshot notification scheduling', () => {
  it('contains the production microtask → timer → failure/diagnostic feedback chain', async (): Promise<void> => {
    // Use real Node timers/microtasks: a fake timer does not itself preserve AsyncLocalStorage.
    let firstFailure!: () => void;
    const failed = new Promise<void>((resolve) => { firstFailure = resolve; });
    let broken = true;
    const flush = vi.fn((): void => {
      service.record({ source: 'server', level: 'warn', message: 'performance sample' });
      setTimeout(() => service.record({ source: 'main', level: 'warn', message: 'late delivery diagnostic' }), 0);
      if (broken) throw new Error('destroyed renderer');
    });
    const scheduler = track(createSnapshotBroadcastScheduler({
      ...defaults, minDelayMs: 2, maxDelayMs: 2, flush,
      onError: (error: unknown): void => {
        service.record({ source: 'server', level: 'error', message: String(error) });
        firstFailure();
      },
    }));
    service.setOnChange(() => scheduler.requestDiagnostic());
    service.record({ source: 'server', level: 'error', message: 'initial error' });
    await failed;
    await pause(25);
    expect(flush).toHaveBeenCalledOnce();
    expect(service.getLog().map((entry) => entry.message)).toEqual([
      'initial error', 'performance sample', 'Error: destroyed renderer', 'late delivery diagnostic',
    ]);

    // A later ordinary graph mutation retries; diagnostics were retained for that snapshot.
    broken = false;
    scheduler.request();
    await pause(25);
    expect(flush).toHaveBeenCalledTimes(2);
    service.record({ source: 'server', level: 'error', message: 'independent later error' });
    await pause(25);
    expect(flush).toHaveBeenCalledTimes(3);
  });

  it('coalesces ordinary/diagnostic bursts and reads state when the timer actually flushes', async (): Promise<void> => {
    vi.useFakeTimers();
    let state = 'before';
    const received: string[] = [];
    const scheduler = track(createSnapshotBroadcastScheduler({
      ...defaults, flush: (): void => { received.push(state); }, onError: vi.fn(),
    }));
    scheduler.request();
    scheduler.requestDiagnostic();
    state = 'latest';
    scheduler.request();
    expect(received).toEqual([]);
    await vi.advanceTimersByTimeAsync(16);
    expect(received).toEqual(['latest']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not suppress an ordinary graph change originating during delivery', async (): Promise<void> => {
    vi.useFakeTimers();
    let calls = 0;
    const scheduler = track(createSnapshotBroadcastScheduler({
      ...defaults,
      flush: (): void => { if (++calls === 1) scheduler.request(); },
      onError: vi.fn(),
    }));
    scheduler.request();
    await vi.advanceTimersByTimeAsync(32);
    expect(calls).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains adaptive delay bounds after a slow flush', async (): Promise<void> => {
    vi.useFakeTimers();
    let now = 0;
    const flush = vi.fn((): void => { now += 100; });
    const scheduler = track(createSnapshotBroadcastScheduler({ ...defaults, flush, onError: vi.fn(), now: () => now }));
    scheduler.request();
    await vi.advanceTimersByTimeAsync(16);
    scheduler.request();
    await vi.advanceTimersByTimeAsync(199);
    expect(flush).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(flush).toHaveBeenCalledTimes(2);
    flush.mockImplementation((): void => { now += 1000; });
    scheduler.request();
    await vi.advanceTimersByTimeAsync(200);
    scheduler.request();
    await vi.advanceTimersByTimeAsync(249);
    expect(flush).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(flush).toHaveBeenCalledTimes(4);
  });

  it('contains a failed error reporter and cancels pending work on dispose', async (): Promise<void> => {
    vi.useFakeTimers();
    const flush = vi.fn((): never => { throw new Error('flush failed'); });
    const scheduler = track(createSnapshotBroadcastScheduler({
      ...defaults, flush, onError: (): never => { throw new Error('diagnostic failed'); },
    }));
    scheduler.request();
    await vi.advanceTimersByTimeAsync(16);
    expect(flush).toHaveBeenCalledOnce();
    scheduler.request();
    scheduler.dispose();
    scheduler.requestDiagnostic();
    await vi.advanceTimersByTimeAsync(1000);
    expect(flush).toHaveBeenCalledOnce();
  });
});
