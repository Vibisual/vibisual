import { useEffect, useMemo, useState } from 'react';
import type { BubbleData } from '@vibisual/shared';
import type { XYPosition } from '@xyflow/react';
import { cachedBundleInterior, type BundlePackingPlan } from '../utils/bundleInteriorLayout.js';
import { packBundleInteriorAsync } from '../utils/bundleInteriorWorker.js';

export interface BundlePackingRequest {
  readonly plan: BundlePackingPlan;
  readonly members: BubbleData[];
  readonly back: BubbleData;
}

interface PackedBundle {
  scope: string;
  request: BundlePackingRequest;
  layout: Map<string, XYPosition>;
}

/** Keep the previous page result while refreshing; a different page never borrows its geometry. */
export function useBundlePacking(request: BundlePackingRequest | null, scope: string): PackedBundle | null {
  const [ready, setReady] = useState<PackedBundle | null>(null);
  const [failure, setFailure] = useState<{ signature: string; error: Error } | null>(null);
  const cached = request ? cachedBundleInterior(request.plan)
    ?? (ready?.request.plan.signature === request.plan.signature ? ready.layout : undefined) : undefined;
  useEffect(() => {
    if (!request || cached) return;
    let cancelled = false;
    void packBundleInteriorAsync(request.plan).then((layout) => {
      if (!cancelled) { setReady({ scope, request, layout }); setFailure(null); }
    }, (error: unknown) => {
      if (!cancelled) setFailure({ signature: request.plan.signature, error: error instanceof Error ? error : new Error(String(error)) });
    });
    return () => { cancelled = true; };
  }, [request, scope, cached]);
  return useMemo(() => {
    if (!request) return null;
    if (cached) return { scope, request, layout: cached };
    if (failure?.signature === request.plan.signature) throw failure.error;
    return ready?.scope === scope ? ready : null;
  }, [request, scope, cached, failure, ready]);
}
