import { describe, expect, it, vi } from 'vitest';
import { ImagePixelWorkerClient, type ImagePixelWorkerPort } from './imagePixelWorkerClient.js';
import { ImagePixelWorkerEngine, imagePixelTransfers } from './imagePixelWorkerEngine.js';
import type { ImagePixelMessage, ImagePixelReply } from './imagePixelWorkerProtocol.js';
import { colorKey } from './imageEdit.oracle.js';

const pixels = () => ({ width: 2, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 200]) });
const key = { kind: 'key' as const, options: { color: { r: 255, g: 255, b: 255 }, tolerance: 0, contiguous: false } };
function port() {
  const sent: ImagePixelMessage[] = [];
  const worker: ImagePixelWorkerPort = { onmessage: null, onerror: null, onmessageerror: null, terminate: vi.fn(),
    postMessage: vi.fn((message, transfer) => sent.push(structuredClone(message, { transfer: transfer as ArrayBuffer[] }))) };
  const engine = new ImagePixelWorkerEngine();
  const finish = (index: number) => worker.onmessage?.({ data: engine.run(sent[index]!) } as MessageEvent<ImagePixelReply>);
  return { worker, sent, finish };
}

describe('image worker source ownership, cancellation and failure recovery', () => {
  it('executes actual Rust, transfers the output, retains the source and reuses color distances', async () => {
    const { worker, sent, finish } = port();
    const client = new ImagePixelWorkerClient(() => worker);
    const input = pixels();
    const first = client.run(input, key);
    expect(input.data.byteLength).toBe(8);
    finish(0);
    expect(await first).toEqual(colorKey(input, key.options));
    const second = client.run(input, { ...key, options: { ...key.options, tolerance: 200 } });
    expect(sent[1]?.pixels).toBeUndefined();
    finish(1); expect(await second).toEqual(colorKey(input, { ...key.options, tolerance: 200 }));
    const reply = new ImagePixelWorkerEngine().run({ id: 7, sourceId: 1, pixels: input, job: key });
    if ('output' in reply && reply.output && typeof reply.output === 'object' && 'buffer' in reply.output) {
      expect(imagePixelTransfers(reply)).toEqual([reply.output.buffer.data.buffer]);
    } else throw new Error('Rust result missing');
    client.dispose();
  });

  it('drops superseded slider jobs before they execute and ignores the cancelled active result', async () => {
    const { worker, sent, finish } = port();
    const client = new ImagePixelWorkerClient(() => worker);
    const input = pixels(), firstAbort = new AbortController(), queuedAbort = new AbortController();
    const first = client.run(input, key, firstAbort.signal).catch(error => error.name);
    const queued = client.run(input, key, queuedAbort.signal).catch(error => error.name);
    firstAbort.abort(); queuedAbort.abort();
    const latest = client.run(input, { kind: 'fill', color: { r: 7, g: 8, b: 9 } });
    expect(await first).toBe('AbortError'); expect(await queued).toBe('AbortError');
    expect(sent).toHaveLength(1);
    finish(0); expect(sent).toHaveLength(2); expect(sent[1]?.job.kind).toBe('fill');
    finish(1); expect(await latest).toMatchObject({ width: 2, height: 1 });
    client.dispose();
  });

  it('rejects pending operations on close and ignores late replies from the terminated worker', async () => {
    const a = port(), b = port(); let created = 0;
    const client = new ImagePixelWorkerClient(() => (++created === 1 ? a.worker : b.worker));
    const first = client.run(pixels(), key).catch(error => error.name);
    client.dispose(); expect(await first).toBe('AbortError'); expect(a.worker.terminate).toHaveBeenCalledOnce();
    const second = client.run(pixels(), key);
    a.finish(0); b.finish(0);
    expect(await second).toEqual(colorKey(pixels(), key.options));
    expect(b.sent[0]?.pixels).toBeDefined();
    client.dispose();
  });

  it('reports worker and serialization failures without a main-thread fallback and retries cleanly', async () => {
    const a = port(), b = port(); let created = 0;
    const client = new ImagePixelWorkerClient(() => (++created === 1 ? a.worker : b.worker));
    const failed = client.run(pixels(), key).catch(error => error.message);
    a.worker.onerror?.({ message: 'worker failure' } as ErrorEvent);
    expect(await failed).toBe('worker failure');
    const recovered = client.run(pixels(), key); b.finish(0);
    expect(await recovered).toEqual(colorKey(pixels(), key.options));
    client.dispose();
    const broken = new ImagePixelWorkerEngine().run({ id: 9, sourceId: 8, job: key });
    expect(broken).toEqual({ id: 9, error: 'Image worker source is unavailable' });
  });

  it('resends the source after a cancelled active job reports a source initialization failure', async () => {
    const { worker, sent, finish } = port();
    const client = new ImagePixelWorkerClient(() => worker), input = pixels(), controller = new AbortController();
    const cancelled = client.run(input, key, controller.signal).catch(error => error.name);
    controller.abort();
    const next = client.run(input, key);
    worker.onmessage?.({ data: { id: sent[0]!.id, error: 'temporary source allocation failure' } } as MessageEvent<ImagePixelReply>);
    expect(await cancelled).toBe('AbortError');
    expect(sent[1]?.pixels).toBeDefined();
    finish(1); expect(await next).toEqual(colorKey(input, key.options));
    client.dispose();
  });
});
