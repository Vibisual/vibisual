interface BackendStartupOptions {
  boot(): Promise<void>;
  openApp(): void;
  askRestart(): Promise<boolean>;
  relaunch(): void;
  quit(): void;
  reportError(error: unknown): void;
}

/** Partial startup owns resources already: restart the process only on request, never boot twice in place. */
export async function startBackendBeforeWindow(options: BackendStartupOptions): Promise<void> {
  try {
    await options.boot();
  } catch (error) {
    options.reportError(error);
    try {
      if (await options.askRestart()) options.relaunch();
    } catch (recoveryError) {
      options.reportError(recoveryError);
    } finally {
      // Reuse normal shutdown/flush even when the native recovery dialog itself fails.
      options.quit();
    }
    return;
  }
  options.openApp();
}
