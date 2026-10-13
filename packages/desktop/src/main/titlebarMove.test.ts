import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { dipStepFor } from './overlaySize';
import { startTitlebarMove } from './titlebarMove';

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
