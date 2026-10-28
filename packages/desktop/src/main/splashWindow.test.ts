import type { EventEmitter } from 'node:events';
import type { BrowserWindowConstructorOptions } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { openSplash, SPLASH_PORT_CHANNEL, type SplashHandle } from './splashWindow';
import {
  FIRST_SHOW_COVER_FRAMES,
  FIRST_SHOW_COVER_MIN_MS,
  rendererFramesScript,
  SPLASH_FIRST_PAINT_CAP_MS,
  SPLASH_HANDOFF_MS,
  SPLASH_PRESENT_CAP_MS,
} from './splashPolicy';

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
}

interface FakeContents extends EventEmitter {
  executeJavaScript: Mock<(source: string) => Promise<void>>;
  postMessage: Mock;
}

interface FakeWindow extends EventEmitter {
  options: BrowserWindowConstructorOptions;
  webContents: FakeContents;
  load: Deferred;
  presentation: Deferred;
  destroyed: boolean;
  visible: boolean;
  minimized: boolean;
  focused: boolean;
  loadURL: Mock<(url: string) => Promise<void>>;
  show: Mock<() => void>;
  hide: Mock<() => void>;
  focus: Mock<() => void>;
  restore: Mock<() => void>;
  destroy: Mock<() => void>;
}

interface FakeChannel {
  port1: { postMessage: Mock; close: Mock };
  port2: { close: Mock };
}

const electron = vi.hoisted(() => ({
  windows: [] as FakeWindow[],
  channels: [] as FakeChannel[],
  app: null as EventEmitter | null,
  loadError: null as Error | null,
  presentationError: null as Error | null,
  /** 차례로 돌려줄 프레임 대기(비면 창의 `presentation` 하나를 돌려준다). */
  frameQueue: [] as Deferred[],
}));

// 첫 표시 가림(Windows) — 실제 DWM 대신 결과를 정해 준다. 기본은 "가리지 않음"(종전 흐름 그대로).
const cloak = vi.hoisted(() => ({
  covered: false,
  uncovered: true,
  cloakCalls: [] as unknown[],
  uncloakCalls: [] as unknown[],
}));

vi.mock('./windowCloak', () => ({
  cloakBeforeFirstShow: vi.fn((win: unknown) => {
    cloak.cloakCalls.push(win);
    return Promise.resolve(cloak.covered);
  }),
  uncloakWindow: vi.fn((win: unknown) => {
    cloak.uncloakCalls.push(win);
    return cloak.uncovered;
  }),
}));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  const pending = (): Deferred => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  };
  const app = new EventEmitter();
  electron.app = app;

  class BrowserWindow extends EventEmitter {
    load = pending();
    presentation = pending();
    destroyed = false;
    visible = false;
    minimized = false;
    focused = false;
    webContents = Object.assign(new EventEmitter(), {
      session: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() },
      setWindowOpenHandler: vi.fn(),
      postMessage: vi.fn(),
      isDestroyed: vi.fn(() => this.destroyed),
      executeJavaScript: vi.fn((_source: string) => {
        if (electron.presentationError) throw electron.presentationError;
        return (electron.frameQueue.shift() ?? this.presentation).promise;
      }),
    });
    loadURL = vi.fn((_url: string) => {
      if (electron.loadError) throw electron.loadError;
      return this.load.promise;
    });
    isDestroyed = vi.fn(() => this.destroyed);
    isVisible = vi.fn(() => this.visible);
    isMinimized = vi.fn(() => this.minimized);
    isFocused = vi.fn(() => this.focused);
    show = vi.fn(() => { this.visible = true; this.focused = true; });
    hide = vi.fn(() => { this.visible = false; this.focused = false; });
    focus = vi.fn(() => { this.focused = true; });
    restore = vi.fn(() => { this.minimized = false; });
    destroy = vi.fn(() => {
      if (this.destroyed) return;
      this.destroyed = true;
      this.visible = false;
      this.emit('closed');
    });
    constructor(readonly options: BrowserWindowConstructorOptions) {
      super();
      electron.windows.push(this);
    }
  }
  class MessageChannelMain {
    port1 = { postMessage: vi.fn(), close: vi.fn() };
    port2 = { close: vi.fn() };
    constructor() { electron.channels.push(this); }
  }
  return {
    app,
    BrowserWindow,
    MessageChannelMain,
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
  };
});

