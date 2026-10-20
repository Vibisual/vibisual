import { EventEmitter } from 'node:events';
import type { BrowserWindow, Input } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWindowImmersiveController, IMMERSIVE_SHORTCUT_CHANNEL, IMMERSIVE_STATE_CHANNEL } from './windowImmersive';

class FakeWindow extends EventEmitter {
  fullscreen = false;
  destroyed = false;
  webContents = Object.assign(new EventEmitter(), { isDestroyed: () => this.destroyed, send: vi.fn() });
  setFullScreen = vi.fn<(value: boolean) => void>();
  isFullScreen(): boolean { return this.fullscreen; }
  isDestroyed(): boolean { return this.destroyed; }
  complete(value: boolean): void {
    this.fullscreen = value;
    this.emit(value ? 'enter-full-screen' : 'leave-full-screen');
  }
  close(): void { this.destroyed = true; this.emit('closed'); }
}

const controllers: Array<ReturnType<typeof createWindowImmersiveController>> = [];
function setup(initialFullscreen = false) {
  const win = new FakeWindow();
  win.fullscreen = initialFullscreen;
  const controller = createWindowImmersiveController(win as unknown as BrowserWindow);
  controllers.push(controller);
  return { win, controller };
}

/** Electron 31 Windows emits the event before widget()->SetFullscreen changes
 * the state, unlike the deferred native completion used by the macOS cases. */
function windowsNativeTransition(win: FakeWindow, applied?: (value: boolean) => void) {
  let inSetter = false;
  const reentered = vi.fn();
  win.setFullScreen.mockImplementation((value) => {
    if (inSetter) {
      reentered();
      throw new Error('Native fullscreen setter was re-entered before applying its state');
    }
    inSetter = true;
    try {
      win.emit(value ? 'enter-full-screen' : 'leave-full-screen');
      win.fullscreen = value;
      applied?.(value);
    } finally {
      inSetter = false;
    }
  });
  return reentered;
}

const flushNativeEvents = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function nativeInput(win: FakeWindow, overrides: Partial<Input> = {}): { preventDefault: () => void } {
  const event = { preventDefault: vi.fn() };
  const input: Input = {
    type: 'keyDown', key: 'F11', code: 'F11', isAutoRepeat: false, isComposing: false,
    control: false, meta: false, alt: false, shift: false, location: 0, modifiers: [],
    ...overrides,
  };
  win.webContents.emit('before-input-event', event, input);
  return event;
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.useRealTimers();
});

describe('native immersion shortcut forwarding', () => {
  it.each([false, true])('forwards one F11 press without changing native fullscreen=%s', (initialFullscreen) => {
    const { win } = setup(initialFullscreen);
    const down = nativeInput(win);
    const repeat = nativeInput(win, { isAutoRepeat: true });
    const up = nativeInput(win, { type: 'keyUp' });

    for (const event of [down, repeat, up]) expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(win.webContents.send).toHaveBeenCalledExactlyOnceWith(IMMERSIVE_SHORTCUT_CHANNEL);
    expect(win.setFullScreen).not.toHaveBeenCalled();
    expect(win.fullscreen).toBe(initialFullscreen);
  });

  it.each([
    { control: true }, { meta: true }, { alt: true }, { shift: true },
    { code: 'F10' }, { type: 'char' },
  ] satisfies Partial<Input>[])('leaves nonmatching input untouched: %j', (input) => {
    const { win } = setup();
    expect(nativeInput(win, input).preventDefault).not.toHaveBeenCalled();
    expect(win.webContents.send).not.toHaveBeenCalled();
    expect(win.setFullScreen).not.toHaveBeenCalled();
  });

  it('consumes F11 during composition without forwarding a command or native toggle', () => {
    const { win } = setup();
    expect(nativeInput(win, { key: 'Process', isComposing: true }).preventDefault).toHaveBeenCalledOnce();
    expect(win.webContents.send).not.toHaveBeenCalled();
    expect(win.setFullScreen).not.toHaveBeenCalled();
  });

  it.each(['dispose', 'close'])('removes only its shortcut listener on %s', (action) => {
    const { win, controller } = setup();
    const unrelated = vi.fn();
    win.webContents.on('before-input-event', unrelated);
    if (action === 'dispose') controller.dispose();
    else win.close();

    expect(win.webContents.listenerCount('before-input-event')).toBe(1);
    expect(nativeInput(win).preventDefault).not.toHaveBeenCalled();
    expect(unrelated).toHaveBeenCalledOnce();
    expect(win.webContents.send).not.toHaveBeenCalled();
  });
});

