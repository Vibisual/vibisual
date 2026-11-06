import type { XYPosition } from '@xyflow/react';
import { cachedBundleInterior, finishBundleInterior, type BundlePackingPlan } from './bundleInteriorLayout.js';
import type { BundlePackingMessage, BundlePackingResult } from './bundleInteriorProtocol.js';

export interface BundleWorkerPort {
  onmessage: ((event: MessageEvent<BundlePackingResult>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: BundlePackingMessage, transfer: Transferable[]): void;
  terminate(): void;
}

interface PendingPacking {
  plan: BundlePackingPlan;
  resolve: (positions: Map<string, XYPosition>) => void;
  reject: (error: Error) => void;
}

export class BundleInteriorWorkerClient {
  private worker: BundleWorkerPort | null = null;
  private nextId = 0;
  private pending = new Map<number, PendingPacking>();
  private bySignature = new Map<string, Promise<Map<string, XYPosition>>>();

  constructor(private readonly createWorker: () => BundleWorkerPort) {}

  pack(plan: BundlePackingPlan): Promise<Map<string, XYPosition>> {
    const cached = cachedBundleInterior(plan);
    if (cached) return Promise.resolve(cached);
    const existing = this.bySignature.get(plan.signature);
    if (existing) return existing;
    const promise = new Promise<Map<string, XYPosition>>((resolve, reject) => {
      try {
        if (!this.worker) {
          this.worker = this.createWorker();
          this.worker.onmessage = ({ data }) => this.complete(data);
          this.worker.onerror = (event) => this.dispose(new Error(event.message || 'Bundle worker failed'));
        }
        const id = ++this.nextId;
        this.pending.set(id, { plan, resolve, reject });
        const input = plan.input.slice();
        this.worker.postMessage({ id, input, count: plan.ids.length, directions: plan.directions }, [input.buffer as ArrayBuffer]);
      } catch (error) {
        this.dispose(error instanceof Error ? error : new Error(String(error)));
        reject(error);
      }
    });
    this.bySignature.set(plan.signature, promise);
    void promise.then(() => this.bySignature.delete(plan.signature), () => this.bySignature.delete(plan.signature));
    return promise;
  }

  private complete(result: BundlePackingResult): void {
    const job = this.pending.get(result.id);
    if (!job) return;
    this.pending.delete(result.id);
    if ('error' in result) { job.reject(new Error(result.error)); return; }
    try { job.resolve(finishBundleInterior(job.plan, result.output)); }
    catch (error) { job.reject(error instanceof Error ? error : new Error(String(error))); }
  }

  dispose(reason = new Error('Bundle worker disposed')): void {
    this.worker?.terminate();
    this.worker = null;
    for (const job of this.pending.values()) job.reject(reason);
    this.pending.clear();
    this.bySignature.clear();
  }
}

const client = new BundleInteriorWorkerClient(() => new Worker(new URL('../workers/bundleInteriorWorker.ts', import.meta.url), { type: 'module' }));
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => client.dispose());

export function packBundleInteriorAsync(plan: BundlePackingPlan): Promise<Map<string, XYPosition>> {
  return client.pack(plan);
}
