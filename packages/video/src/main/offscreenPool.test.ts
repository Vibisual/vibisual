import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** §5.13 (Y) 40-7 ③ — 렌더 창 풀: 읽기·준비 중 실패한 창은 반드시 닫히고, 끝난 창은 쉬다가 다음 일감이 새 문서만 받아 다시 쓴다(유휴 상한 뒤 닫힘). */

const electron = vi.hoisted(() => {
  const windows: FakeWindow[] = [];
  interface FakeWindow {
    readonly opts: unknown;
    destroyed: boolean;
    readonly loadFile: ReturnType<typeof vi.fn>;
    readonly webContents: { executeJavaScript: ReturnType<typeof vi.fn> };
    isDestroyed(): boolean;
    destroy(): void;
  }
  const state = { loadFails: false, reuseRefused: false };
  class BrowserWindow implements FakeWindow {
    destroyed = false;
    readonly loadFile = vi.fn(async () => { if (state.loadFails) throw new Error('load failed'); });
    readonly webContents = {
      executeJavaScript: vi.fn(async (code: string): Promise<unknown> => {
        if (code.includes('__vibiRenderReady')) return true;
        if (code.includes('__vibiRenderError')) return null;
        if (code.includes("typeof window.__vibiRenderOpen === 'function'")) return !state.reuseRefused;
        return true;
      }),
    };
    constructor(readonly opts: unknown) { windows.push(this); }
    isDestroyed(): boolean { return this.destroyed; }
    destroy(): void { this.destroyed = true; }
  }
  return { windows, state, BrowserWindow, nativeImage: { createFromDataURL: () => ({ isEmpty: () => true }) } };
});

vi.mock('electron', () => ({ BrowserWindow: electron.BrowserWindow, nativeImage: electron.nativeImage }));
vi.mock('./windowSize.js', () => ({ growWindowToContent: () => ({ fit: 1 }) }));

import {
  OFFSCREEN_IDLE_MAX,
  OFFSCREEN_IDLE_TTL_MS,
  closeAllOffscreen,
  closeOffscreen,
  offscreenPoolDecision,
  offscreenWindowCount,
  openOffscreen,
  setMainHost,
} from './offscreen.js';
import type { AppMainHost } from '../host.js';

const OPEN = { width: 640, height: 360, project: 'p', docId: 'd' };

beforeEach(() => {
  electron.windows.length = 0;
  electron.state.loadFails = false;
  electron.state.reuseRefused = false;
  setMainHost({ preloadFile: 'preload.js', rendererFile: 'index.html' } as unknown as AppMainHost);
});

afterEach(() => {
  closeAllOffscreen();
  vi.useRealTimers();
});

describe('§5.13 (Y) 40-7 ③ — 오프스크린 창 풀', () => {
  it('keeps at most the budgeted number of idle windows', () => {
    expect(offscreenPoolDecision({ keep: false, idleSameKind: 0 })).toBe('destroy');
    expect(offscreenPoolDecision({ keep: true, idleSameKind: 0 })).toBe('pool');
    expect(offscreenPoolDecision({ keep: true, idleSameKind: OFFSCREEN_IDLE_MAX })).toBe('destroy');
  });

  it('a window that fails to load is destroyed — no orphan outside the sessions', async () => {
    electron.state.loadFails = true;
    await expect(openOffscreen({ ...OPEN, session: 's1' })).rejects.toThrow('load failed');
    expect(electron.windows).toHaveLength(1);
    expect(electron.windows[0]!.destroyed).toBe(true);
    expect(offscreenWindowCount()).toEqual({ active: 0, idle: 0 });
  });

  it('a kept window rests and the next job reuses it with only a new document (no new window, no reload)', async () => {
    await openOffscreen({ ...OPEN, session: 's1' });
    expect(electron.windows).toHaveLength(1);
    const first = electron.windows[0]!;
    await closeOffscreen('s1', true);
    expect(offscreenWindowCount()).toEqual({ active: 0, idle: 1 });
    expect(first.destroyed).toBe(false);
    await openOffscreen({ ...OPEN, docId: 'other', session: 's2' });
    expect(electron.windows).toHaveLength(1);
    expect(first.loadFile).toHaveBeenCalledOnce();
    const handed = first.webContents.executeJavaScript.mock.calls.map((c) => String(c[0])).find((c) => c.includes('"docId":"other"'));
    expect(handed).toBeDefined();
    expect(offscreenWindowCount()).toEqual({ active: 1, idle: 0 });
  });

  it('without keep (or past the budget) the window is destroyed', async () => {
    await openOffscreen({ ...OPEN, session: 'a' });
    await openOffscreen({ ...OPEN, session: 'b' });
    await closeOffscreen('a', true);
    await closeOffscreen('b', true); // 쉬는 칸이 찼다
    expect(offscreenWindowCount()).toEqual({ active: 0, idle: OFFSCREEN_IDLE_MAX });
    expect(electron.windows.filter((w) => w.destroyed)).toHaveLength(2 - OFFSCREEN_IDLE_MAX);
    await openOffscreen({ ...OPEN, session: 'c' });
    await closeOffscreen('c', false);
    expect(electron.windows.filter((w) => !w.destroyed)).toHaveLength(0);
  });

  it('an idle window closes after the idle time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await openOffscreen({ ...OPEN, session: 's1' });
    await closeOffscreen('s1', true);
    expect(offscreenWindowCount().idle).toBe(1);
    vi.advanceTimersByTime(OFFSCREEN_IDLE_TTL_MS + 1);
    expect(offscreenWindowCount().idle).toBe(0);
    expect(electron.windows[0]!.destroyed).toBe(true);
  });

  it('a resting window that refuses the new document is destroyed and a fresh one opens', async () => {
    await openOffscreen({ ...OPEN, session: 's1' });
    await closeOffscreen('s1', true);
    electron.state.reuseRefused = true;
    await openOffscreen({ ...OPEN, session: 's2' });
    expect(electron.windows).toHaveLength(2);
    expect(electron.windows[0]!.destroyed).toBe(true);
    expect(offscreenWindowCount()).toEqual({ active: 1, idle: 0 });
  });

  it('closing everything (main window closed) also closes resting windows', async () => {
    await openOffscreen({ ...OPEN, session: 's1' });
    await closeOffscreen('s1', true);
    closeAllOffscreen();
    expect(electron.windows.every((w) => w.destroyed)).toBe(true);
    expect(offscreenWindowCount()).toEqual({ active: 0, idle: 0 });
  });
});
