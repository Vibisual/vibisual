/**
 * §3.7 · §9 「시작 화면(스플래시)」 ② 첫 표시 — 처음 보일 때의 흰 프레임을 DWM 가림 뒤로 보내는 층.
 *
 * 사용자 보고(2026-10-16): "처음에 왜 계속 흰색 화면이 로딩 화면 띄울 때 뜨냐 — 지금은 파박 바뀌긴 하는데, 렉이면 편법을
 * 쓰던가". 화면 밖 측정 창(앱과 같은 Electron 31.7.7 · PrintWindow 표본 + DWM 가림 상태)이 재현했다 — 숨겨 만든 창을 처음
 * 보이면 첫 장들이 #ffffff(실제 스플래시 코드는 표시 뒤 40~60ms). 가린 채 보이면 그 흰 장은 가린 동안에만 찍히고, 걷는
 * 순간에는 이미 바탕색이었다(실제 코드 스플래시 3회·본체 2회 — 화면에 나온 흰 표본 0).
 *
 * 여기서 지키는 것: 보이기 **전에** 건다 · 첫 show 뒤 프레임과 최소 시간이 **둘 다** 지나야 걷는다 · 무엇이 막혀도 상한 뒤에는
 * 걷는다(안 나오는 창이 흰 프레임보다 나쁘다) · 보이는 창은 가리지 않는다 · Windows 밖에서는 koffi 를 읽지도 않는다.
 */
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIRST_SHOW_COVER_CAP_MS,
  FIRST_SHOW_COVER_FRAMES,
  FIRST_SHOW_COVER_MIN_MS,
  rendererFramesScript,
} from './splashPolicy';

const dwm = vi.hoisted(() => ({
  calls: [] as Array<{ hwnd: bigint; attribute: number; value: number; size: number }>,
  result: 0,
  loadError: null as Error | null,
  loads: 0,
  definitions: [] as string[],
}));

vi.mock('koffi', () => {
  const load = (name: string) => {
    dwm.loads += 1;
    if (dwm.loadError) throw dwm.loadError;
    if (name !== 'dwmapi.dll') throw new Error(`unexpected library ${name}`);
    return {
      func: (definition: string) => {
        dwm.definitions.push(definition);
        return (hwnd: bigint, attribute: number, value: Buffer, size: number): number => {
          dwm.calls.push({ hwnd, attribute, value: value.readInt32LE(0), size });
          return dwm.result;
        };
      },
    };
  };
  return { default: { load }, load };
});

interface Deferred { promise: Promise<unknown>; resolve(): void; reject(error: Error): void }
function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<unknown>((yes, no) => { resolve = () => yes(true); reject = no; });
  return { promise, resolve, reject };
}

class FakeWindow extends EventEmitter {
  visible = false;
  destroyed = false;
  frames = deferred();
  handle: Buffer;
  webContents = { executeJavaScript: vi.fn((_source: string) => this.frames.promise) };
  constructor(hwnd = 0x1a2bn, bytes = 8) {
    super();
    this.handle = Buffer.alloc(bytes);
    if (bytes === 8) this.handle.writeBigUInt64LE(hwnd);
    else this.handle.writeUInt32LE(Number(hwnd));
  }
  getNativeWindowHandle(): Buffer { return this.handle; }
  isVisible(): boolean { return this.visible; }
  isDestroyed(): boolean { return this.destroyed; }
  show(): void { this.visible = true; this.emit('show'); }
  hide(): void { this.visible = false; this.emit('hide'); }
  destroy(): void { this.destroyed = true; this.visible = false; this.emit('closed'); }
}

const asWindow = (w: FakeWindow): BrowserWindow => w as unknown as BrowserWindow;
/** 동적 import 와 그 뒤의 약속 사슬까지 흘려보낸다(setImmediate 는 가짜 시계 밖이다). */
const settle = async (): Promise<void> => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r)); };

let mod: typeof import('./windowCloak');

