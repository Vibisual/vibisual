import { describe, it, expect, vi } from 'vitest';
import { waitForDurableDrafts } from './durableShutdown';
import type { FlushAckResult } from './rendererFlushPlan';

const success: FlushAckResult = { requested: 2, acked: 2, failed: 0, timedOut: false };

describe('durable shutdown barrier', () => {
  it('does not allow teardown while persistence is in flight', async () => {
    let complete!: (result: FlushAckResult) => void;
    const teardown = vi.fn();
    const retry = vi.fn();
    const task = waitForDurableDrafts(() => new Promise((resolve) => { complete = resolve; }), retry)
      .then((ok) => { if (ok) teardown(); });
    await Promise.resolve();
    expect(teardown).not.toHaveBeenCalled();
    complete(success);
    await task;
    expect(teardown).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
  });

  it.each([
    { requested: 2, acked: 1, failed: 1, timedOut: false },
    { requested: 2, acked: 1, failed: 0, timedOut: true },
  ])('keeps windows and services alive after cancellation: %j', async (failure) => {
    const retry = vi.fn(async () => false);
    expect(await waitForDurableDrafts(async () => failure, retry)).toBe(false);
    expect(retry).toHaveBeenCalledWith(failure);
  });

  it('runs a fresh flush after retry and only exits after that attempt succeeds', async () => {
    const flush = vi.fn<() => Promise<FlushAckResult>>()
      .mockResolvedValueOnce({ ...success, acked: 1, timedOut: true }).mockResolvedValueOnce(success);
    const retry = vi.fn(async () => true);
    expect(await waitForDurableDrafts(flush, retry)).toBe(true);
    expect(flush).toHaveBeenCalledTimes(2);
    expect(retry).toHaveBeenCalledOnce();
  });

  it('treats a thrown persistence error as a failure rather than authorization to quit', async () => {
    const retry = vi.fn(async () => false);
    expect(await waitForDurableDrafts(async () => { throw new Error('disk error'); }, retry)).toBe(false);
    expect(retry.mock.calls.length).toBe(1);
  });
});
