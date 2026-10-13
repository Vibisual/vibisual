import type { BrowserWindow, Point } from 'electron';
import { movedBounds, type OverlaySize } from './overlaySize';
import { passedTitlebarDragThreshold, pickTitlebarPoint } from './titlebarDrag';

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
  /** The hand let go. `at` is the renderer-measured drop point (§3.7 ③). */
  end(at?: Point): void;
  cancel(): void;
}

/** One gesture, shared by every caller of move-self; coordinates and size are screen DIP.
 * The logo handle moves the window itself on every OS. It does not hand the gesture to the
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
    place(ended ? releasePoint : pointer.current());
    if (ended) cancel();
  };

  /** One step toward `cursor`: a maximized window restores past the threshold, then follows. */
  const step = (cursor: Point): void => {
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
    if (waitingForRestore) return;
    step(pointer.current());
  };

  const end = (at?: Point): void => {
    if (disposed || ended) return;
    ended = true;
    // A quick release must still land at the drop point when the OS finishes restoring. When main
    // got the release late, the renderer's drop point wins over wherever the free mouse went since.
    releasePoint = pickTitlebarPoint(at, pointer.current());
    if (waitingForRestore) return;
    // §3.7 ③ — with a measured drop point, finish at it: the moves before may have followed the
    // cursor after the hand let go (late main), or never arrived at all.
    if (at !== undefined && !win.isDestroyed()
      && (releasePoint.x !== placedAt.x || releasePoint.y !== placedAt.y)) {
      step(releasePoint);
    }
    if (!waitingForRestore) cancel();
  };

  win.on('closed', cancel);
  return { move, end, cancel };
}
