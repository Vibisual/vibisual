/** One foreground draw and one replaceable target. Closing settles waiters immediately. */
export function createPreviewQueue(draw: (at: number) => Promise<void | boolean>, onFrame?: () => void) {
  interface Job { at: number; revision: number; promise: Promise<boolean>; resolve: (ready: boolean) => void; reject: (error: unknown) => void }
  let active: Job | null = null;
  let pending: Job | null = null;
  let disposed = false;
  let lastDrawn: number | null = null;
  let revision = 0;
  const pump = async (): Promise<void> => {
    if (active || disposed) return;
    while (pending && !disposed) {
      const job: Job = pending;
      pending = null;
      active = job;
      try {
        const ready = await draw(job.at);
        const current = !disposed && job.revision === revision;
        if (current && ready !== false) {
          lastDrawn = job.at;
          onFrame?.();
        }
        job.resolve(current && ready !== false);
      } catch (error) {
        if (disposed) job.resolve(false);
        else job.reject(error);
      } finally {
        active = null;
      }
    }
  };
  return {
    request(at: number): Promise<boolean> {
      if (disposed) return Promise.resolve(false);
      if (!active && !pending && lastDrawn === at) return Promise.resolve(true);
      if (active?.at === at && active.revision === revision && !pending) return active.promise;
      if (pending) { pending.at = at; pending.revision = revision; return pending.promise; }
      let resolve!: Job['resolve'];
      let reject!: Job['reject'];
      const promise = new Promise<boolean>((yes, no) => { resolve = yes; reject = no; });
      pending = { at, revision, promise, resolve, reject };
      void pump();
      return promise;
    },
    invalidate(): void { revision += 1; lastDrawn = null; },
    /** §5.13 (Y) 40-9 — 마지막으로 그려진 시각(아직 없으면 null) · 그리는 중인가. 재생 시계의 버퍼 판정이 읽는다. */
    drawnAt(): number | null { return lastDrawn; },
    busy(): boolean { return active !== null || pending !== null; },
    dispose(): void {
      disposed = true;
      active?.resolve(false);
      pending?.resolve(false);
      pending = null;
    },
  };
}
