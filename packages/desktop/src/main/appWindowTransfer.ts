import { isCursorDeepInside, stepRedockDwell } from '@vibisual/shared';
import { acceptReportedSize, movedBounds, type OverlaySize } from './overlaySize';

export interface AppWindowPlacement { width: number; height: number; x?: number; y?: number }
export interface AppWindowGeometry { x: number; y: number; w: number; h: number }
interface Bounds { x: number; y: number; width: number; height: number }

/** Small native-window adapter: transfer behavior is testable without Electron. */
export interface AppTransferWindow {
  readonly id: number;
  readonly webContents: { isDestroyed(): boolean; send(channel: string, payload: unknown): void };
  isDestroyed(): boolean;
  isVisible(): boolean;
  isMinimized(): boolean;
  isMaximized(): boolean;
  getBounds(): Bounds;
  getContentBounds(): Bounds;
  getNormalBounds(): Bounds;
  setBounds(bounds: Bounds): void;
  unmaximize(): void;
  restore(): void;
  show(): void;
  showInactive(): void;
  hide(): void;
  focus(): void;
  close(): void;
}

export interface AppTransferEntry {
  appId: string;
  window: AppTransferWindow;
  origin: AppTransferWindow | null;
  params: Record<string, string>;
  size: OverlaySize;
  writtenAt: number;
}

interface Drag {
  entry: AppTransferEntry;
  offX: number;
  offY: number;
  inside: boolean;
  dwelling: boolean;
  armed: boolean;
  startedAt: number;
  timer: ReturnType<typeof setInterval>;
  holdTimer: ReturnType<typeof setTimeout> | null;
  lifeTimer: ReturnType<typeof setTimeout>;
  ghost: boolean;
}

interface PendingRedock {
  entry: AppTransferEntry;
  target: AppTransferWindow;
  timer: ReturnType<typeof setTimeout>;
  ghost: boolean;
}

interface PendingTarget {
  entry: AppTransferEntry;
  params: Record<string, string>;
  origin: AppTransferWindow | null;
  resolve(): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface AppWindowTransferHost {
  main(): AppTransferWindow | null;
  cursor(): { x: number; y: number };
  dipStep(x: number, y: number): number;
  showGhost(options: { width: number; height: number; grabX: number; grabY: number; label: string; armed: boolean }): boolean;
  hideGhost(): unknown;
  /** Native release detection covers lost renderer capture; null means unavailable. */
  primaryPressed?(): boolean | null;
}

const DRAG_POLL_MS = 16;
const DRAG_HOLD_MAX_MS = 15_000;
const REDOCK_ACK_MS = 5_000;

/** Application-agnostic counterpart to IDE follow/redock, with acknowledged ownership transfer. */
export class AppWindowTransfers {
  private readonly entries = new Map<number, AppTransferEntry>();
  private readonly drags = new Map<number, Drag>();
  private readonly pending = new Map<string, PendingRedock>();
  private readonly targets = new Map<string, PendingTarget>();
  private sequence = 0;

  constructor(private readonly host: AppWindowTransferHost) {}

  register(entry: AppTransferEntry): void { this.entries.set(entry.window.id, entry); }

  unregister(windowId: number): void {
    const entry = this.entries.get(windowId);
    if (!entry) return;
    this.cancelTarget(entry, 'Application window closed before accepting the target');
    this.cancelPending(entry);
    this.stopDrag(entry, true);
    this.entries.delete(windowId);
  }

  updateTarget(windowId: number, params: Record<string, string>): boolean {
    const entry = this.entries.get(windowId);
    if (!entry) return false;
    entry.params = { ...params };
    return true;
  }

  /** A later open can replace a pending return, but must not leave its old acknowledgement live. */
  reuse(windowId: number, params: Record<string, string>, origin: AppTransferWindow | null): void {
    const entry = this.entries.get(windowId);
    if (!entry) return;
    this.cancelPending(entry);
    this.stopDrag(entry, true);
    entry.params = { ...params };
    entry.origin = origin;
  }

