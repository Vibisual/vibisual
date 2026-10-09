import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { dipStepFor } from './overlaySize';
import { startTitlebarMove } from './titlebarMove';

function fixture(options: { maximized?: boolean; sync?: boolean; scale?: number; x?: number; y?: number; grabX?: number; grabY?: number; tryNativeMove?: () => boolean } = {}) {
  const events = new EventEmitter();
  let maximized = options.maximized ?? true;
  let destroyed = false;
  let bounds = { x: options.x ?? 0, y: options.y ?? 0, width: 1920, height: 1080 };
  const normal = { x: 150, y: 160, width: 1000, height: 700 };
  let cursor = { x: bounds.x + (options.grabX ?? 960), y: bounds.y + (options.grabY ?? 12) };
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
  const drag = startTitlebarMove(win as unknown as BrowserWindow, () => cursor, () => dipStepFor(options.scale ?? 1), done, options.tryNativeMove);
  return {
    win, events, drag, done, completeRestore,
    cursor: (x: number, y: number) => { cursor = { x, y }; },
    destroy: () => { destroyed = true; events.emit('closed'); },
  };
}

describe('titlebar restore and move', () => {
  it.each([false, true])('hands a real drag to the native titlebar once (maximized: %s)', (maximized) => {
    const tryNativeMove = vi.fn(() => true);
    const f = fixture({ maximized, tryNativeMove });
    f.cursor(963, 15);
    f.drag.move();
    expect(tryNativeMove).not.toHaveBeenCalled();
    expect(f.win.setBounds).not.toHaveBeenCalled();

    f.cursor(964, 16);
    f.drag.move();
    f.cursor(1000, 150);
    f.drag.move();
    f.drag.end();
    expect(tryNativeMove).toHaveBeenCalledOnce();
    expect(f.win.unmaximize).not.toHaveBeenCalled();
    expect(f.win.setBounds).not.toHaveBeenCalled();
    expect(f.done).toHaveBeenCalledOnce();
    expect(f.events.listenerCount('closed')).toBe(0);
  });

  it('leaves two clicks with small jitter available for the renderer double-click toggle', () => {
    const tryNativeMove = vi.fn(() => true);
    const f = fixture({ tryNativeMove });
    f.cursor(962, 13);
    f.drag.move();
    f.drag.end();
    const second = startTitlebarMove(f.win as unknown as BrowserWindow, () => ({ x: 962, y: 13 }), () => 1, vi.fn(), tryNativeMove);
    second.move();
    second.end();
    expect(tryNativeMove).not.toHaveBeenCalled();
    expect(f.win.unmaximize).not.toHaveBeenCalled();
    expect(f.win.setBounds).not.toHaveBeenCalled();
  });

  it.each([false, true])('keeps manual dragging if native handoff is unavailable (maximized: %s)', (maximized) => {
    const tryNativeMove = vi.fn(() => false);
    const f = fixture({ maximized, sync: true, tryNativeMove });
    f.cursor(980, 42);
    f.drag.move();
    f.cursor(1000, 72);
    f.drag.move();
    expect(tryNativeMove).toHaveBeenCalledOnce();
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
    const second = startTitlebarMove(f.win as unknown as BrowserWindow, () => cursor, () => 1, vi.fn());
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
});
