import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface WorkerMessage { id: number; generation: number; filePath: string; data: string }
interface ControlledWorker {
  control: Int32Array;
  sent: WorkerMessage[];
  emit(event: string, value: unknown): boolean;
}
const harness = vi.hoisted(() => ({ workers: [] as ControlledWorker[] }));

vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    Worker: class extends EventEmitter {
      control: Int32Array;
      sent: WorkerMessage[] = [];
      constructor(_source: string, options: { workerData: { control: SharedArrayBuffer } }) {
        super();
        this.control = new Int32Array(options.workerData.control);
        harness.workers.push(this);
      }
      unref(): this { return this; }
      postMessage(message: WorkerMessage): void { this.sent.push(message); }
      async terminate(): Promise<number> { return 0; }
    },
  };
});

const { enableAsyncDiskWrites, queueAtomicWrite, flushPendingDiskWritesSync,
  getDiskWriteQueueStats, shutdownDiskWriteQueue } = await import('./diskWriteQueue.js');
let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-disk-lifecycle-')));
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const w of harness.workers) Atomics.store(w.control, 1, 0);
  shutdownDiskWriteQueue();
  harness.workers.length = 0;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('worker lifecycle cannot erase pending writes or block shutdown forever', () => {
  it('recovers a worker that exits while holding the commit lock', () => {
    const target = path.join(tmpRoot, 'checkpoint.json');
    enableAsyncDiskWrites();
    queueAtomicWrite(target, '{"kept":true}');
    const w = harness.workers.at(-1)!;
    Atomics.store(w.control, 1, 1);

    w.emit('error', new Error('Worker terminated during commit'));
    expect(getDiskWriteQueueStats().pending).toBe(1);
    w.emit('exit', 1);

    expect(getDiskWriteQueueStats().pending).toBe(0);
    expect(fs.readFileSync(target, 'utf8')).toBe('{"kept":true}');
  });

  it('late success from before a failed flush cannot discard the retained payload', () => {
    const target = path.join(tmpRoot, 'checkpoint.json');
    enableAsyncDiskWrites();
    queueAtomicWrite(target, '{"kept":true}');
    const w = harness.workers.at(-1)!;
    const previous = w.sent[0]!;
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('Temporary write failure'); });
    expect(flushPendingDiskWritesSync()).toBe(0);

    w.emit('message', { id: previous.id, generation: previous.generation, ok: true });
    expect(getDiskWriteQueueStats().pending).toBe(1);
    expect(flushPendingDiskWritesSync()).toBe(1);
    expect(fs.readFileSync(target, 'utf8')).toBe('{"kept":true}');
  });

  it('a stuck commit fails within a bounded wait and retains data for recovery', () => {
    const target = path.join(tmpRoot, 'checkpoint.json');
    enableAsyncDiskWrites();
    queueAtomicWrite(target, '{"kept":true}');
    const w = harness.workers.at(-1)!;
    Atomics.store(w.control, 1, 1);

    expect(() => flushPendingDiskWritesSync()).toThrow('timed out waiting for worker commit');
    expect(getDiskWriteQueueStats().pending).toBe(1);
    Atomics.store(w.control, 1, 0);
    expect(flushPendingDiskWritesSync()).toBe(1);
  });
});
