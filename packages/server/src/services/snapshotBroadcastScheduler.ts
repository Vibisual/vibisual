import { AsyncLocalStorage } from 'node:async_hooks';

interface SnapshotBroadcastOptions {
  minDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
  flush: (delayMs: number) => void;
  onError: (error: unknown) => void;
  now?: () => number;
}

export interface SnapshotBroadcastScheduler {
  request(): void;
  requestDiagnostic(): void;
  dispose(): void;
}

/**
 * Preserve trailing batching, but carry notification ownership through the real timer
 * and diagnosticService's subsequent microtasks. A synchronous notifying flag cannot
 * cover that boundary. Only diagnostic feedback is suppressed; normal changes can retry.
 * https://nodejs.org/api/async_context.html#asynclocalstoragerunstore-callback-args
 */
export function createSnapshotBroadcastScheduler(options: SnapshotBroadcastOptions): SnapshotBroadcastScheduler {
  const delivering = new AsyncLocalStorage<boolean>();
  const now = options.now ?? (() => performance.now());
  let timer: ReturnType<typeof setTimeout> | null = null;
  let delay = options.minDelayMs;
  let disposed = false;

  const request = (): void => {
    if (disposed || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      delivering.run(true, () => {
        const started = now();
        try { options.flush(delay); }
        catch (error) {
          try { options.onError(error); }
          catch { /* A failed diagnostic sink must not turn one flush into a process error. */ }
        } finally {
          delay = Math.min(options.maxDelayMs, Math.max(options.minDelayMs, (now() - started) * options.backoffFactor));
        }
      });
    }, delay);
  };

  return {
    request,
    requestDiagnostic: (): void => { if (!delivering.getStore()) request(); },
    dispose: (): void => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      delivering.disable();
    },
  };
}
