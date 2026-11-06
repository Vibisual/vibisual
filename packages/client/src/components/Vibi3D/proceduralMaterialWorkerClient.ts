import type { Vibi3DMaterialPreset } from '@vibisual/shared';
import type { SurfaceWearInput } from '@vibisual/compute';
import type { GeneratedMaterialMaps, MaterialMapOptions } from './proceduralMaterialPixels.js';

export type MaterialWorkerRequest = { id: number; kind: 'material'; preset: Vibi3DMaterialPreset; options: MaterialMapOptions }
  | { id: number; kind: 'surface-wear'; input: SurfaceWearInput };
export interface MaterialWorkerResponse { id: number; maps?: GeneratedMaterialMaps; surfaceWear?: [Uint8Array, Uint8Array]; error?: string }
interface Job { request: MaterialWorkerRequest; resolve: (response: MaterialWorkerResponse) => void; reject: (error: Error) => void; cleanup: () => void }

/** One serialized worker queue; cancelled previews never displace newer material state. */
export class MaterialWorkerClient {
  private worker?: Worker;
  private nextId = 0;
  private active?: Job;
  private queue: Job[] = [];
  private idle?: ReturnType<typeof setTimeout>;
  constructor(private readonly factory = () => new Worker(new URL('./proceduralMaterialWorker.ts', import.meta.url), { type: 'module' })) {}
  generate(preset: Vibi3DMaterialPreset, options: MaterialMapOptions = {}, signal?: AbortSignal): Promise<GeneratedMaterialMaps> {
    return this.enqueue({ id: ++this.nextId, kind: 'material', preset, options: structuredClone(options) }, signal).then(response => {
      if (!response.maps) throw new Error('material-worker-message-invalid'); return response.maps;
    });
  }
  surfaceWear(input: SurfaceWearInput): Promise<[Uint8Array, Uint8Array]> {
    const { bases, ...settings } = input;
    return this.enqueue({ id: ++this.nextId, kind: 'surface-wear', input: { ...structuredClone(settings), bases } }).then(response => {
      if (!response.surfaceWear) throw new Error('material-worker-message-invalid'); return response.surfaceWear;
    });
  }
  private enqueue(request: MaterialWorkerRequest, signal?: AbortSignal): Promise<MaterialWorkerResponse> {
    if (signal?.aborted) return Promise.reject(new DOMException('Material generation cancelled', 'AbortError'));
    return new Promise((resolve, reject) => {
      const job: Job = { request, resolve, reject, cleanup: () => signal?.removeEventListener('abort', abort) };
      const abort = (): void => {
        job.cleanup(); job.reject(new DOMException('Material generation cancelled', 'AbortError'));
        this.queue = this.queue.filter(queued => queued !== job);
        if (this.active === job) { this.worker?.terminate(); this.worker = undefined; this.active = undefined; this.pump(); }
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.queue.push(job); this.pump();
    });
  }
  dispose(): void {
    clearTimeout(this.idle); this.worker?.terminate(); this.worker = undefined;
    const jobs = [...(this.active ? [this.active] : []), ...this.queue]; this.active = undefined; this.queue = [];
    for (const job of jobs) { job.cleanup(); job.reject(new Error('material-worker-closed')); }
  }
  private pump(): void {
    clearTimeout(this.idle);
    if (this.active) return;
    const job = this.queue.shift();
    if (!job) { this.idle = setTimeout(() => { this.worker?.terminate(); this.worker = undefined; }, 30_000); return; }
    this.active = job;
    try {
      if (!this.worker) {
        const worker = this.factory(); this.worker = worker;
        worker.onmessage = ({ data }: MessageEvent<MaterialWorkerResponse>) => {
          if (this.worker !== worker || data.id !== this.active?.request.id) return;
          const current = this.active; this.active = undefined; current.cleanup();
          if (data.error) current.reject(new Error(data.error)); else current.resolve(data);
          this.pump();
        };
        worker.onerror = () => { if (this.worker === worker) this.fail(new Error('material-worker-failed')); };
        worker.onmessageerror = () => { if (this.worker === worker) this.fail(new Error('material-worker-message-invalid')); };
      }
      if (job.request.kind === 'surface-wear') {
        // Copy only the active job; immutable scene/undo pixels must never be detached.
        const bases = job.request.input.bases.map(data => data.slice()) as [Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>];
        this.worker.postMessage({ ...job.request, input: { ...job.request.input, bases } }, bases.map(data => data.buffer));
      } else this.worker.postMessage(job.request);
    } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
  }
  private fail(error: Error): void {
    this.worker?.terminate(); this.worker = undefined;
    const jobs = [...(this.active ? [this.active] : []), ...this.queue]; this.active = undefined; this.queue = [];
    for (const job of jobs) { job.cleanup(); job.reject(error); }
  }
}

const materials = new MaterialWorkerClient();
export const generateMaterialMapsAsync = (preset: Vibi3DMaterialPreset, options: MaterialMapOptions = {}, signal?: AbortSignal): Promise<GeneratedMaterialMaps> => materials.generate(preset, options, signal);
export const generateSurfaceWearAsync = (input: SurfaceWearInput): Promise<[Uint8Array, Uint8Array]> => materials.surfaceWear(input);
