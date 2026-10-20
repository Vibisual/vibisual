import { describe, expect, it, vi } from 'vitest';
import { createPreviewQueue } from './previewQueue.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('preview draw scheduling', () => {
  it('bounds a burst to one active draw and the newest pending frame', async () => {
    const first = deferred<void>();
    const last = deferred<void>();
    const draw = vi.fn<(at: number) => Promise<void>>().mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise);
    const onFrame = vi.fn();
    const queue = createPreviewQueue(draw, onFrame);
    const requests = [queue.request(0)];
    for (let frame = 1; frame <= 120; frame += 1) requests.push(queue.request(frame / 30));
    expect(draw.mock.calls).toEqual([[0]]);
    first.resolve();
    await expect(requests[0]).resolves.toBe(true);
    expect(draw.mock.calls).toEqual([[0], [4]]);
    last.resolve();
    expect(await Promise.all(requests)).toEqual(Array.from({ length: 121 }, () => true));
    expect(onFrame).toHaveBeenCalledTimes(2);
    await expect(queue.request(4)).resolves.toBe(true);
    expect(draw).toHaveBeenCalledTimes(2);
  });

  it('shares an in-flight request for the same frame', async () => {
    const pending = deferred<void>();
    const draw = vi.fn(() => pending.promise);
    const queue = createPreviewQueue(draw);
    const first = queue.request(1);
    const second = queue.request(1);
    expect(first).toBe(second);
    pending.resolve();
    await expect(first).resolves.toBe(true);
    expect(draw).toHaveBeenCalledOnce();
  });

  it('settles active and pending waiters on disposal without waiting for decoding', async () => {
    const pending = deferred<void>();
    const draw = vi.fn(() => pending.promise);
    const onFrame = vi.fn();
    const queue = createPreviewQueue(draw, onFrame);
    const active = queue.request(0);
    const queued = queue.request(1);
    queue.dispose();
    expect(await Promise.all([active, queued, queue.request(2)])).toEqual([false, false, false]);
    pending.resolve();
    await Promise.resolve();
    expect(draw).toHaveBeenCalledOnce();
    expect(onFrame).not.toHaveBeenCalled();
  });

  it('does not announce or cache a stale frame completed after invalidation', async () => {
    const stale = deferred<void>();
    const current = deferred<void>();
    const draw = vi.fn<(at: number) => Promise<void>>().mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise);
    const onFrame = vi.fn();
    const queue = createPreviewQueue(draw, onFrame);
    const oldFrame = queue.request(1);
    queue.invalidate();
    const replacement = queue.request(1);
    stale.resolve();
    await expect(oldFrame).resolves.toBe(false);
    expect(onFrame).not.toHaveBeenCalled();
    expect(draw.mock.calls).toEqual([[1], [1]]);
    current.resolve();
    await expect(replacement).resolves.toBe(true);
    expect(onFrame).toHaveBeenCalledOnce();
  });

  it('continues with the pending frame after a failed draw', async () => {
    const failed = deferred<void>();
    const draw = vi.fn<(at: number) => Promise<void>>().mockReturnValueOnce(failed.promise).mockResolvedValueOnce(undefined);
    const onFrame = vi.fn();
    const queue = createPreviewQueue(draw, onFrame);
    const failure = expect(queue.request(0)).rejects.toThrow('decode failed');
    const next = queue.request(2);
    failed.reject(new Error('decode failed'));
    await failure;
    await expect(next).resolves.toBe(true);
    expect(draw.mock.calls).toEqual([[0], [2]]);
    expect(onFrame).toHaveBeenCalledOnce();
  });

  it('retries a frame that completed without a usable result', async () => {
    const draw = vi.fn<(at: number) => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const onFrame = vi.fn();
    const queue = createPreviewQueue(draw, onFrame);
    await expect(queue.request(0)).resolves.toBe(false);
    expect(onFrame).not.toHaveBeenCalled();
    await expect(queue.request(0)).resolves.toBe(true);
    expect(draw).toHaveBeenCalledTimes(2);
    expect(onFrame).toHaveBeenCalledOnce();
  });
});
