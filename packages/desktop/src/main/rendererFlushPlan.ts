/** Durable renderer writes run before shutdown begins. Missing/failed acknowledgements block exit. */
export const FLUSH_DRAFTS_REQUEST_CHANNEL = 'vibisual:lifecycle:flush-drafts';
/** renderer → main: `{ requestId, ok }`, only after durable writes settle. */
export const FLUSH_DRAFTS_DONE_CHANNEL = 'vibisual:lifecycle:flush-drafts:done';
export const FLUSH_DRAFTS_CANCELED_CHANNEL = 'vibisual:lifecycle:flush-drafts:canceled';

/** Separate from the cleanup watchdog: IPC and the server remain alive for this whole wait. */
export const FLUSH_DRAFTS_TIMEOUT_MS = 15_000;

export interface FlushAckTarget {
  id: number;
  send: (requestId: number) => void;
}

export interface FlushAckResult {
  /** Requests successfully sent. */
  requested: number;
  /** Writers that explicitly confirmed durable storage. */
  acked: number;
  /** Sending, persistence, subscription, or storage commit failures. */
  failed: number;
  timedOut: boolean;
}

export function rendererDraftsFlushed(result: FlushAckResult): boolean {
  return !result.timedOut && result.failed === 0 && result.acked === result.requested;
}

export interface CollectFlushAcksOptions {
  targets: readonly FlushAckTarget[];
  requestId: number;
  subscribe: (onAck: (senderId: number, requestId: number, ok?: boolean) => void) => () => void;
  timeoutMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** Every requested renderer gets a chance to persist, including when another renderer fails. */
export function collectFlushAcks(opts: CollectFlushAcksOptions): Promise<FlushAckResult> {
  const {
    targets, requestId, subscribe, timeoutMs = FLUSH_DRAFTS_TIMEOUT_MS,
    setTimer = (fn, ms): unknown => setTimeout(fn, ms),
    clearTimer = (handle): void => clearTimeout(handle as ReturnType<typeof setTimeout>),
  } = opts;

  return new Promise<FlushAckResult>((resolve) => {
    const sent = new Set<number>();
    const responses = new Map<number, boolean>();
    let settled = false;
    let sending = true;
    let failed = 0;
    let unsubscribe: (() => void) | undefined;
    let timer: unknown;

    const finish = (timedOut: boolean): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) { try { clearTimer(timer); } catch { /* Already cleared. */ } }
      try { unsubscribe?.(); } catch { /* Cleanup must not replace the persistence result. */ }
      const acked = [...responses.values()].filter(Boolean).length;
      resolve({ requested: sent.size, acked, failed: failed + responses.size - acked, timedOut });
    };
    const finishIfAllAnswered = (): void => {
      if (!sending && responses.size === sent.size) finish(false);
    };

    try {
      unsubscribe = subscribe((senderId, ackRequestId, ok = true) => {
        if (settled || ackRequestId !== requestId || !sent.has(senderId) || responses.has(senderId)) return;
        responses.set(senderId, ok);
        finishIfAllAnswered();
      });
    } catch {
      resolve({ requested: 0, acked: 0, failed: Math.max(1, targets.length), timedOut: false });
      return;
    }

    for (const target of targets) {
      if (sent.has(target.id)) continue;
      sent.add(target.id); // A synchronous response must belong to an already registered target.
      try { target.send(requestId); } catch {
        sent.delete(target.id);
        responses.delete(target.id);
        failed += 1;
      }
    }
    sending = false;
    finishIfAllAnswered();
    if (!settled) timer = setTimer(() => finish(true), timeoutMs);
  });
}
