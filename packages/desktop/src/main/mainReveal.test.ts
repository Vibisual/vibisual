/**
 * §3.7 · §9 「시작 화면(스플래시)」 ④ 본체 창 공개 — **스플래시는 본체가 실제로 화면에 나온 뒤에 걷는다.**
 *
 * Windows 는 본체 창의 첫 프레임들을 DWM 가림 뒤에서 흘려 보낸다(처음 보이는 창의 첫 장이 흰색이다 — `windowCloak.ts`).
 * 그래서 보인(`show`) 순간과 화면에 나온 순간이 다르다. 그 사이에 스플래시를 걷으면 바탕화면이 번쩍이고, "본체 창을 보였다"
 * 기록도 실제보다 이르게 찍힌다. 판정 자체(`decideMainReveal`)는 `splashPolicy.test.ts` 가 표로 지킨다.
 */
import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MAIN_READY_CHANNEL, observeMainWindowReady, startMainReveal } from './mainReveal';
import type { SplashHandle } from './splashWindow';
import type { FirstShowCover } from './windowCloak';

type ReadyHandler = (event: { sender: { id: number } }) => boolean;
const ipc = vi.hoisted(() => ({ handlers: new Map<string, ReadyHandler>() }));
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn((channel: string, handler: ReadyHandler) => ipc.handlers.set(channel, handler)) },
}));

class FakeWindow extends EventEmitter {
  webContents = Object.assign(new EventEmitter(), { id: 7 });
  destroyed = false;
  visible = false;
  show = vi.fn(() => { this.visible = true; this.emit('show'); });
  showInactive = vi.fn(() => { this.visible = true; this.emit('show'); });
  isDestroyed(): boolean { return this.destroyed; }
  isVisible(): boolean { return this.visible; }
  destroy(): void { this.destroyed = true; this.visible = false; this.emit('closed'); }
}

type FakeSplash = SplashHandle & {
  finish: Mock<(after?: Promise<unknown>) => void>;
  close: Mock<() => void>;
};