const flush = () => vi.advanceTimersByTimeAsync(0);

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function start() {
  const settled = vi.fn();
  const result = openSplash({ locale: 'ko', background: '#0a0a0a', kind: 'dark', version: '0.2.3' });
  void result.then(settled);
  const win = electron.windows.at(-1)!;
  const channel = electron.channels.at(-1)!;
  const loaded = () => {
    win.webContents.emit('did-finish-load');
    win.load.resolve();
  };
  return { result, settled, win, channel, loaded };
}

type Harness = ReturnType<typeof start>;

async function show(h: Harness): Promise<void> {
  h.loaded();
  h.win.emit('ready-to-show');
  await flush();
  expect(h.win.show).toHaveBeenCalledTimes(1);
  expect(h.win.webContents.executeJavaScript).toHaveBeenCalledTimes(1);
  expect(h.settled).not.toHaveBeenCalled();
}

function expectStartupWaitCleaned(h: Harness): void {
  expect(vi.getTimerCount()).toBe(0);
  expect(h.win.listenerCount('ready-to-show')).toBe(0);
  expect(h.win.webContents.listenerCount('render-process-gone')).toBe(0);
}

async function expectFailed(h: Harness, shown: boolean): Promise<void> {
  await expect(h.result).resolves.toBeNull();
  expect(h.win.show).toHaveBeenCalledTimes(shown ? 1 : 0);
  expect(h.win.destroy).toHaveBeenCalledTimes(1);
  expect(h.win.destroyed).toBe(true);
  expect(h.win.visible).toBe(false);
  expect(h.channel.port1.close).toHaveBeenCalledTimes(1);
  expect(electron.app!.listenerCount('before-quit')).toBe(0);
  expectStartupWaitCleaned(h);
  // A late load/paint acknowledgement cannot resurrect a failed splash.
  h.loaded();
  h.win.emit('ready-to-show');
  h.win.presentation.resolve();
  await flush();
  expect(h.win.show).toHaveBeenCalledTimes(shown ? 1 : 0);
  expect(vi.getTimerCount()).toBe(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  electron.windows.length = 0;
  electron.channels.length = 0;
  electron.app!.removeAllListeners();
  electron.loadError = null;
  electron.presentationError = null;
  electron.frameQueue.length = 0;
  cloak.covered = false;
  cloak.uncovered = true;
  cloak.cloakCalls.length = 0;
  cloak.uncloakCalls.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const win of electron.windows) if (!win.destroyed) win.destroy();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('openSplash first visible frame', () => {
  it.each(['load-first', 'paint-first'] as const)('waits for both load and paint, then the post-show frames (%s)', async (order) => {
    const h = start();
    expect(h.win.options).toMatchObject({ show: false, backgroundColor: '#0a0a0a' });
    expect(h.win.loadURL).toHaveBeenCalledWith(expect.stringMatching(/^data:text\/html;charset=utf-8,/));
    if (order === 'load-first') h.loaded();
    else h.win.emit('ready-to-show');
    await flush();
    expect(h.win.show).not.toHaveBeenCalled();
    expect(h.win.webContents.executeJavaScript).not.toHaveBeenCalled();
    expect(h.settled).not.toHaveBeenCalled();

    if (order === 'load-first') h.win.emit('ready-to-show');
    else h.loaded();
    await flush();
    expect(h.win.show).toHaveBeenCalledTimes(1);
    expect(h.win.webContents.executeJavaScript).toHaveBeenCalledTimes(1);
    expect(h.win.show.mock.invocationCallOrder[0]).toBeLessThan(h.win.webContents.executeJavaScript.mock.invocationCallOrder[0]);
    expect(h.settled).not.toHaveBeenCalled();

    h.win.presentation.resolve();
    const handle = await h.result;
    expect(handle?.locale).toBe('ko');
    expect(h.win.destroy).not.toHaveBeenCalled();
    expectStartupWaitCleaned(h);
    handle!.close();
    expect(electron.app!.listenerCount('before-quit')).toBe(0);
  });

  it('asks the renderer to cross two animation frames after show', async () => {
    const h = start();
    await show(h);
    const frames: Array<(time: number) => void> = [];
    const raf = (callback: (time: number) => void): number => frames.push(callback);
    const source = h.win.webContents.executeJavaScript.mock.calls[0]![0];
    const rendererResult = new Function('requestAnimationFrame', `return ${source}`)(raf) as Promise<unknown>;
    const frameDone = vi.fn();
    void rendererResult.then(frameDone);
    expect(frames).toHaveLength(1);
    frames.shift()!(0);
    await flush();
    expect(frameDone).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    frames.shift()!(16);
    await rendererResult;
    expect(frameDone).toHaveBeenCalledTimes(1);
    h.win.presentation.resolve();
    (await h.result)!.close();
  });

  it.each(['load-only', 'paint-only', 'neither'] as const)('never shows an incomplete page when the first-paint cap expires (%s)', async (ready) => {
    const h = start();
    if (ready === 'load-only') h.loaded();
    if (ready === 'paint-only') h.win.emit('ready-to-show');
    await vi.advanceTimersByTimeAsync(SPLASH_FIRST_PAINT_CAP_MS - 1);
    expect(h.settled).not.toHaveBeenCalled();
    expect(h.win.show).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expectFailed(h, false);
    expect(h.win.webContents.executeJavaScript).not.toHaveBeenCalled();
  });

  it('does not show a page whose load fails after ready-to-show', async () => {
    const h = start();
    h.win.emit('ready-to-show');
    h.win.load.reject(new Error('load failed'));
    await flush();
    await expectFailed(h, false);
  });

  it('contains synchronous load failure and cleans the hidden window', async () => {
    electron.loadError = new Error('load could not start');
    const h = start();
    await flush();
    await expectFailed(h, false);
  });

  it.each(['render-process-gone', 'closed'] as const)('stops waiting immediately on %s before showing', async (event) => {
    const h = start();
    if (event === 'closed') h.win.destroy();
    else h.win.webContents.emit(event, {}, { reason: 'crashed', exitCode: 1 });
    await flush();
    await expectFailed(h, false);
  });

  it('destroys a visible splash if the presentation wait rejects', async () => {
    const h = start();
    await show(h);
    h.win.presentation.reject(new Error('renderer vanished'));
    await flush();
    await expectFailed(h, true);
  });

  it('contains synchronous execution failure and cleans the visible window', async () => {
    electron.presentationError = new Error('contents unavailable');
    const h = start();
    h.loaded();
    h.win.emit('ready-to-show');
    await flush();
    await expectFailed(h, true);
  });

  it('destroys a visible splash if the presentation cap expires', async () => {
    const h = start();
    await show(h);
    await vi.advanceTimersByTimeAsync(SPLASH_PRESENT_CAP_MS - 1);
    expect(h.settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expectFailed(h, true);
  });

  it.each(['render-process-gone', 'closed'] as const)('stops the post-show wait immediately on %s', async (event) => {
    const h = start();
    await show(h);
    if (event === 'closed') h.win.destroy();
    else h.win.webContents.emit(event, {}, { reason: 'crashed', exitCode: 1 });
    await flush();
    await expectFailed(h, true);
  });

  it('returns a usable handle after presentation and keeps the delayed handoff', async () => {
    const h = start();
    await show(h);
    h.win.presentation.resolve();
    const handle = await h.result as SplashHandle;
    expectStartupWaitCleaned(h);
    expect(h.win.webContents.postMessage).toHaveBeenCalledWith(SPLASH_PORT_CHANNEL, null, [h.channel.port2]);
    handle.stage('loading');
    expect(h.channel.port1.postMessage).toHaveBeenCalledWith(expect.objectContaining({ progress: 0.1 }));
    handle.boot({ phase: 'projects', done: 0, total: 2, label: 'Project' });
    expect(h.channel.port1.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ detail: 'Project' }));
    handle.hide();
    handle.hide();
    expect(h.win.hide).toHaveBeenCalledTimes(1);
    handle.show();
    handle.show();
    expect(h.win.show).toHaveBeenCalledTimes(2);
    h.win.minimized = true;
    handle.focus();
    expect(h.win.restore).toHaveBeenCalledTimes(1);
    expect(handle.isFocused()).toBe(true);
    handle.finish();
    expect(h.channel.port1.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ progress: 1, ceiling: 1 }));
    await vi.advanceTimersByTimeAsync(SPLASH_HANDOFF_MS - 1);
    expect(h.win.destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.win.destroy).toHaveBeenCalledTimes(1);
    expect(h.channel.port1.close).toHaveBeenCalledTimes(1);
    expect(electron.app!.listenerCount('before-quit')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    handle.show();
    handle.focus();
    expect(h.win.show).toHaveBeenCalledTimes(2);
    expect(handle.isFocused()).toBe(false);
  });

  it('finish(after) — 본체가 화면에 나온 뒤에야 잠시 있다가 걷는다(먼저 걷으면 바탕화면이 번쩍인다)', async () => {
    const h = start();
    await show(h);
    h.win.presentation.resolve();
    const handle = await h.result as SplashHandle;
    const onScreen = deferred();
    handle.finish(onScreen.promise);
    expect(h.channel.port1.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ progress: 1, ceiling: 1 }));
    await vi.advanceTimersByTimeAsync(SPLASH_HANDOFF_MS * 5);
    expect(h.win.destroy).not.toHaveBeenCalled();
    onScreen.resolve();
    await flush();
    await vi.advanceTimersByTimeAsync(SPLASH_HANDOFF_MS - 1);
    expect(h.win.destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.win.destroy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('finish(after) — 그 약속이 실패해도 걷는다(스플래시가 남으면 안 된다)', async () => {
    const h = start();
    await show(h);
    h.win.presentation.resolve();
    const handle = await h.result as SplashHandle;
    const onScreen = deferred();
    handle.finish(onScreen.promise);
    onScreen.reject(new Error('main window closed'));
    await flush();
    await vi.advanceTimersByTimeAsync(SPLASH_HANDOFF_MS);
    expect(h.win.destroy).toHaveBeenCalledTimes(1);
  });
});

