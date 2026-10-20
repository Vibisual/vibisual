import type { BrowserWindow, Point } from 'electron';
import { movedBounds, type OverlaySize } from './overlaySize';
import {
  passedTitlebarDragThreshold,
  pickTitlebarPoint,
  TITLEBAR_FOLLOW_MS,
  TITLEBAR_GESTURE_MAX_MS,
  TITLEBAR_RELEASE_GRACE_TICKS,
  TITLEBAR_RESTORE_WAIT_TICKS,
} from './titlebarDrag';

type TitlebarWindow = Pick<BrowserWindow,
  'getBounds' | 'getNormalBounds' | 'isDestroyed' | 'isMaximized' |
  'unmaximize' | 'setBounds' | 'on' | 'removeListener'>;

/**
 * Where the hand is. `current` is the OS cursor — the freshest point when main handles the gesture
 * on time. `press` is where the renderer measured the press (§3.7 ③): the window was still standing
 * then, so it stays exact even when a busy main thread receives the press late.
 */
export interface TitlebarPointer {
  current: () => Point;
  press?: Point;
}

export interface TitlebarMove {
  /** The hand moved; the window follows the OS cursor. */
  move(): void;
  /**
   * Main's own beat (§3.7, 2026-10-16). Restoring a maximized window resizes it under the hand, and the
   * page can lose the gesture right there — its `move` stops coming and the window stayed behind. This
   * reads the OS cursor itself, like the app-window drag (`appWindowTransfer.ts`). `pressed` is the
   * physical primary button where the OS can tell (win32): once seen held, a release ends the gesture
   * even when the page never sees the mouseup. `null` = the OS can't tell; the page decides the end.
   */
  follow(pressed?: boolean | null): void;
  /** The hand let go. `at` is the renderer-measured drop point (§3.7 ③). */
  end(at?: Point): void;
  cancel(): void;
}

/** One gesture, shared by every caller of move-self; coordinates and size are screen DIP.
 * A press that reached the page moves the window itself on every OS. It does not hand the gesture to the
 * native move loop: that handoff reported success once a message was queued, cut this path,
 * and left the window unmoved in the real app (§3.7, 2026-10-12 — see the move-self note in ipc.ts).
 */
