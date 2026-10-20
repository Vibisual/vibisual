/** Repeated close requests share one question; only an explicit acceptance continues shutdown. */
export function createQuitConfirmationGate(): {
  request(ask: () => Promise<boolean>, accepted: () => void, failed: (error: unknown) => void): void;
} {
  let pending = false;
  return {
    request(ask, accepted, failed): void {
      if (pending) return;
      pending = true;
      void Promise.resolve().then(ask).then((answer) => { if (answer) accepted(); }).catch(failed)
        .finally(() => { pending = false; });
    },
  };
}