describe('native immersive fullscreen', () => {
  it('waits for native entry and restores windowed state after repeated enable requests', async () => {
    const { win, controller } = setup();
    const completed = vi.fn();
    const enter = controller.setEnabled(true).then(completed);
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    expect(win.setFullScreen).toHaveBeenCalledExactlyOnceWith(true);
    win.complete(true);
    await enter;
    await controller.setEnabled(true);
    expect(win.webContents.send).toHaveBeenCalledExactlyOnceWith(IMMERSIVE_STATE_CHANNEL, { immersive: true });
    const leave = controller.setEnabled(false);
    expect(win.setFullScreen.mock.calls).toEqual([[true], [false]]);
    win.complete(false);
    await leave;
    expect(win.webContents.send).toHaveBeenLastCalledWith(IMMERSIVE_STATE_CHANNEL, { immersive: false });
    expect(win.fullscreen).toBe(false);
  });

  it('preserves a fullscreen state that existed before immersion', async () => {
    const { win, controller } = setup(true);
    await controller.setEnabled(true);
    await controller.setEnabled(false);
    expect(win.setFullScreen).not.toHaveBeenCalled();
    expect(win.fullscreen).toBe(true);
    expect(win.webContents.send.mock.calls).toEqual([
      [IMMERSIVE_STATE_CHANNEL, { immersive: true }],
      [IMMERSIVE_STATE_CHANNEL, { immersive: false }],
    ]);
  });

  it('finishes an asynchronous enter before applying an early exit', async () => {
    const { win, controller } = setup();
    const enter = controller.setEnabled(true);
    const leave = controller.setEnabled(false);
    expect(win.setFullScreen.mock.calls).toEqual([[true]]);
    win.complete(true);
    await flushNativeEvents();
    expect(win.setFullScreen.mock.calls).toEqual([[true], [false]]);
    expect(win.webContents.send).not.toHaveBeenCalled();
    win.complete(false);
    await Promise.all([enter, leave]);
    expect(win.fullscreen).toBe(false);
  });

  it('does not report stale false when a new enable supersedes a pending exit', async () => {
    const { win, controller } = setup();
    const initial = controller.setEnabled(true);
    win.complete(true);
    await initial;
    win.webContents.send.mockClear();
    const leave = controller.setEnabled(false);
    const reenter = controller.setEnabled(true);
    win.complete(false);
    await flushNativeEvents();
    expect(win.setFullScreen.mock.calls).toEqual([[true], [false], [true]]);
    expect(win.webContents.send).not.toHaveBeenCalled();
    win.complete(true);
    await Promise.all([leave, reenter]);
    expect(win.webContents.send).not.toHaveBeenCalled();
    const restore = controller.setEnabled(false);
    win.complete(false);
    await restore;
    expect(win.fullscreen).toBe(false);
  });

  it('lets an external native exit cancel immersion without re-entering fullscreen', async () => {
    const { win, controller } = setup(true);
    await controller.setEnabled(true);
    win.complete(false);
    expect(win.webContents.send).toHaveBeenLastCalledWith(IMMERSIVE_STATE_CHANNEL, { immersive: false });
    await controller.setEnabled(false);
    expect(win.setFullScreen).not.toHaveBeenCalled();
    expect(win.fullscreen).toBe(false);
  });

  it('notifies an external exit even when native entry had not completed', async () => {
    const { win, controller } = setup();
    const enter = controller.setEnabled(true);
    win.complete(false);
    await enter;
    expect(win.webContents.send).toHaveBeenCalledExactlyOnceWith(IMMERSIVE_STATE_CHANNEL, { immersive: false });
  });

  it('restores its entry snapshot when a reloaded renderer initially sends false', async () => {
    const { win, controller } = setup();
    const enter = controller.setEnabled(true);
    win.complete(true);
    await enter;
    const reset = controller.setEnabled(false);
    win.complete(false);
    await reset;
    expect(win.fullscreen).toBe(false);
    await controller.setEnabled(false);
    expect(win.setFullScreen.mock.calls).toEqual([[true], [false]]);
  });

  it('keeps native fullscreen state separate for each window', async () => {
    const first = setup();
    const second = setup(true);
    const enter = first.controller.setEnabled(true);
    await second.controller.setEnabled(true);
    first.win.complete(true);
    await enter;
    await second.controller.setEnabled(false);
    expect(first.win.fullscreen).toBe(true);
    expect(second.win.fullscreen).toBe(true);
    expect(first.win.webContents.send).toHaveBeenCalledTimes(1);
  });

  it('rejects pending work and removes native listeners when the window closes', async () => {
    const { win, controller } = setup();
    const enter = controller.setEnabled(true);
    const rejected = expect(enter).rejects.toThrow('closed');
    win.close();
    await rejected;
    await expect(controller.setEnabled(false)).rejects.toThrow('closed');
    expect(win.listenerCount('enter-full-screen')).toBe(0);
    expect(win.listenerCount('leave-full-screen')).toBe(0);
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('rejects native transition errors and reports that immersion failed', async () => {
    const { win, controller } = setup();
    win.setFullScreen.mockImplementationOnce(() => { throw new Error('native failed'); });
    await expect(controller.setEnabled(true)).rejects.toThrow('native failed');
    expect(win.webContents.send).toHaveBeenCalledExactlyOnceWith(IMMERSIVE_STATE_CHANNEL, { immersive: false });
    await controller.setEnabled(false);
  });

  it('does not strand a late native enter after a transition timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { win, controller } = setup();
    const enter = controller.setEnabled(true);
    const rejected = expect(enter).rejects.toThrow('did not complete');
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    // The renderer cancels its store after rejection, which sends this false IPC.
    await controller.setEnabled(false);
    win.complete(true);
    await flushNativeEvents();
    expect(win.setFullScreen.mock.calls).toEqual([[true], [false]]);
    win.complete(false);
    await flushNativeEvents();
    expect(win.fullscreen).toBe(false);
  });

  it('waits until Windows applies native fullscreen after its early enter and leave events', async () => {
    const { win, controller } = setup();
    const reentered = windowsNativeTransition(win);
    await controller.setEnabled(true);
    expect(win.fullscreen).toBe(true);
    expect(win.setFullScreen).toHaveBeenCalledExactlyOnceWith(true);
    expect(win.webContents.send).toHaveBeenCalledExactlyOnceWith(IMMERSIVE_STATE_CHANNEL, { immersive: true });
    await controller.setEnabled(false);
    expect(win.fullscreen).toBe(false);
    expect(win.setFullScreen.mock.calls).toEqual([[true], [false]]);
    expect(win.webContents.send).toHaveBeenLastCalledWith(IMMERSIVE_STATE_CHANNEL, { immersive: false });
    expect(reentered).not.toHaveBeenCalled();
  });

  it('restores Windows fullscreen when exit arrives before its deferred entry reconciliation', async () => {
    const { win, controller } = setup();
    const reentered = windowsNativeTransition(win);
    const enter = controller.setEnabled(true);
    const leave = controller.setEnabled(false);
    await Promise.all([enter, leave]);
    expect(win.setFullScreen.mock.calls).toEqual([[true], [false]]);
    expect(win.fullscreen).toBe(false);
    expect(win.webContents.send).not.toHaveBeenCalled();
    expect(reentered).not.toHaveBeenCalled();
  });

  it('keeps a newer Windows entry when exit notification precedes its state update', async () => {
    const { win, controller } = setup();
    const reentered = windowsNativeTransition(win);
    await controller.setEnabled(true);
    win.webContents.send.mockClear();
    const leave = controller.setEnabled(false);
    const enter = controller.setEnabled(true);
    await Promise.all([leave, enter]);
    expect(win.fullscreen).toBe(true);
    expect(win.setFullScreen.mock.calls).toEqual([[true], [false], [true]]);
    expect(win.webContents.send).not.toHaveBeenCalled();
    expect(reentered).not.toHaveBeenCalled();
    await controller.setEnabled(false);
    expect(win.fullscreen).toBe(false);
  });

  it.each(['normal', 'maximized'])('covers monitor bounds including the taskbar and restores a %s window through native fullscreen', async (initialState) => {
    const { win, controller } = setup();
    const monitor = {
      bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
      workArea: { x: 1920, y: 0, width: 2560, height: 1392 },
    };
    const original = initialState === 'maximized' ? monitor.workArea
      : { x: 2100, y: 130, width: 1200, height: 900 };
    let bounds = original;
    const setBounds = vi.fn();
    const maximize = vi.fn();
    const unmaximize = vi.fn();
    const setAlwaysOnTop = vi.fn();
    Object.assign(win, { getBounds: () => bounds, setBounds, maximize, unmaximize, setAlwaysOnTop });
    // This is the native contract, not a geometry implementation in the helper:
    // Chromium FullscreenHandler uses rcMonitor and MarkFullscreenWindow. Any
    // workArea sizing/maximization or topmost workaround here would replace it.
    windowsNativeTransition(win, (enabled) => { bounds = enabled ? monitor.bounds : original; });
    await controller.setEnabled(true);
    expect(bounds).toEqual(monitor.bounds);
    expect(bounds.height).toBeGreaterThan(monitor.workArea.height);
    expect(win.fullscreen).toBe(true);
    await controller.setEnabled(false);
    expect(bounds).toEqual(original);
    expect(setBounds).not.toHaveBeenCalled();
    expect(maximize).not.toHaveBeenCalled();
    expect(unmaximize).not.toHaveBeenCalled();
    expect(setAlwaysOnTop).not.toHaveBeenCalled();
  });
});