function fakeSplash(focused: boolean): FakeSplash {
  return {
    locale: 'ko',
    stage: vi.fn(),
    boot: vi.fn(),
    hide: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    isFocused: vi.fn(() => focused),
    finish: vi.fn<(after?: Promise<unknown>) => void>(),
    close: vi.fn<() => void>(),
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('본체 창 공개 — 화면에 나온 뒤에 스플래시를 걷는다', () => {
  it('막대는 지금 채우고(finish 에 화면에 나오는 약속을 넘긴다) · 창을 보이고 · 기록은 화면에 나온 뒤에', async () => {
    const win = new FakeWindow();
    const splash = fakeSplash(true);
    const onScreen = deferred<FirstShowCover>();
    const onRevealed = vi.fn();
    const reveal = startMainReveal({
      window: win as unknown as BrowserWindow,
      splash,
      pendingStartupJobs: () => 0,
      firstShow: onScreen.promise,
      onRevealed,
    });
    expect(reveal.pending).toBe(true);
    win.webContents.emit('render-process-gone'); // 기다릴 이유가 없는 공개(사유 forced) — 순서만 본다
    expect(reveal.pending).toBe(false);
    expect(splash.finish).toHaveBeenCalledWith(onScreen.promise);
    expect(win.show).toHaveBeenCalledTimes(1);
    expect(win.showInactive).not.toHaveBeenCalled();
    expect(splash.finish.mock.invocationCallOrder[0]).toBeLessThan(win.show.mock.invocationCallOrder[0]!);
    await vi.advanceTimersByTimeAsync(0);
    expect(onRevealed).not.toHaveBeenCalled();

    onScreen.resolve('uncovered');
    await vi.advanceTimersByTimeAsync(0);
    expect(onRevealed).toHaveBeenCalledTimes(1);
    expect(onRevealed).toHaveBeenCalledWith('forced', expect.any(Number), 'uncovered');
    expect(splash.close).not.toHaveBeenCalled();
  });

  it('다른 앱으로 간 사람의 손은 뺏지 않는다(showInactive)', () => {
    const win = new FakeWindow();
    const splash = fakeSplash(false);
    startMainReveal({ window: win as unknown as BrowserWindow, splash, pendingStartupJobs: () => 0 });
    win.emit('unresponsive');
    expect(win.showInactive).toHaveBeenCalledTimes(1);
    expect(win.show).not.toHaveBeenCalled();
  });

  it('가림 약속이 없으면(가리지 않는 실행) 보이는 즉시로 친다', async () => {
    const win = new FakeWindow();
    const splash = fakeSplash(true);
    const onRevealed = vi.fn();
    startMainReveal({ window: win as unknown as BrowserWindow, splash, pendingStartupJobs: () => 0, onRevealed });
    win.webContents.emit('did-fail-load', {}, -2, 'failed', 'file:///index.html', true);
    const handed = splash.finish.mock.calls[0]![0] as Promise<FirstShowCover>;
    await expect(handed).resolves.toBe('plain');
    await vi.advanceTimersByTimeAsync(0);
    expect(onRevealed).toHaveBeenCalledWith('forced', expect.any(Number), 'plain');
  });

  it('보이기 전에 창이 닫히면 스플래시를 곧바로 걷는다(종전 그대로)', () => {
    const win = new FakeWindow();
    const splash = fakeSplash(true);
    startMainReveal({ window: win as unknown as BrowserWindow, splash, pendingStartupJobs: () => 0 });
    win.emit('closed');
    expect(splash.close).toHaveBeenCalledTimes(1);
    expect(splash.finish).not.toHaveBeenCalled();
  });
});

describe('main readiness without a splash', () => {
  const invokeReady = (senderId = 7): boolean => {
    const handler = ipc.handlers.get(MAIN_READY_CHANNEL);
    expect(handler, 'the real renderer-ready IPC must remain registered without a splash').toBeDefined();
    return handler!({ sender: { id: senderId } });
  };
  function start() {
    const win = new FakeWindow(), onScreen = deferred<FirstShowCover>(), onRevealed = vi.fn();
    observeMainWindowReady({ window: win as unknown as BrowserWindow, firstShow: onScreen.promise, onRevealed });
    return { win, onScreen, onRevealed };
  }

  it.each([
    ['renderer', 'show', 'presentation'],
    ['renderer', 'presentation', 'show'],
    ['show', 'renderer', 'presentation'],
    ['show', 'presentation', 'renderer'],
    ['presentation', 'renderer', 'show'],
    ['presentation', 'show', 'renderer'],
  ] as const)('requires every signal in order %s → %s → %s', async (...order) => {
    const h = start();
    h.win.emit('ready-to-show');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.onRevealed).not.toHaveBeenCalled();
    expect(h.win.show).not.toHaveBeenCalled(); // The observer must not alter the fallback show policy.
    for (const signal of order) {
      expect(h.onRevealed).not.toHaveBeenCalled();
      if (signal === 'renderer') expect(invokeReady()).toBe(true);
      if (signal === 'show') h.win.show();
      if (signal === 'presentation') h.onScreen.resolve('uncovered');
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(h.onRevealed).toHaveBeenCalledExactlyOnceWith('ready', expect.any(Number), 'uncovered');
    expect(invokeReady()).toBe(false);
    h.win.show();
    expect(h.onRevealed).toHaveBeenCalledTimes(1);
    expect(h.win.listenerCount('closed')).toBe(0);
    expect(h.win.webContents.listenerCount('render-process-gone')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not treat another window or a first paint as the main renderer being ready', async () => {
    const h = start();
    h.win.emit('ready-to-show');
    h.win.show();
    h.onScreen.resolve('plain');
    await vi.advanceTimersByTimeAsync(0);
    expect(invokeReady(99)).toBe(false);
    expect(h.onRevealed).not.toHaveBeenCalled();
    expect(invokeReady()).toBe(true);
    expect(h.onRevealed).toHaveBeenCalledExactlyOnceWith('ready', expect.any(Number), 'plain');
  });

  it.each(['renderer', 'show', 'presentation'] as const)('does not report a window closed before %s arrives', async missing => {
    const h = start();
    if (missing !== 'renderer') invokeReady();
    if (missing !== 'show') h.win.show();
    if (missing !== 'presentation') h.onScreen.resolve('plain');
    await vi.advanceTimersByTimeAsync(0);
    h.win.destroy();
    expect(invokeReady()).toBe(false);
    h.onScreen.resolve('plain');
    h.win.emit('show');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.onRevealed).not.toHaveBeenCalled();
    expect(h.win.listenerCount('show')).toBe(0);
    expect(h.win.webContents.listenerCount('did-fail-load')).toBe(0);
  });

  it.each(['render-process-gone', 'did-fail-load'] as const)('does not report a renderer that fails before presentation (%s)', async event => {
    const h = start();
    invokeReady();
    h.win.show();
    h.win.webContents.emit(event, {}, -2, 'failed', 'file:///index.html', true);
    h.onScreen.resolve('plain');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.onRevealed).not.toHaveBeenCalled();
    expect(invokeReady()).toBe(false);
  });

  it('waits for the main window to be visible again if it was hidden before renderer readiness', async () => {
    const h = start();
    h.win.show();
    h.win.visible = false;
    h.onScreen.resolve('plain');
    await vi.advanceTimersByTimeAsync(0);
    invokeReady();
    expect(h.onRevealed).not.toHaveBeenCalled();
    h.win.show();
    expect(h.onRevealed).toHaveBeenCalledExactlyOnceWith('ready', expect.any(Number), 'plain');
  });

  it('does not report a first-show cover that ends because the window closed', async () => {
    const h = start();
    invokeReady();
    h.win.show();
    h.onScreen.resolve('closed');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.onRevealed).not.toHaveBeenCalled();
    expect(invokeReady()).toBe(false);
  });
});
