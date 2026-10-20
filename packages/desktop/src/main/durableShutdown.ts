import { rendererDraftsFlushed, type FlushAckResult } from './rendererFlushPlan';

/** Nothing destructive runs until every renderer has confirmed its durable writes. */
export async function waitForDurableDrafts(
  flush: () => Promise<FlushAckResult>,
  retry: (result: FlushAckResult) => Promise<boolean>,
): Promise<boolean> {
  for (;;) {
    let result: FlushAckResult;
    try { result = await flush(); } catch {
      result = { requested: 0, acked: 0, failed: 1, timedOut: false };
    }
    if (rendererDraftsFlushed(result)) return true;
    if (!await retry(result)) return false;
  }
}
