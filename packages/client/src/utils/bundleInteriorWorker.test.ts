import { describe, expect, it } from 'vitest';
import { packBundleGeometry } from '@vibisual/compute';
import type { BubbleData } from '@vibisual/shared';
import { prepareBundleInterior } from './bundleInteriorLayout.js';
import { packBundleInteriorReference } from './bundleInteriorLayout.reference.js';
import { BundleInteriorWorkerClient, type BundleWorkerPort } from './bundleInteriorWorker.js';
import type { BundlePackingMessage, BundlePackingResult } from './bundleInteriorProtocol.js';

class TestWorker implements BundleWorkerPort {
  onmessage: ((event: MessageEvent<BundlePackingResult>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  messages: BundlePackingMessage[] = [];
  terminated = false;
  postMessage(message: BundlePackingMessage, transfer: Transferable[]): void {
    this.messages.push(structuredClone(message, { transfer }));
  }
  terminate(): void { this.terminated = true; }
  finish(index: number): void {
    const message = this.messages[index]!;
    const output = packBundleGeometry(message.input, message.count, message.directions);
    this.onmessage?.({ data: { id: message.id, output } } as MessageEvent<BundlePackingResult>);
  }
}

function input(id: string): BubbleData[] {
  return [0, 1, 2].map((i) => ({ id: `${id}-${i}`, label: `${id}-${i}.png`, path: `${id}/${i}.png`, bubbleType: 'file',
    status: 'idle', activity: 1, readCount: i + 1 }));
}

describe('bundle worker boundary', () => {
  it('shares unchanged work, transfers only a copy, and resolves the compiled Rust result', async () => {
    const worker = new TestWorker();
    const client = new BundleInteriorWorkerClient(() => worker);
    const members = input('worker-shared');
    const plan = prepareBundleInterior(members, null, { x: 0, y: 0 }, undefined);
    const a = client.pack(plan);
    expect(client.pack(plan)).toBe(a);
    expect(worker.messages).toHaveLength(1);
    expect(plan.input.byteLength).toBeGreaterThan(0);
    worker.finish(0);
    const result = await a;
    expect(result).toEqual(packBundleInteriorReference(members, null, { x: 0, y: 0 }, undefined));
    expect(await client.pack(plan)).toBe(result);
    expect(worker.messages).toHaveLength(1);
    client.dispose();
    expect(worker.terminated).toBe(true);
  });

  it('matches out-of-order results to their own job', async () => {
    const worker = new TestWorker();
    const client = new BundleInteriorWorkerClient(() => worker);
    const a = client.pack(prepareBundleInterior(input('worker-a'), null, { x: 0, y: 0 }, undefined));
    const b = client.pack(prepareBundleInterior(input('worker-b'), null, { x: 100, y: 100 }, undefined));
    worker.finish(1);
    expect([...(await b).keys()].every((id) => id.startsWith('worker-b'))).toBe(true);
    worker.finish(0);
    expect([...(await a).keys()].every((id) => id.startsWith('worker-a'))).toBe(true);
    client.dispose();
  });

  it('rejects pending work on shutdown without leaving the client stuck', async () => {
    const workers: TestWorker[] = [];
    const client = new BundleInteriorWorkerClient(() => { const worker = new TestWorker(); workers.push(worker); return worker; });
    const plan = prepareBundleInterior(input('worker-retry'), null, { x: 0, y: 0 }, undefined);
    const interrupted = client.pack(plan);
    const rejection = expect(interrupted).rejects.toThrow('disposed');
    client.dispose();
    await rejection;
    const retried = client.pack(plan);
    workers[1]!.finish(0);
    expect((await retried).size).toBe(3);
    client.dispose();
  });
});