beforeEach(async () => {
  dwm.calls.length = 0;
  dwm.definitions.length = 0;
  dwm.result = 0;
  dwm.loadError = null;
  dwm.loads = 0;
  vi.resetModules();
  mod = await import('./windowCloak');
  // 가림 모듈이 처음 가릴 때 동적으로 읽는 koffi 묶음을 미리 읽어 둔다 — 시험 변환 시간이 순서를 흔들지 않게.
  await import('./dwmCloak');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function expectCleaned(win: FakeWindow): void {
  expect(win.listenerCount('show')).toBe(0);
  expect(win.listenerCount('closed')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
}

describe('Windows 밖', () => {
  it.each(['darwin', 'linux'] as const)('%s — koffi 를 읽지도 않고 곧바로 plain', async (platform) => {
    const win = new FakeWindow();
    await expect(mod.coverFirstShow(asWindow(win), { platform })).resolves.toBe('plain');
    expect(dwm.loads).toBe(0);
    expect(dwm.calls).toHaveLength(0);
    expectCleaned(win);
  });
});

describe('Windows — 처음 보일 때만 가린다', () => {
  it('보이기 전에 걸고, 첫 show 뒤 프레임 · 최소 시간이 둘 다 지나야 걷는다', async () => {
    const win = new FakeWindow(0x1a2bn);
    const result = mod.coverFirstShow(asWindow(win), { platform: 'win32' });
    const done = vi.fn();
    void result.then(done);
    await settle();
    expect(dwm.definitions[0]).toContain('DwmSetWindowAttribute');
    expect(dwm.calls).toEqual([{ hwnd: 0x1a2bn, attribute: 13, value: 1, size: 4 }]);
    expect(win.webContents.executeJavaScript).not.toHaveBeenCalled();

    win.show();
    expect(win.webContents.executeJavaScript).toHaveBeenCalledWith(rendererFramesScript(FIRST_SHOW_COVER_FRAMES));
    win.frames.resolve();
    await settle();
    expect(dwm.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(FIRST_SHOW_COVER_MIN_MS - 1);
    expect(dwm.calls).toHaveLength(1);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(dwm.calls[1]).toEqual({ hwnd: 0x1a2bn, attribute: 13, value: 0, size: 4 });
    await expect(result).resolves.toBe('uncovered');
    expectCleaned(win);
  });

  it('최소 시간이 먼저 지나도 프레임이 올 때까지 가린다(고정 지연이 아니다)', async () => {
    const win = new FakeWindow();
    const result = mod.coverFirstShow(asWindow(win), { platform: 'win32' });
    await settle();
    win.show();
    await vi.advanceTimersByTimeAsync(FIRST_SHOW_COVER_MIN_MS * 3);
    expect(dwm.calls).toHaveLength(1);
    win.frames.resolve();
    await settle();
    await expect(result).resolves.toBe('uncovered');
    expect(dwm.calls.map((c) => c.value)).toEqual([1, 0]);
    expectCleaned(win);
  });

  it('프레임 소식이 끝내 없으면 상한에서 그래도 걷는다 — 안 나오는 창이 더 나쁘다', async () => {
    const win = new FakeWindow();
    const result = mod.coverFirstShow(asWindow(win), { platform: 'win32' });
    await settle();
    win.show();
    await vi.advanceTimersByTimeAsync(FIRST_SHOW_COVER_CAP_MS - 1);
    expect(dwm.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('forced');
    expect(dwm.calls.map((c) => c.value)).toEqual([1, 0]);
    expectCleaned(win);
    // 늦게 온 프레임 소식은 아무것도 다시 하지 않는다.
    win.frames.resolve();
    await settle();
    expect(dwm.calls).toHaveLength(2);
  });

  it('렌더러가 답하지 못하면(죽었거나 이동 중) 기다리지 않고 걷는다', async () => {
    const win = new FakeWindow();
    const result = mod.coverFirstShow(asWindow(win), { platform: 'win32' });
    await settle();
    win.show();
    win.frames.reject(new Error('render process gone'));
    await settle();
    await expect(result).resolves.toBe('forced');
    expect(dwm.calls.map((c) => c.value)).toEqual([1, 0]);
    expectCleaned(win);
  });

  it('두 번째 표시부터는 손대지 않는다', async () => {
    const win = new FakeWindow();
    const result = mod.coverFirstShow(asWindow(win), { platform: 'win32' });
    await settle();
    win.show();
    win.frames.resolve();
    await vi.advanceTimersByTimeAsync(FIRST_SHOW_COVER_MIN_MS);
    await expect(result).resolves.toBe('uncovered');
    win.hide();
    win.show();
    await settle();
    expect(win.webContents.executeJavaScript).toHaveBeenCalledTimes(1);
    expect(dwm.calls).toHaveLength(2);
  });

  it('보이기 전에 닫히면 걷을 것도 없다', async () => {
    const win = new FakeWindow();
    const result = mod.coverFirstShow(asWindow(win), { platform: 'win32' });
    await settle();
    win.destroy();
    await expect(result).resolves.toBe('closed');
    expect(dwm.calls).toHaveLength(1);
    expectCleaned(win);
  });

  it('가린 채 보인 뒤 걷기 전에 닫히면 시계를 거둔다', async () => {
    const win = new FakeWindow();
    const result = mod.coverFirstShow(asWindow(win), { platform: 'win32' });
    await settle();
    win.show();
    win.destroy();
    await expect(result).resolves.toBe('closed');
    expectCleaned(win);
  });
});

describe('Windows — 가리지 않는 경우(종전대로 보인다)', () => {
  it('이미 보이는 창은 가리지 않는다 — 걷을 때까지 화면에서 사라진다', async () => {
    const win = new FakeWindow();
    win.visible = true;
    await expect(mod.coverFirstShow(asWindow(win), { platform: 'win32' })).resolves.toBe('plain');
    expect(dwm.calls).toHaveLength(0);
  });

  it('묶는 사이에 먼저 보였으면 걸지 않는다', async () => {
    const win = new FakeWindow();
    const result = mod.coverFirstShow(asWindow(win), { platform: 'win32' });
    win.show();
    await expect(result).resolves.toBe('plain');
    expect(dwm.calls).toHaveLength(0);
    expectCleaned(win);
  });

  it('koffi·dwmapi 를 못 읽으면 plain — 한 번 실패하면 다시 읽지 않는다', async () => {
    dwm.loadError = new Error('no dwmapi');
    await expect(mod.coverFirstShow(asWindow(new FakeWindow()), { platform: 'win32' })).resolves.toBe('plain');
    await expect(mod.coverFirstShow(asWindow(new FakeWindow()), { platform: 'win32' })).resolves.toBe('plain');
    expect(dwm.loads).toBe(1);
    expect(dwm.calls).toHaveLength(0);
  });

  it('DWM 가 거절하면(HRESULT ≠ 0) plain', async () => {
    dwm.result = -2147024890; // E_HANDLE
    const win = new FakeWindow();
    await expect(mod.coverFirstShow(asWindow(win), { platform: 'win32' })).resolves.toBe('plain');
    expectCleaned(win);
  });

  it('핸들이 없는 창(가짜·닫힌 창)은 koffi 를 읽기 전에 plain', async () => {
    const win = new FakeWindow();
    (win as unknown as { getNativeWindowHandle: () => Buffer }).getNativeWindowHandle = () => { throw new Error('destroyed'); };
    await expect(mod.coverFirstShow(asWindow(win), { platform: 'win32' })).resolves.toBe('plain');
    expect(dwm.loads).toBe(0);
  });

  it('메서드가 모자란 창도 던지지 않는다(다른 시험의 가짜 창)', async () => {
    await expect(mod.coverFirstShow({} as BrowserWindow, { platform: 'win32' })).resolves.toBe('plain');
  });

  it('32비트 핸들도 읽는다', async () => {
    const win = new FakeWindow(0x77n, 4);
    void mod.coverFirstShow(asWindow(win), { platform: 'win32' });
    await settle();
    expect(dwm.calls[0]?.hwnd).toBe(0x77n);
  });
});

describe('배선 — 시작 때 뜨는 우리 창은 만든 직후 가림을 건다', () => {
  const MAIN_DIR = dirname(fileURLToPath(import.meta.url));
  const source = (file: string): string => readFileSync(join(MAIN_DIR, file), 'utf8').replace(/\r\n/g, '\n');

  it.each([
    ['consentWindow.ts', 'const window = new BrowserWindow({', 'void coverFirstShow(window, { platform: process.platform });', "window.once('ready-to-show'"],
    ['appMessageBox.ts', 'const win = new BrowserWindow({', 'void coverFirstShow(win, { platform: process.platform });', "win.once('ready-to-show'"],
    ['index.ts', 'const mainWindow = new BrowserWindow({', 'const firstShow = coverFirstShow(mainWindow, { platform: process.platform });', "mainWindow.on('ready-to-show'"],
  ])('%s — 창을 만든 뒤, 보이는 길보다 먼저', (file, create, cover, showPath) => {
    const src = source(file);
    const at = src.indexOf(create);
    expect(at).toBeGreaterThan(-1);
    expect(src.indexOf(cover)).toBeGreaterThan(at);
    expect(src.indexOf(cover)).toBeLessThan(src.indexOf(showPath));
  });

  it('스플래시는 보이기 직전에 가림을 기다리고, 걷은 뒤에야 본체를 읽게 한다', () => {
    const src = source('splashWindow.ts');
    const cloak = src.indexOf('const cloaking = cloakBeforeFirstShow(win, process.platform);');
    const wait = src.indexOf('const covered = await cloaking;');
    const show = src.indexOf('win.show();', wait);
    expect(cloak).toBeGreaterThan(-1);
    expect(cloak).toBeLessThan(wait);
    expect(wait).toBeLessThan(show);
    expect(src.indexOf('if (!uncloakWindow(win))', show)).toBeGreaterThan(show);
  });
});
