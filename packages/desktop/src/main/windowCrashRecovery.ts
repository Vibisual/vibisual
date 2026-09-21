import type { BrowserWindow, Event, RenderProcessGoneDetails } from 'electron';

interface RecoveryOptions {
  appPageUrl: string;
  isQuitting: () => boolean;
  askReload: (window: BrowserWindow) => Promise<boolean>;
  log: (level: 'error' | 'fatal' | 'info', message: string) => void;
}

/** Only the bundled app page may be reloaded. Remote previews and login pages own their own lifetime. */
export function isAppRecoveryPage(actual: string, expected: string): boolean {
  try {
    const page = new URL(actual);
    const appPage = new URL(expected);
    return page.protocol === 'file:' && appPage.protocol === 'file:'
      && page.host === appPage.host && page.pathname === appPage.pathname;
  } catch {
    return false;
  }
}

/** Cover every app window, including detached IDEs; never retry automatically or restart the backend. */
export function installWindowCrashRecovery(window: BrowserWindow, options: RecoveryOptions): void {
  const contents = window.webContents;
  let asking = false;
  let navigationGeneration = 0;
  const log = (level: 'error' | 'fatal' | 'info', message: string): void => {
    try { options.log(level, `webContents=${contents.id} ${message}`); } catch { /* logging is best effort */ }
  };
  const canRecover = (): boolean => !options.isQuitting() && !window.isDestroyed()
    && !contents.isDestroyed() && isAppRecoveryPage(contents.getURL(), options.appPageUrl);

  contents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
    // A new page or manual reload supersedes any pending recovery prompt, even if it returns
    // to the identical URL. Embedded previews do not replace the app document.
    if (isMainFrame) navigationGeneration += 1;
  });
  contents.on('preload-error', (_event, _preloadPath, error) => {
    log('error', `preload-error: ${error.message}`);
  });
  contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    // ERR_ABORTED is a normal cancelled navigation, and a failed preview is not a failed app page.
    if (isMainFrame && code !== -3) log('error', `did-fail-load code=${code} ${description}`);
  });
  contents.on('render-process-gone', (_event: Event, details: RenderProcessGoneDetails) => {
    log(details.reason === 'clean-exit' ? 'info' : 'fatal',
      `render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
    if (details.reason === 'clean-exit' || !canRecover() || asking) return;
    asking = true;
    // Keep the session/hash and backend alive. A crashed renderer cannot flush its in-memory draft;
    // recovery uses the existing persisted draft rather than promising lossless native-crash recovery.
    const pageAtCrash = contents.getURL();
    const navigationAtCrash = navigationGeneration;
    void (async (): Promise<void> => {
      try {
        const reload = await options.askReload(window);
        if (reload && navigationGeneration === navigationAtCrash
          && canRecover() && contents.getURL() === pageAtCrash) {
          log('info', 'renderer recovery requested');
          contents.reload();
        }
      } catch (error) {
        log('error', `renderer recovery failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      } finally {
        asking = false;
      }
    })();
  });
}
