import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { XYPosition } from '@xyflow/react';
import { useBundlePacking, type BundlePackingRequest } from './useBundlePacking.js';
import { prepareBundleInterior } from '../utils/bundleInteriorLayout.js';
import { packBundleInteriorAsync } from '../utils/bundleInteriorWorker.js';

vi.mock('../utils/bundleInteriorWorker.js', () => ({ packBundleInteriorAsync: vi.fn() }));

function request(id: string): BundlePackingRequest {
  const back = { id, label: 'Back', bubbleType: 'back' as const, path: '', status: 'idle' as const, activity: 1 };
  return { back, members: [], plan: prepareBundleInterior([], back, { x: 0, y: 0 }, undefined) };
}

describe('bundle packing response lifetime', () => {
  it('keeps the completed current page while refreshing and ignores responses after a page change', async () => {
    const resolvers: Array<(layout: Map<string, XYPosition>) => void> = [];
    vi.mocked(packBundleInteriorAsync).mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
    let current: ReturnType<typeof useBundlePacking> = null;
    const seen: string[] = [];
    function Probe({ value, scope }: { value: BundlePackingRequest; scope: string }): null {
      current = useBundlePacking(value, scope);
      if (current) seen.push(current.request.back.id);
      return null;
    }
    let renderer: ReactTestRenderer;
    const first = request('hook-first');
    await act(async () => { renderer = create(<Probe value={first} scope="page-0" />); });
    expect(current).toBeNull();
    await act(async () => { resolvers[0]!(new Map([['first', { x: 0, y: 0 }]])); });
    expect(seen.at(-1)).toBe('hook-first');
    await act(async () => { renderer!.update(<Probe value={request('hook-refresh')} scope="page-0" />); });
    expect(seen.at(-1)).toBe('hook-first');
    await act(async () => { renderer!.update(<Probe value={request('hook-next-page')} scope="page-1" />); });
    expect(current).toBeNull();
    await act(async () => { resolvers[1]!(new Map()); });
    expect(current).toBeNull();
    await act(async () => { resolvers[2]!(new Map()); });
    expect(seen.at(-1)).toBe('hook-next-page');
    await act(async () => { renderer!.unmount(); });
  });
});
