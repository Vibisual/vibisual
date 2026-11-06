import { afterEach, describe, expect, it, vi } from 'vitest';
import { packBundleGeometry } from '@vibisual/compute';
import { prepareBundleInterior } from './bundleInteriorLayout.js';
import type { BundlePackingMessage, BundlePackingResult } from './bundleInteriorProtocol.js';

afterEach(() => vi.unstubAllGlobals());

describe('bundle worker entry', () => {
  it('executes the compiled Rust kernel and transfers its output', async () => {
    const posted: Array<{ message: BundlePackingResult; transfer?: Transferable[] }> = [];
    const scope: { onmessage: ((event: MessageEvent<BundlePackingMessage>) => void) | null; postMessage: (message: BundlePackingResult, transfer?: Transferable[]) => void } = {
      onmessage: null,
      postMessage: (message, transfer) => { posted.push({ message, transfer }); },
    };
    vi.stubGlobal('self', scope);
    await import('../workers/bundleInteriorWorker.js');
    const plan = prepareBundleInterior([], null, { x: 13, y: 27 }, undefined);
    scope.onmessage!({ data: { id: 1, input: plan.input, count: 0, directions: plan.directions } } as MessageEvent<BundlePackingMessage>);
    const result = posted[0]!.message;
    expect('output' in result).toBe(true);
    if ('output' in result) {
      expect(result.output).toEqual(packBundleGeometry(plan.input, 0, plan.directions));
      expect(posted[0]?.transfer).toEqual([result.output.buffer]);
    }
    const malformed = plan.input.slice();
    malformed[0] = Number.NaN;
    scope.onmessage!({ data: { id: 2, input: malformed, count: 0, directions: plan.directions } } as MessageEvent<BundlePackingMessage>);
    expect(posted[1]?.message).toEqual({ id: 2, error: 'Rust bundle packing failed (2)' });
  });
});
