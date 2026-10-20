import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { dipStepFor } from './overlaySize';
import {
  TITLEBAR_FOLLOW_MS,
  TITLEBAR_GESTURE_MAX_MS,
  TITLEBAR_RELEASE_GRACE_TICKS,
  TITLEBAR_RESTORE_WAIT_TICKS,
} from './titlebarDrag';
import { followTitlebarMove, startTitlebarMove } from './titlebarMove';

function fixture(options: {
  maximized?: boolean; sync?: boolean; scale?: number; x?: number; y?: number; grabX?: number; grabY?: number;
  /** 렌더러가 잰 누른 자리(§3.7 ③). 없으면 main 이 OS 커서로 대신한다. */
  press?: { x: number; y: number };
  /** main 이 누름을 받았을 때 OS 커서가 이미 가 있는 자리(메인이 늦게 받았다). */
  cursorAtStart?: { x: number; y: number };
} = {}) {
  const events = new EventEmitter();
  let maximized = options.maximized ?? true;
  let destroyed = false;
  let bounds = { x: options.x ?? 0, y: options.y ?? 0, width: 1920, height: 1080 };
  const normal = { x: 150, y: 160, width: 1000, height: 700 };
  let cursor = options.cursorAtStart ?? { x: bounds.x + (options.grabX ?? 960), y: bounds.y + (options.grabY ?? 12) };
  const completeRestore = (): void => {
    maximized = false;
    bounds = { ...normal };
    events.emit('unmaximize');
  };
  const win = {
    getBounds: vi.fn(() => ({ ...bounds })),
    getNormalBounds: vi.fn(() => ({ ...normal })),
    isDestroyed: () => destroyed,
    isMaximized: () => maximized,
    unmaximize: vi.fn(() => { if (options.sync) completeRestore(); }),
    setBounds: vi.fn((next: typeof bounds) => {
      // Simulate Windows returning a rounding echo. It must never grow the stored size.
      bounds = { ...next, width: next.width + 1, height: next.height + 1 };
    }),
    on: events.on.bind(events),
    removeListener: events.removeListener.bind(events),
  };
  const done = vi.fn();
  const drag = startTitlebarMove(
    win as unknown as BrowserWindow,
    { current: () => cursor, ...(options.press ? { press: options.press } : {}) },
    () => dipStepFor(options.scale ?? 1),
    done,
  );
  return {
    win, events, drag, done, completeRestore,
    cursor: (x: number, y: number) => { cursor = { x, y }; },
    destroy: () => { destroyed = true; events.emit('closed'); },
  };
}

