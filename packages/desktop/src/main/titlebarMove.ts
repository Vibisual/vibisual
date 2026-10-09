import type { BrowserWindow, Point } from 'electron';
import { movedBounds, type OverlaySize } from './overlaySize';
import { passedTitlebarDragThreshold } from './titlebarDrag';

type TitlebarWindow = Pick<BrowserWindow,
  'getBounds' | 'getNormalBounds' | 'isDestroyed' | 'isMaximized' |
  'unmaximize' | 'setBounds' | 'on' | 'removeListener'>;

export interface TitlebarMove {
  move(): void;
  end(): void;
  cancel(): void;
}

/** One gesture, shared by every caller of move-self; coordinates and size are screen DIP.
 * The explicit logo handle can hand an actual drag to the native move loop while keeping
 * clicks in the renderer. Platforms without that bridge keep the manual restore anchor.
 */
export function startTitlebarMove(
  win: TitlebarWindow,
  getCursor: () => Point,
  dipStepAt: (x: number, y: number) => number,
  onDone: () => void,
  tryNativeMove?: () => boolean,
): TitlebarMove {
  const bounds = win.getBounds();
  const press = getCursor();
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
  };

  const restored = (): void => {
    win.removeListener('unmaximize', restored);
    if (disposed || win.isDestroyed()) { cancel(); return; }
    waitingForRestore = false;
    // During an asynchronous restore the pointer may have travelled further, or been released.
    place(ended ? releasePoint : getCursor());
    if (ended) cancel();
  };

  const move = (): void => {
    if (disposed || ended) return;
    if (win.isDestroyed()) { cancel(); return; }
    if (waitingForRestore) return;
    const cursor = getCursor();
    if (tryNativeMove) {
      // Keep click/jitter in the renderer so its double-click toggle still receives both
      // clicks. Once handed over, only the OS may move, restore or snap this window.
      if (!passedTitlebarDragThreshold(press, cursor)) return;
      const startNativeMove = tryNativeMove;
      tryNativeMove = undefined;
      if (startNativeMove()) { cancel(); return; }
    }
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

  const end = (): void => {
    if (disposed || ended) return;
    ended = true;
    // A quick release must still land at the drop point when the OS finishes restoring.
    releasePoint = getCursor();
    if (!waitingForRestore) cancel();
  };

  win.on('closed', cancel);
  return { move, end, cancel };
}