// 숨겨 만든 창을 처음 보이면 첫 프레임이 흰색이다(첫 칠·바탕색을 기다려도). Windows 는 가린 채 보이고 렌더러가 몇 프레임·최소 시간을
// 지난 뒤 걷는다. 걷기 전에 막히면 화면에 한 번도 안 나온 채 버린다.
describe('openSplash first-show cover (Windows)', () => {
  function startCovered() {
    cloak.covered = true;
    const coverFrames = deferred();
    const settleFrames = deferred();
    electron.frameQueue.push(coverFrames, settleFrames);
    const h = start();
    return { h, coverFrames, settleFrames };
  }

  it('보이기 전에 가리고, 가림 프레임 · 최소 시간이 둘 다 지난 뒤 걷고, 걷은 뒤 두 프레임을 더 지나야 돌려준다', async () => {
    const { h, coverFrames, settleFrames } = startCovered();
    expect(cloak.cloakCalls).toEqual([h.win]);
    h.loaded();
    h.win.emit('ready-to-show');
    await flush();
    expect(h.win.show).toHaveBeenCalledTimes(1);
    const run = h.win.webContents.executeJavaScript;
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toBe(rendererFramesScript(FIRST_SHOW_COVER_FRAMES));

    coverFrames.resolve();
    await flush();
    expect(cloak.uncloakCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(FIRST_SHOW_COVER_MIN_MS - 1);
    expect(cloak.uncloakCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(cloak.uncloakCalls).toEqual([h.win]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]![0]).toBe(rendererFramesScript(2));
    expect(h.settled).not.toHaveBeenCalled();

    settleFrames.resolve();
    const handle = await h.result;
    expect(handle).not.toBeNull();
    expectStartupWaitCleaned(h);
    handle!.close();
  });

  it('최소 시간이 먼저 지나도 가림 프레임이 올 때까지 걷지 않는다', async () => {
    const { h, coverFrames, settleFrames } = startCovered();
    h.loaded();
    h.win.emit('ready-to-show');
    await flush();
    await vi.advanceTimersByTimeAsync(FIRST_SHOW_COVER_MIN_MS * 4);
    expect(cloak.uncloakCalls).toHaveLength(0);
    coverFrames.resolve();
    await flush();
    expect(cloak.uncloakCalls).toHaveLength(1);
    settleFrames.resolve();
    (await h.result)!.close();
  });

  it('가린 채 표시 상한을 넘기면 걷지 않은 채 버린다 — 한 번도 화면에 나오지 않은 창이다', async () => {
    const { h } = startCovered();
    h.loaded();
    h.win.emit('ready-to-show');
    await flush();
    await vi.advanceTimersByTimeAsync(SPLASH_PRESENT_CAP_MS);
    await expectFailed(h, true);
    expect(cloak.uncloakCalls).toHaveLength(0);
  });

  it('가림을 못 걷으면 스플래시 없이 부팅한다 — 안 보이는 스플래시를 남기지 않는다', async () => {
    cloak.uncovered = false;
    const { h, coverFrames } = startCovered();
    h.loaded();
    h.win.emit('ready-to-show');
    await flush();
    coverFrames.resolve();
    await vi.advanceTimersByTimeAsync(FIRST_SHOW_COVER_MIN_MS);
    await expectFailed(h, true);
    expect(cloak.uncloakCalls).toHaveLength(1);
    expect(h.win.webContents.executeJavaScript).toHaveBeenCalledTimes(1);
  });

  it('가린 채 렌더러가 죽으면 곧바로 버린다', async () => {
    const { h } = startCovered();
    h.loaded();
    h.win.emit('ready-to-show');
    await flush();
    h.win.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    await flush();
    await expectFailed(h, true);
    expect(cloak.uncloakCalls).toHaveLength(0);
  });
});
