import type { BrowserWindow, Event, Input } from 'electron';

export const IMMERSIVE_STATE_CHANNEL = 'vibisual:window:immersive-state';
export const IMMERSIVE_SHORTCUT_CHANNEL = 'vibisual:window:immersion-shortcut';
const TRANSITION_TIMEOUT_MS = 10_000;

/** Own only the fullscreen change made for immersion. Electron keeps the normal
 * bounds/maximized state when toggling fullscreen; rewriting bounds here would
 * discard native restore/snap information and introduce fractional-DPI rounding. */
export function createWindowImmersiveController(win: BrowserWindow): {
  setEnabled(enabled: boolean): Promise<void>;
  dispose(): void;
} {
  let desired = false;
  let reported = false;
  let restoreFullScreen: boolean | null = null;
  let transition: boolean | null = null;
  let lateEntryPending = false;
  let transitionTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let reconcileTask: ReturnType<typeof setImmediate> | undefined;
  let pending: Array<{ resolve(): void; reject(error: Error): void }> = [];

  const beforeInput = (event: Event, input: Input): void => {
    if ((input.type !== 'keyDown' && input.type !== 'keyUp') || input.code !== 'F11'
      || input.control || input.meta || input.alt || input.shift) return;
    // Prevent both the native fullscreen menu shortcut and the page event, so
    // iframe focus is covered without dispatching the same press twice.
    event.preventDefault();
    if (input.type !== 'keyDown' || input.isAutoRepeat || input.isComposing
      || disposed || win.isDestroyed() || win.webContents.isDestroyed()) return;
    // The renderer's command registry owns remapping, unbinding and key capture.
    // This only forwards input; it must never toggle fullscreen by itself.
    win.webContents.send(IMMERSIVE_SHORTCUT_CHANNEL);
  };

  const notify = (immersive: boolean, force = false): void => {
    if (reported === immersive && !force) return;
    reported = immersive;
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(IMMERSIVE_STATE_CHANNEL, { immersive });
    }
  };
  const finish = (error?: Error): void => {
    const waiting = pending;
    pending = [];
    for (const request of waiting) {
      if (error) request.reject(error);
      else request.resolve();
    }
  };
  const clearTransition = (): void => {
    if (transitionTimer !== undefined) clearTimeout(transitionTimer);
    transitionTimer = undefined;
    transition = null;
  };
  const fail = (error: unknown): void => {
    lateEntryPending ||= transition === true;
    clearTransition();
    desired = false;
    // Keep the snapshot until an exit completes. A timed-out native enter can
    // still arrive later; its event must restore the window instead of stranding
    // it in fullscreen after the renderer has already cancelled immersion.
    notify(false, true);
    finish(error instanceof Error ? error : new Error(String(error)));
  };

  const reconcile = (): void => {
    if (disposed || win.isDestroyed()) {
      finish(new Error('The immersive window has closed'));
      return;
    }
    // macOS changes fullscreen asynchronously. Never reverse a native transition
    // until its completion event, even if the renderer already asked to exit.
    if (transition !== null) return;
    const target = desired || (restoreFullScreen ?? win.isFullScreen());
    if (win.isFullScreen() === target) {
      // The renderer sends false after a failed entry. That no-op must not erase
      // the snapshot while the timed-out native entry can still complete later.
      if (!desired && !lateEntryPending) restoreFullScreen = null;
      notify(desired);
      finish();
      return;
    }
    transition = target;
    transitionTimer = setTimeout(() => {
      if (win.isDestroyed()) {
        dispose();
      } else if (win.isFullScreen() === target) {
        clearTransition();
        reconcile();
      } else {
        fail(new Error('The native fullscreen transition did not complete'));
      }
    }, TRANSITION_TIMEOUT_MS);
    try {
      win.setFullScreen(target);
    } catch (error) {
      fail(error);
    }
  };

  const reconcileAfterNativeUpdate = (): void => {
    if (reconcileTask !== undefined) return;
    // Electron 31 on Windows emits enter/leave BEFORE widget()->SetFullscreen.
    // Reading isFullScreen inside that event re-enters the native setter before
    // it can cover rcMonitor (including the taskbar). Use a later event-loop turn,
    // not a microtask checkpoint inside a native-to-JS callback.
    reconcileTask = setImmediate(() => {
      reconcileTask = undefined;
      reconcile();
    });
  };
  const entered = (): void => {
    lateEntryPending = false;
    if (transition === true) clearTransition();
    reconcileAfterNativeUpdate();
  };
  const left = (): void => {
    lateEntryPending = false;
    const expected = transition === false;
    const hadImmersion = desired || reported || restoreFullScreen !== null;
    clearTransition();
    if (!expected) {
      // Escape/the native fullscreen control wins over the renderer. In
      // particular, do not re-enter a pre-existing fullscreen session on exit.
      desired = false;
      restoreFullScreen = null;
      if (hadImmersion) notify(false, true);
    }
    reconcileAfterNativeUpdate();
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    clearTransition();
    if (reconcileTask !== undefined) clearImmediate(reconcileTask);
    reconcileTask = undefined;
    win.removeListener('enter-full-screen', entered);
    win.removeListener('leave-full-screen', left);
    win.removeListener('closed', dispose);
    win.webContents.removeListener('before-input-event', beforeInput);
    finish(new Error('The immersive window has closed'));
  };
  win.on('enter-full-screen', entered);
  win.on('leave-full-screen', left);
  win.once('closed', dispose);
  win.webContents.on('before-input-event', beforeInput);

  return {
    setEnabled(enabled): Promise<void> {
      if (disposed || win.isDestroyed()) return Promise.reject(new Error('The immersive window has closed'));
      if (enabled && restoreFullScreen === null) restoreFullScreen = win.isFullScreen();
      desired = enabled;
      return new Promise<void>((resolve, reject) => {
        pending.push({ resolve, reject });
        reconcile();
      });
    },
    dispose,
  };
}