  /** Reusing a native window must not overwrite an editor until its dirty-document guard agrees. */
  requestTarget(windowId: number, params: Record<string, string>, origin: AppTransferWindow | null, hash: string): Promise<void> {
    const entry = this.entries.get(windowId);
    if (!entry || entry.window.isDestroyed()) return Promise.reject(new Error('Application window is unavailable'));
    this.cancelTarget(entry, 'Application target request was superseded');
    const requestId = `app-target-${windowId}-${++this.sequence}`;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.targets.delete(requestId);
        reject(new Error('Application window did not accept the target'));
      }, REDOCK_ACK_MS);
      this.targets.set(requestId, { entry, params: { ...params }, origin, resolve, reject, timer });
      try {
        entry.window.webContents.send('vibisual:app:show-target', { requestId, appId: entry.appId, hash });
      } catch {
        this.cancelTarget(entry, 'Application window closed before accepting the target');
      }
    });
  }

  ackTarget(senderId: number, requestId: string, accepted: boolean): boolean {
    const pending = this.targets.get(requestId);
    if (!pending || pending.entry.window.id !== senderId) return false;
    clearTimeout(pending.timer);
    this.targets.delete(requestId);
    if (!accepted || pending.entry.window.isDestroyed()) {
      pending.reject(new Error('Application target change was cancelled'));
      return true;
    }
    this.reuse(senderId, pending.params, pending.origin);
    pending.resolve();
    return true;
  }

  private cancelTarget(entry: AppTransferEntry, message: string): void {
    for (const [id, pending] of this.targets) {
      if (pending.entry !== entry) continue;
      clearTimeout(pending.timer);
      this.targets.delete(id);
      pending.reject(new Error(message));
    }
  }

  reportSize(windowId: number): void {
    const entry = this.entries.get(windowId);
    if (!entry || entry.window.isDestroyed()) return;
    const next = acceptReportedSize({ ledger: entry.size, reported: entry.window.getBounds(),
      writtenAt: entry.writtenAt, now: Date.now(), following: this.drags.has(windowId) });
    if (next) entry.size = next;
  }

  private target(entry: AppTransferEntry): AppTransferWindow | null {
    const origin = entry.origin;
    if (origin && origin.id !== entry.window.id && !origin.isDestroyed() && !origin.webContents.isDestroyed()) return origin;
    const main = this.host.main();
    return main && main.id !== entry.window.id && !main.isDestroyed() && !main.webContents.isDestroyed() ? main : null;
  }

  private inside(entry: AppTransferEntry): boolean {
    const target = this.target(entry);
    return !!target && target.isVisible() && !target.isMinimized()
      && isCursorDeepInside(this.host.cursor(), target.getContentBounds());
  }

  private sendState(entry: AppTransferEntry, dragging: boolean, armed = false): void {
    const payload = { appId: entry.appId, dragging, armed };
    for (const win of new Set([entry.window, this.target(entry)])) {
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
        try { win.webContents.send('vibisual:app:drag-state', payload); } catch { /* closed between guard and send */ }
      }
    }
  }

  private reveal(entry: AppTransferEntry): void {
    if (!entry.window.isDestroyed()) entry.window.showInactive();
  }

  private stopDrag(entry: AppTransferEntry, reveal: boolean, keepGhost = false): Drag | undefined {
    const drag = this.drags.get(entry.window.id);
    if (!drag) return undefined;
    clearInterval(drag.timer);
    clearTimeout(drag.lifeTimer);
    if (drag.holdTimer) clearTimeout(drag.holdTimer);
    this.drags.delete(entry.window.id);
    if (drag.ghost && !keepGhost) this.host.hideGhost();
    if (reveal && drag.dwelling) this.reveal(entry);
    this.sendState(entry, false);
    return drag;
  }

  startDrag(windowId: number): boolean {
    const entry = this.entries.get(windowId);
    if (!entry || entry.window.isDestroyed()) return false;
    if (this.drags.has(windowId)) return true;
    this.cancelPending(entry);
    const win = entry.window;
    const cursor = this.host.cursor();
    const bounds = win.getBounds();
    let offX = cursor.x - bounds.x;
    const offY = cursor.y - bounds.y;
    if (win.isMaximized()) {
      const restored = win.getNormalBounds();
      offX = bounds.width > 0 ? offX / bounds.width * restored.width : offX;
      win.unmaximize();
      entry.size = { width: restored.width, height: restored.height };
    }
    const drag: Drag = { entry, offX, offY, inside: this.inside(entry), dwelling: false,
      armed: false, startedAt: 0, timer: setInterval(() => this.tick(windowId), DRAG_POLL_MS),
      holdTimer: null, lifeTimer: setTimeout(() => this.stopDrag(entry, true), 30_000), ghost: false };
    this.drags.set(windowId, drag);
    this.sendState(entry, true);
    this.tick(windowId);
    return true;
  }

  private tick(windowId: number, detectRelease = true): void {
    const drag = this.drags.get(windowId);
    if (!drag) return;
    const { entry } = drag;
    if (entry.window.isDestroyed()) { this.unregister(windowId); return; }
    const cursor = this.host.cursor();
    const x = cursor.x - drag.offX;
    const y = cursor.y - drag.offY;
    entry.writtenAt = Date.now();
    entry.window.setBounds(movedBounds(entry.size, x, y, this.host.dipStep(x, y)));
    const next = stepRedockDwell({ wasInside: drag.inside, isInside: this.inside(entry),
      dwelling: drag.dwelling, elapsedMs: Date.now() - drag.startedAt });
    drag.inside = next.inside;
    drag.dwelling = next.dwelling;
    if (next.start) {
      drag.startedAt = Date.now();
      drag.ghost = this.showGhost(drag, false);
      if (drag.ghost) entry.window.hide();
      drag.holdTimer = setTimeout(() => this.stopDrag(entry, true), DRAG_HOLD_MAX_MS);
    } else if (next.cancel) {
      if (drag.holdTimer) clearTimeout(drag.holdTimer);
      drag.holdTimer = null;
      if (drag.ghost) this.host.hideGhost();
      drag.ghost = false;
      drag.armed = false;
      this.reveal(entry);
      this.sendState(entry, true, false);
    } else if (next.arm && !drag.armed) {
      drag.armed = true;
      if (drag.ghost) this.showGhost(drag, true);
      this.sendState(entry, true, true);
    }
    if (detectRelease && this.host.primaryPressed?.() === false) this.finishDrag(entry, true);
  }

  private showGhost(drag: Drag, armed: boolean): boolean {
    return this.host.showGhost({ ...drag.entry.size, grabX: drag.offX, grabY: drag.offY,
      label: drag.entry.params['_windowTitle'] ?? drag.entry.params['title'] ?? drag.entry.appId, armed });
  }

  /** The originating renderer can release a hidden window's capture, but not another origin's drag. */
  endDrag(senderId: number, commit = true, appId?: string): boolean {
    const entry = appId
      ? [...this.entries.values()].find(e => e.appId === appId
        && (e.window.id === senderId || this.target(e)?.id === senderId))
      : this.entries.get(senderId);
    if (!entry) return false;
    // Sample the final position before committing, including a leave between the last tick and mouseup.
    this.tick(entry.window.id, false);
    return this.finishDrag(entry, commit);
  }

  private finishDrag(entry: AppTransferEntry, commit: boolean): boolean {
    const drag = this.drags.get(entry.window.id);
    if (!drag) return false;
    if (commit && drag.dwelling) return this.redockEntry(entry);
    this.stopDrag(entry, true);
    if (!entry.window.isDestroyed()) entry.window.focus();
    return true;
  }

  redock(windowId: number): boolean {
    const entry = this.entries.get(windowId);
    return entry ? this.redockEntry(entry) : false;
  }

  private redockEntry(entry: AppTransferEntry): boolean {
    if ([...this.pending.values()].some(p => p.entry === entry)) return true;
    const target = this.target(entry);
    if (!target || entry.window.isDestroyed()) { this.stopDrag(entry, true); return false; }
    const drag = this.stopDrag(entry, false, true);
    const bounds = entry.window.getBounds();
    const targetBounds = target.getContentBounds();
    const requestId = `app-redock-${entry.window.id}-${++this.sequence}`;
    const pending: PendingRedock = { entry, target, ghost: !!drag?.ghost,
      timer: setTimeout(() => this.cancelPending(entry), REDOCK_ACK_MS) };
    this.pending.set(requestId, pending);
    if (target.isMinimized()) target.restore();
    target.show();
    target.focus();
    try {
      target.webContents.send('vibisual:app:redock', { requestId, appId: entry.appId,
        params: { ...entry.params }, geometry: {
          x: bounds.x - targetBounds.x, y: bounds.y - targetBounds.y,
          w: entry.size.width, h: entry.size.height,
        } satisfies AppWindowGeometry });
    } catch {
      this.cancelPending(entry);
      return false;
    }
    return true;
  }

  ackRedock(senderId: number, requestId: string): boolean {
    const pending = this.pending.get(requestId);
    if (!pending || pending.target.id !== senderId || pending.target.isDestroyed()) return false;
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    if (pending.ghost) this.host.hideGhost();
    if (!pending.entry.window.isDestroyed()) pending.entry.window.close();
    return true;
  }

  private cancelPending(entry: AppTransferEntry): void {
    for (const [id, pending] of this.pending) {
      if (pending.entry !== entry) continue;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      if (pending.ghost) this.host.hideGhost();
      this.reveal(entry);
    }
  }
}