describe('titlebar restore and move', () => {
  it.each([false, true])('the drag itself moves the window — nothing hands it elsewhere (maximized: %s)', (maximized) => {
    const f = fixture({ maximized, sync: true });
    f.cursor(980, 42);
    f.drag.move();
    f.cursor(1000, 72);
    f.drag.move();
    expect(f.win.setBounds).toHaveBeenLastCalledWith(
      maximized
        ? { x: 500, y: 60, width: 1000, height: 700 }
        : { x: 40, y: 60, width: 1920, height: 1080 },
      false,
    );
    f.drag.end();
    expect(f.done).toHaveBeenCalledOnce();
  });

  it('a click or small jitter leaves maximization and double-click restoration untouched', () => {
    const f = fixture();
    f.cursor(963, 15);
    f.drag.move();
    f.drag.end();
    expect(f.win.unmaximize).not.toHaveBeenCalled();
    expect(f.win.setBounds).not.toHaveBeenCalled();
    expect(f.events.listenerCount('closed')).toBe(0);
    expect(f.done).toHaveBeenCalledOnce();
  });

  it.each([0, 0.25, 0.5, 0.9, 1])('preserves horizontal grab ratio %s and the actual vertical grab offset', (ratio) => {
    const f = fixture({ grabX: 1920 * ratio, grabY: 29 });
    f.cursor(1920 * ratio + 80, 129);
    f.drag.move();
    expect(f.win.setBounds).not.toHaveBeenCalled();
    expect(f.win.getNormalBounds).toHaveBeenCalledOnce();
    f.completeRestore();
    expect(f.win.setBounds).toHaveBeenLastCalledWith({ x: Math.round(920 * ratio + 80), y: 100, width: 1000, height: 700 }, false);
  });

  it('requests asynchronous restore once and follows the latest cursor when it completes', () => {
    const f = fixture();
    f.cursor(980, 42);
    f.drag.move();
    f.cursor(1100, 180);
    f.drag.move();
    expect(f.win.unmaximize).toHaveBeenCalledOnce();
    expect(f.win.setBounds).not.toHaveBeenCalled();
    f.completeRestore();
    expect(f.win.setBounds).toHaveBeenLastCalledWith({ x: 600, y: 168, width: 1000, height: 700 }, false);
    f.cursor(1120, 190);
    f.drag.move();
    expect(f.win.setBounds).toHaveBeenLastCalledWith({ x: 620, y: 178, width: 1000, height: 700 }, false);
    expect(f.win.getBounds).toHaveBeenCalledOnce();
    expect(f.events.listenerCount('unmaximize')).toBe(0);
  });

  it('also works when the OS emits unmaximize synchronously', () => {
    const f = fixture({ sync: true });
    f.cursor(990, 62);
    f.drag.move();
    expect(f.win.setBounds).toHaveBeenCalledExactlyOnceWith({ x: 490, y: 50, width: 1000, height: 700 }, false);
  });

  it('keeps normal size when a previous gesture finishes restoring after a new press', () => {
    const f = fixture();
    f.cursor(980, 42);
    f.drag.move();
    f.drag.end();
    f.drag.cancel();
    let cursor = { x: 980, y: 42 };
    const second = startTitlebarMove(f.win as unknown as BrowserWindow, { current: () => cursor }, () => 1, vi.fn());
    f.completeRestore();
    cursor = { x: 1000, y: 72 };
    second.move();
    expect(f.win.setBounds).toHaveBeenLastCalledWith({ x: 490, y: 30, width: 1000, height: 700 }, false);
    second.end();
  });

  it('a quick release while restoring freezes the drop point instead of following the free mouse', () => {
    const f = fixture();
    f.cursor(980, 42);
    f.drag.move();
    f.cursor(1000, 72);
    f.drag.end();
    f.cursor(1700, 900);
    f.completeRestore();
    expect(f.win.setBounds).toHaveBeenLastCalledWith({ x: 500, y: 60, width: 1000, height: 700 }, false);
    expect(f.done).toHaveBeenCalledOnce();
    expect(f.events.listenerCount('closed')).toBe(0);
  });

  it('works on a display left of and above the primary display', () => {
    const f = fixture({ x: -1920, y: -1080, grabX: 480, grabY: 7 });
    f.cursor(-1400, -900);
    f.drag.move();
    f.completeRestore();
    expect(f.win.setBounds).toHaveBeenLastCalledWith({ x: -1650, y: -907, width: 1000, height: 700 }, false);
  });

  it.each([1, 1.25, 1.5, 1.75, 2])('keeps restored size through repeated moves at scale %s', (scale) => {
    const f = fixture({ scale, sync: true });
    for (let i = 0; i < 60; i += 1) {
      f.cursor(980 + i, 40 + i);
      f.drag.move();
    }
    for (const [bounds] of f.win.setBounds.mock.calls) {
      expect(bounds.width).toBe(1000);
      expect(bounds.height).toBe(700);
    }
    expect(f.win.getBounds).toHaveBeenCalledOnce();
    expect(f.win.getNormalBounds).toHaveBeenCalledOnce();
  });

  it('a normal window follows the first pixel without a restore or size readback', () => {
    const f = fixture({ maximized: false });
    f.cursor(961, 13);
    f.drag.move();
    expect(f.win.setBounds).toHaveBeenLastCalledWith({ x: 1, y: 1, width: 1920, height: 1080 }, false);
    expect(f.win.unmaximize).not.toHaveBeenCalled();
    expect(f.win.getNormalBounds).not.toHaveBeenCalled();
    f.drag.end();
    f.cursor(1000, 400);
    f.drag.move();
    expect(f.win.setBounds).toHaveBeenCalledOnce();
  });

  it.each(['cancel', 'destroy'] as const)('%s removes pending listeners so stale restore never moves a window', (action) => {
    const f = fixture();
    f.cursor(980, 42);
    f.drag.move();
    if (action === 'cancel') f.drag.cancel();
    else f.destroy();
    f.completeRestore();
    f.drag.move();
    expect(f.win.setBounds).not.toHaveBeenCalled();
    expect(f.done).toHaveBeenCalledOnce();
    expect(f.events.listenerCount('unmaximize')).toBe(0);
    expect(f.events.listenerCount('closed')).toBe(0);
  });

  it('native caption restore is not overridden by a main-window centering handler', () => {
    const main = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(main).not.toMatch(/mainWindow\.on\(['"]unmaximize['"]/);
  });

  // §3.7 (2026-10-12) — the logo handle once handed a drag past 4 DIP to the native move loop on
  // Windows and cut this path at once. The handoff reported success when a message was merely
  // queued, so in the real app the logo stopped moving the window (user report). Pin the wiring;
  // comments are stripped because the reasons written there name what was removed.
  it('the logo handle moves the window itself — move-self never hands the gesture to a native move loop', () => {
    const code = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const file of ['./ipc.ts', './titlebarMove.ts']) {
      expect(code(file), `${file} hands the logo drag to a native move again`)
        .not.toMatch(/nativeTitlebarMove|tryNativeMove|PostMessageW/);
    }
    expect(startTitlebarMove.length, 'a fifth parameter is how the handoff was wired in').toBe(4);
  });
});

// §3.7 ③ (2026-10-12) — the renderer measures the press and the drop. The server shares this main
// thread, so a busy main receives move-self late: by then the OS cursor is wherever the hand went
// next. Reading the press there made a finished drag move 0px (user report: "the app never moves
// when I drag it right after launch"). These pin how the renderer's points are used.
describe('renderer-measured press and drop points', () => {
  it('the press comes from the renderer even when main receives it late', () => {
    const f = fixture({ maximized: false, press: { x: 960, y: 12 }, cursorAtStart: { x: 1100, y: 200 } });
    f.drag.move();
    // Old behaviour read the press from the late cursor and moved 0px.
    expect(f.win.setBounds).toHaveBeenLastCalledWith({ x: 140, y: 188, width: 1920, height: 1080 }, false);
  });

  it('a late release lands where the hand let go, not where the free mouse went since', () => {
    const f = fixture({ maximized: false, press: { x: 960, y: 12 } });
    f.cursor(1000, 42);
    f.drag.move();
    f.cursor(1700, 900);
    f.drag.end({ x: 1050, y: 80 });
    expect(f.win.setBounds).toHaveBeenLastCalledWith({ x: 90, y: 68, width: 1920, height: 1080 }, false);
    expect(f.done).toHaveBeenCalledOnce();
  });

  it('an on-time release keeps the live cursor — a slightly different drop point never jumps the window', () => {
    const f = fixture({ maximized: false, press: { x: 960, y: 12 } });
    f.cursor(1000, 42);
    f.drag.move();
    f.drag.end({ x: 1003, y: 45 });
    expect(f.win.setBounds).toHaveBeenCalledOnce();
    expect(f.done).toHaveBeenCalledOnce();
  });

  it('a click on a maximized window stays maximized even with a drop point', () => {
    const f = fixture({ press: { x: 960, y: 12 } });
    f.drag.end({ x: 962, y: 13 });
    expect(f.win.unmaximize).not.toHaveBeenCalled();
    expect(f.win.setBounds).not.toHaveBeenCalled();
    expect(f.done).toHaveBeenCalledOnce();
  });

  it('a late release on a maximized window restores and lands at the drop point', () => {
    const f = fixture({ press: { x: 960, y: 12 } });
    f.cursor(1700, 900);
    f.drag.end({ x: 1000, y: 72 });
    expect(f.win.unmaximize).toHaveBeenCalledOnce();
    expect(f.done).not.toHaveBeenCalled();
    f.completeRestore();
    expect(f.win.setBounds).toHaveBeenLastCalledWith({ x: 500, y: 60, width: 1000, height: 700 }, false);
    expect(f.done).toHaveBeenCalledOnce();
  });

  it('move-self passes the renderer point through and keeps the OS cursor for moves', () => {
    const ipc = readFileSync(new URL('./ipc.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const at = ipc.indexOf("ipcMain.handle('vibisual:window:move-self'");
    expect(at, 'move-self handler not found').toBeGreaterThan(-1);
    const body = ipc.slice(at, ipc.indexOf("ipcMain.handle('vibisual:window:minimize-self'", at));
    expect(body).toContain('const at = toScreenPoint(point);');
    expect(body).toContain('.end(at)');
    expect(body).toContain('{ current: () => screen.getCursorScreenPoint(), ...(at ? { press: at } : {}) }');
    expect(body).toContain('drag.move();');
  });
});

// §3.7 (2026-10-16) — main follows the hand on its own beat too. The logo handle used to move the window
// only on the page's `move`; restoring a maximized window resizes it under the hand, the page can lose the
// gesture right there, and the window stopped following (user instruction: make the logo do what the rest
// of the title bar does). The app-window drag already follows this way — a fixed beat that reads the OS
// cursor itself, and the physical button for the release. These pin that beat.
describe("main's own beat — follows without the page, ends on the physical release", () => {
  it('a maximized window restores and keeps following with no page move at all', () => {
    const f = fixture({ sync: true });
    f.drag.follow(true);
    expect(f.win.unmaximize).not.toHaveBeenCalled();
    f.cursor(980, 42);
    f.drag.follow(true);
    expect(f.win.unmaximize).toHaveBeenCalledOnce();
    expect(f.win.setBounds).toHaveBeenLastCalledWith({ x: 480, y: 30, width: 1000, height: 700 }, false);
    f.cursor(1100, 180);
    f.drag.follow(true);
    expect(f.win.setBounds).toHaveBeenLastCalledWith({ x: 600, y: 168, width: 1000, height: 700 }, false);
    expect(f.done).not.toHaveBeenCalled();
  });

  it('the beat keeps the 4 DIP threshold — a held click never restores a maximized window', () => {
    const f = fixture();
    f.cursor(962, 14);
    for (let i = 0; i < 10; i += 1) f.drag.follow(true);
    expect(f.win.unmaximize).not.toHaveBeenCalled();
    expect(f.win.setBounds).not.toHaveBeenCalled();
  });

  it('a physical release ends the gesture even when the page never sends its mouseup — never chasing the free mouse', () => {
    const f = fixture({ maximized: false });
    f.drag.follow(true);
    f.cursor(1000, 42);
    f.drag.follow(true);
    expect(f.win.setBounds).toHaveBeenLastCalledWith({ x: 40, y: 30, width: 1920, height: 1080 }, false);
    f.cursor(1300, 300);
    for (let i = 0; i < TITLEBAR_RELEASE_GRACE_TICKS - 1; i += 1) f.drag.follow(false);
    expect(f.done).not.toHaveBeenCalled();
    f.drag.follow(false);
    expect(f.done).toHaveBeenCalledOnce();
    expect(f.win.setBounds).toHaveBeenCalledOnce();
  });

  it('records a held button first observed during restore and freezes at its physical release', () => {
    const f = fixture();
    f.cursor(980, 42);
    f.drag.move();
    // A renderer move can request restore before the first button-poll beat.
    f.drag.follow(true);
    f.cursor(1000, 72);
    f.drag.follow(false);
    f.cursor(1700, 900);
    f.completeRestore();
    expect(f.win.setBounds).toHaveBeenCalledExactlyOnceWith({ x: 500, y: 60, width: 1000, height: 700 }, false);
    expect(f.done).not.toHaveBeenCalled();
    // Neither a queued page move nor an unreadable button may resume a released gesture.
    f.drag.move();
    f.drag.follow(null);
    for (let i = 1; i < TITLEBAR_RELEASE_GRACE_TICKS; i += 1) f.drag.follow(false);
    expect(f.done).toHaveBeenCalledOnce();
    expect(f.win.setBounds).toHaveBeenCalledOnce();
  });

  it.each(['event', 'timeout'] as const)('finishes a pending restore at the physical release after grace, without mouseup (%s)', (completion) => {
    const f = fixture();
    f.drag.follow(true);
    f.cursor(980, 42);
    f.drag.move();
    f.cursor(1000, 72);
    f.drag.follow(false);
    f.cursor(1700, 900);
    for (let i = 1; i < TITLEBAR_RELEASE_GRACE_TICKS; i += 1) f.drag.follow(false);
    expect(f.done).not.toHaveBeenCalled();
    expect(f.win.setBounds).not.toHaveBeenCalled();
    if (completion === 'event') f.completeRestore();
    else {
      for (let i = 0; i < TITLEBAR_RESTORE_WAIT_TICKS; i += 1) f.drag.follow(false);
    }
    expect(f.win.setBounds).toHaveBeenCalledExactlyOnceWith({ x: 500, y: 60, width: 1000, height: 700 }, false);
    expect(f.done).toHaveBeenCalledOnce();
    expect(f.events.listenerCount('unmaximize')).toBe(0);
    expect(f.events.listenerCount('closed')).toBe(0);
    f.drag.move();
    f.drag.follow(true);
    expect(f.win.setBounds).toHaveBeenCalledOnce();
  });

  it('keeps a renderer-measured drop point when mouseup arrives during pending-restore release grace', () => {
    const f = fixture();
    f.cursor(980, 42);
    f.drag.move();
    f.drag.follow(true);
    f.cursor(1100, 100);
    f.drag.follow(false);
    f.cursor(1700, 900);
    f.drag.end({ x: 1000, y: 72 });
    f.completeRestore();
    expect(f.win.setBounds).toHaveBeenCalledExactlyOnceWith({ x: 500, y: 60, width: 1000, height: 700 }, false);
    expect(f.done).toHaveBeenCalledOnce();
  });

  it("after a release the page's late move does not chase, and its drop point still lands the window", () => {
    const f = fixture({ maximized: false, press: { x: 960, y: 12 } });
    f.drag.follow(true);
    f.cursor(1000, 42);
    f.drag.follow(true);
    f.cursor(1700, 900);
    f.drag.follow(false);
    f.drag.move();
    expect(f.win.setBounds).toHaveBeenCalledOnce();
    f.drag.end({ x: 1050, y: 80 });
    expect(f.win.setBounds).toHaveBeenLastCalledWith({ x: 90, y: 68, width: 1920, height: 1080 }, false);
    expect(f.done).toHaveBeenCalledOnce();
  });

  it('a release never seen held proves nothing — pen and synthetic input leave the end to the page', () => {
    const f = fixture({ maximized: false });
    f.cursor(1000, 42);
    for (let i = 0; i < TITLEBAR_RELEASE_GRACE_TICKS * 3; i += 1) f.drag.follow(false);
    expect(f.done).not.toHaveBeenCalled();
    expect(f.win.setBounds).toHaveBeenLastCalledWith({ x: 40, y: 30, width: 1920, height: 1080 }, false);
    f.drag.end();
    expect(f.done).toHaveBeenCalledOnce();
  });

  it('where the OS cannot read the button (mac·linux: null) the beat follows and the page ends it', () => {
    const f = fixture({ maximized: false });
    f.cursor(1000, 42);
    f.drag.follow(null);
    f.cursor(1010, 52);
    f.drag.follow(null);
    expect(f.win.setBounds).toHaveBeenLastCalledWith({ x: 50, y: 40, width: 1920, height: 1080 }, false);
    expect(f.done).not.toHaveBeenCalled();
    f.drag.end({ x: 1010, y: 52 });
    expect(f.done).toHaveBeenCalledOnce();
  });

  it('a still hand costs nothing — the beat never writes the same bounds twice', () => {
    const f = fixture({ maximized: false });
    f.cursor(1000, 42);
    for (let i = 0; i < 20; i += 1) f.drag.follow(true);
    expect(f.win.setBounds).toHaveBeenCalledOnce();
  });

  it('a frameless window that keeps reporting maximized is asked to restore once, then attached to the hand', () => {
    // §5.4 #14-1 — a frame:false window can answer "maximized" after unmaximize() and never emit the event.
    const f = fixture();
    f.win.unmaximize.mockImplementation(() => { /* restores on screen but says nothing */ });
    f.cursor(980, 42);
    f.drag.follow(true);
    expect(f.win.unmaximize).toHaveBeenCalledOnce();
    for (let i = 0; i < TITLEBAR_RESTORE_WAIT_TICKS - 1; i += 1) f.drag.follow(true);
    expect(f.win.setBounds).not.toHaveBeenCalled();
    f.drag.follow(true);
    expect(f.win.setBounds).toHaveBeenLastCalledWith({ x: 480, y: 30, width: 1000, height: 700 }, false);
    f.cursor(1100, 180);
    f.drag.move();
    f.drag.follow(true);
    expect(f.win.setBounds).toHaveBeenLastCalledWith({ x: 600, y: 168, width: 1000, height: 700 }, false);
    expect(f.win.unmaximize).toHaveBeenCalledOnce();
    expect(f.events.listenerCount('unmaximize')).toBe(0);
  });

  it('runs every TITLEBAR_FOLLOW_MS with the physical button and stops when told', () => {
    vi.useFakeTimers();
    try {
      const f = fixture({ maximized: false });
      const follow = vi.spyOn(f.drag, 'follow');
      const stop = followTitlebarMove(f.drag, () => true);
      vi.advanceTimersByTime(TITLEBAR_FOLLOW_MS * 3);
      expect(follow).toHaveBeenCalledTimes(3);
      expect(follow).toHaveBeenLastCalledWith(true);
      stop();
      vi.advanceTimersByTime(TITLEBAR_FOLLOW_MS * 3);
      expect(follow).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an unreadable button is an unknown one — the beat keeps following', () => {
    vi.useFakeTimers();
    try {
      const f = fixture({ maximized: false });
      const follow = vi.spyOn(f.drag, 'follow');
      const stop = followTitlebarMove(f.drag, () => { throw new Error('user32 unavailable'); });
      vi.advanceTimersByTime(TITLEBAR_FOLLOW_MS);
      expect(follow).toHaveBeenCalledExactlyOnceWith(null);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a gesture whose end never arrives gives up after TITLEBAR_GESTURE_MAX_MS', () => {
    vi.useFakeTimers();
    try {
      const f = fixture({ maximized: false });
      const stop = followTitlebarMove(f.drag, () => null);
      vi.advanceTimersByTime(TITLEBAR_GESTURE_MAX_MS - 1);
      expect(f.done).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(f.done).toHaveBeenCalledOnce();
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('move-self starts the beat with the physical button and stops it when the gesture is done', () => {
    const ipc = readFileSync(new URL('./ipc.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const at = ipc.indexOf("ipcMain.handle('vibisual:window:move-self'");
    expect(at, 'move-self handler not found').toBeGreaterThan(-1);
    const body = ipc.slice(at, ipc.indexOf("ipcMain.handle('vibisual:window:minimize-self'", at));
    expect(body).toContain('stopFollowing = followTitlebarMove(gesture, appWindowPrimaryPressed);');
    // The beat stops with the gesture — release, page end, cap, a new press or a closed window.
    const done = body.slice(body.indexOf('dipStepAt,'), body.indexOf('titlebarDrags.set(event.sender, gesture);'));
    expect(done).toContain('stopFollowing();');
  });
});
