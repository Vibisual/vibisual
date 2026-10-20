interface ProgressOptions {
  expiresAt?: number;
  signal: AbortSignal;
  post: (progress: number) => Promise<unknown>;
  finalError: (error: unknown) => boolean;
}

/** Heartbeats bypass the pending-command queue while one bounded edit is running. */
export function vibi3dCommandProgress(options: ProgressOptions): {
  progress: (value: number) => Promise<void>; assertActive: () => void; dispose: () => void;
} {
  let latest = 0, lastSent = -Infinity, failure: unknown, stopped = false;
  let inFlight: Promise<void> | undefined;
  const assertActive = (): void => {
    if (stopped || options.signal.aborted) throw new Error('scene-changed');
    if (options.expiresAt !== undefined && Date.now() >= options.expiresAt) throw new Error('command-expired');
    if (failure) throw failure;
  };
  const send = (): Promise<void> => {
    if (inFlight) return inFlight;
    assertActive(); lastSent = Date.now();
    const task = options.post(latest).then(() => undefined, error => {
      if (options.finalError(error)) { failure = error; throw error; }
      // Transient transport errors do not replay applied edits; the fixed deadline still bounds work.
    });
    inFlight = task.finally(() => { inFlight = undefined; });
    return inFlight;
  };
  const progress = (value: number): Promise<void> => {
    assertActive();
    latest = Math.max(latest, Math.min(1, Math.max(0, value)));
    return latest === 1 || Date.now() - lastSent >= 150 ? send() : Promise.resolve();
  };
  const timer = setInterval(() => { if (!stopped) { try { void send().catch(() => undefined); } catch { /* Next edit step observes the reason. */ } } }, 5000);
  return { progress, assertActive, dispose: () => { stopped = true; clearInterval(timer); } };
}
