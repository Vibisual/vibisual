import type { PixelBuffer } from './imageEdit.js';
import type { ImagePixelJob, ImagePixelMessage, ImagePixelOutput, ImagePixelReply } from './imagePixelWorkerProtocol.js';

export interface ImagePixelWorkerPort {
  onmessage: ((event: MessageEvent<ImagePixelReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: ImagePixelMessage, transfer: Transferable[]): void;
  terminate(): void;
}
interface Pending {
  id: number; pixels: PixelBuffer; job: ImagePixelJob;
  resolve: (result: ImagePixelOutput) => void; reject: (error: Error) => void; cleanup: () => void;
}
export const imagePixelAbort = (): Error => Object.assign(new Error('Image computation cancelled'), { name: 'AbortError' });

/** A single active computation, with cancelled slider requests removed before dispatch.
 * Source bytes cross the worker boundary only when the immutable base changes.
 * Cancellation rejects immediately; an active kernel finishes away from the UI,
 * while close/source reset terminates the worker and releases all retained memory. */
export class ImagePixelWorkerClient {
  private worker: ImagePixelWorkerPort | null = null;
  private nextId = 0;
  private source: PixelBuffer | null = null;
  private sourceId = 0;
  private active: number | null = null;
  private queue: number[] = [];
  private pending = new Map<number, Pending>();

  constructor(private readonly createWorker: () => ImagePixelWorkerPort = () =>
    new Worker(new URL('./imagePixelWorkerEntry.ts', import.meta.url), { type: 'module' })) {}

  run(pixels: PixelBuffer, job: ImagePixelJob, signal?: AbortSignal): Promise<ImagePixelOutput> {
    if (signal?.aborted) return Promise.reject(imagePixelAbort());
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const cancel = (): void => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id); this.queue = this.queue.filter(item => item !== id);
        pending.cleanup(); pending.reject(imagePixelAbort());
      };
      this.pending.set(id, { id, pixels, job, resolve, reject, cleanup: () => signal?.removeEventListener('abort', cancel) });
      signal?.addEventListener('abort', cancel, { once: true });
      this.queue.push(id);
      this.pump();
    });
  }

  private pump(): void {
    if (this.active !== null) return;
    const id = this.queue.shift();
    if (id === undefined) return;
    const task = this.pending.get(id);
    if (!task) { this.pump(); return; }
    try {
      if (!this.worker) {
        const worker = this.createWorker();
        this.worker = worker;
        worker.onmessage = ({ data }): void => {
          if (this.worker !== worker || this.active !== data.id) return;
          this.active = null;
          if ('error' in data) this.source = null;
          const pending = this.pending.get(data.id);
          this.pending.delete(data.id);
          if (pending) {
            pending.cleanup();
            if ('error' in data) pending.reject(new Error(data.error));
            else pending.resolve(data.output);
          }
          this.pump();
        };
        worker.onerror = (event) => { if (this.worker === worker) this.dispose(new Error(event.message || 'Image worker failed')); };
        worker.onmessageerror = () => { if (this.worker === worker) this.dispose(new Error('Image worker response could not be decoded')); };
      }
      const message: ImagePixelMessage = { id, sourceId: this.sourceId, job: task.job };
      const transfer: Transferable[] = [];
      if (this.source !== task.pixels) {
        const data = task.pixels.data.slice();
        message.sourceId = ++this.sourceId;
        message.pixels = { width: task.pixels.width, height: task.pixels.height, data };
        transfer.push(data.buffer);
        this.source = task.pixels;
      }
      this.active = id;
      this.worker.postMessage(message, transfer);
    } catch (error) { this.dispose(error instanceof Error ? error : new Error(String(error))); }
  }

  dispose(reason = imagePixelAbort()): void {
    this.worker?.terminate(); this.worker = null; this.source = null; this.active = null; this.queue = [];
    for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(reason); }
    this.pending.clear();
  }
}