export function startTitlebarMove(
  win: TitlebarWindow,
  pointer: TitlebarPointer,
  dipStepAt: (x: number, y: number) => number,
  onDone: () => void,
): TitlebarMove {
  const bounds = win.getBounds();
  // A late press would read the cursor after the hand already moved on — use the renderer's point.
  const press = pointer.press ?? pointer.current();
  let restoreFromMaximized = win.isMaximized();
  // A previous gesture may already be restoring when this one starts. Remember normal size
  // now, even if that earlier unmaximize completes before our first move.
  const normalAtStart = restoreFromMaximized ? win.getNormalBounds() : null;
  let origin = { x: bounds.x, y: bounds.y };
  let size: OverlaySize = { width: bounds.width, height: bounds.height };
  let waitingForRestore = false;
  // Restore is asked once per gesture. A frameless window can keep reporting maximized after it
  // restored and send `unmaximize` late or never (§5.4 #14-1); asking again would wait for news that
  // never comes and freeze the drag.
  let restoreAsked = false;
  let restoreWaitTicks = 0;
  // The physical button was seen held in this gesture. Until then a "released" reading proves
  // nothing (pen and synthetic input never set it), and the page's mouseup decides the end.
  let heldSeen = false;
  // Beats the button has been seen released. While > 0 the window never chases the free mouse.
  let releasedBeats = 0;
  // Capture the first physical release even while restore is pending. The cursor may be elsewhere
  // by the time unmaximize completes or the page's mouseup grace expires.
  let physicalReleasePoint: Point | undefined;
  let ended = false;
  let disposed = false;
  let releasePoint = press;
  // The hand position the window currently sits under — never re-place to the same point.
  let placedAt = press;

  const cancel = (): void => {
    if (disposed) return;
    disposed = true;
    win.removeListener('unmaximize', restored);
    win.removeListener('closed', cancel);
    onDone();
  };

  const place = (cursor: Point): void => {
    const x = origin.x + cursor.x - press.x;
    const y = origin.y + cursor.y - press.y;
    // Never feed getBounds() rounding echoes back into the size ledger (125/150% DPI).
    win.setBounds(movedBounds(size, x, y, dipStepAt(x, y)), false);
    placedAt = cursor;
  };

  const restored = (): void => {
    win.removeListener('unmaximize', restored);
    if (disposed || win.isDestroyed()) { cancel(); return; }
    waitingForRestore = false;
    // During an asynchronous restore the pointer may have travelled further, or been released.
    place(ended ? releasePoint : physicalReleasePoint ?? pointer.current());
    if (ended) cancel();
  };

  /** One step toward `cursor`: a maximized window restores past the threshold, then follows. */
  const step = (cursor: Point): void => {
    // Restore was asked already — whatever the window still reports, it is ours to place now.
    if (restoreAsked) { place(cursor); return; }
    if (win.isMaximized() || restoreFromMaximized) {
      if (!passedTitlebarDragThreshold(press, cursor)) return;
      // Electron guarantees normal-state bounds even while maximized. Read BEFORE unmaximize.
      // https://www.electronjs.org/docs/latest/api/browser-window#wingetnormalbounds
      const normal = normalAtStart ?? win.getNormalBounds();
      size = { width: normal.width, height: normal.height };
      const ratio = Math.max(0, Math.min(1, (press.x - bounds.x) / bounds.width));
      const grabY = Math.max(0, Math.min(size.height, press.y - bounds.y));
      origin = { x: press.x - size.width * ratio, y: press.y - grabY };
      restoreFromMaximized = false;
      restoreAsked = true;
      if (win.isMaximized()) {
        waitingForRestore = true;
        win.on('unmaximize', restored);
        win.unmaximize();
        return;
      }
    }
    place(cursor);
  };

  const move = (): void => {
    if (disposed || ended) return;
    if (win.isDestroyed()) { cancel(); return; }
    // A page move queued before the mouseup must not drag the window after the free mouse.
    if (waitingForRestore || releasedBeats > 0) return;
    step(pointer.current());
  };

  const end = (at?: Point): void => {
    if (disposed || ended) return;
    ended = true;
    // A quick release must still land at the drop point when the OS finishes restoring. When main
    // got the release late, the renderer's drop point wins over wherever the free mouse went since.
    releasePoint = at === undefined && physicalReleasePoint
      ? physicalReleasePoint
      : pickTitlebarPoint(at, pointer.current());
    if (waitingForRestore) return;
    // §3.7 ③ — with a measured drop point, finish at it: the moves before may have followed the
    // cursor after the hand let go (late main), or never arrived at all.
    if (at !== undefined && !win.isDestroyed()
      && (releasePoint.x !== placedAt.x || releasePoint.y !== placedAt.y)) {
      step(releasePoint);
    }
    if (!waitingForRestore) cancel();
  };

  const follow = (pressed: boolean | null = null): void => {
    if (disposed) return;
    if (win.isDestroyed()) { cancel(); return; }
    // Restore changes window geometry, not the physical gesture. A renderer move can ask for
    // restore before our first beat, so observe both hold and release before the waiting branch.
    if (!ended) {
      if (pressed === true) {
        heldSeen = true;
        releasedBeats = 0;
        physicalReleasePoint = undefined;
      } else if (pressed === false && heldSeen) {
        // Keep the first sample fixed while giving the page time to send its measured drop point.
        if (releasedBeats === 0) physicalReleasePoint = pointer.current();
        releasedBeats += 1;
        if (releasedBeats >= TITLEBAR_RELEASE_GRACE_TICKS) end();
      }
    }
    if (disposed) return;
    if (waitingForRestore) {
      // Late or missing `unmaximize` (frameless windows) — finish restoring even after release.
      restoreWaitTicks += 1;
      if (restoreWaitTicks >= TITLEBAR_RESTORE_WAIT_TICKS) restored();
      return;
    }
    if (ended || releasedBeats > 0) return;
    const cursor = pointer.current();
    // A still hand costs nothing — the same bounds are never written twice.
    if (cursor.x === placedAt.x && cursor.y === placedAt.y) return;
    step(cursor);
  };

  win.on('closed', cancel);
  return { move, follow, end, cancel };
}

/**
 * Main's own beat for one gesture (§3.7, 2026-10-16): `follow` every `TITLEBAR_FOLLOW_MS` with the
 * physical button, and give up after `TITLEBAR_GESTURE_MAX_MS` so a gesture whose end never arrives
 * cannot chase the cursor forever. The app-window drag runs the same beat. Returns the stop — call it
 * when the gesture is done.
 */
export function followTitlebarMove(drag: TitlebarMove, pressed: () => boolean | null): () => void {
  const beat = setInterval(() => {
    let held: boolean | null = null;
    try { held = pressed(); } catch { /* an unreadable button is an unknown one */ }
    drag.follow(held);
  }, TITLEBAR_FOLLOW_MS);
  const life = setTimeout(() => { drag.cancel(); }, TITLEBAR_GESTURE_MAX_MS);
  return (): void => {
    clearInterval(beat);
    clearTimeout(life);
  };
}
