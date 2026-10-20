import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasAppMessageBox, showAppMessageBox } from './appMessageBox';
import type { AppMessageOptions } from './appMessagePage';

interface FakeWindow extends EventEmitter {
  options: Record<string, unknown>; destroyed: boolean; html: string;
  webContents: EventEmitter & { session: { setPermissionRequestHandler: ReturnType<typeof vi.fn>; setPermissionCheckHandler: ReturnType<typeof vi.fn> }; setWindowOpenHandler: ReturnType<typeof vi.fn> };
  show: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn>; hide: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>; isDestroyed(): boolean;
}
const state = vi.hoisted(() => ({ windows: [] as FakeWindow[], failLoad: false }));
vi.mock('./splashCache', () => ({ readSplashCache: () => null }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class BrowserWindow extends EventEmitter {
    destroyed = false; html = '';
    webContents = Object.assign(new EventEmitter(), { session: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() }, setWindowOpenHandler: vi.fn() });
    show = vi.fn(); focus = vi.fn(); hide = vi.fn();
    destroy = vi.fn(() => { this.destroyed = true; this.emit('closed'); });
    isDestroyed(): boolean { return this.destroyed; }
    constructor(public options: Record<string, unknown>) { super(); state.windows.push(this); }
    loadURL(url: string): Promise<void> {
      this.html = decodeURIComponent(url.slice(url.indexOf(',') + 1));
      return state.failLoad ? Promise.reject(new Error('load failed')) : Promise.resolve();
    }
  }
  return { BrowserWindow };
});

const options: AppMessageOptions = { title: 'Unsaved work', message: 'Close the app?', buttons: ['Cancel', 'Close'], defaultId: 0, cancelId: 0 };
const current = (): FakeWindow => state.windows[state.windows.length - 1]!;
const responseUrl = (win: FakeWindow, button: number): string => {
  const nonce = /"nonce":"([a-f0-9]+)"/.exec(win.html)![1];
  return `https://message.vibisual.invalid/answer?nonce=${nonce}&button=${button}`;
};
beforeEach(() => { state.windows.length = 0; state.failLoad = false; vi.useFakeTimers(); });
afterEach(async () => { await vi.runAllTimersAsync(); vi.useRealTimers(); });

describe('independent designed message window', () => {
  it('uses an isolated sandbox, rejects external navigation and resolves only an authenticated button', async () => {
    const result = showAppMessageBox(options); const win = current();
    expect(win.options).toMatchObject({ frame: false, show: false, webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false, partition: 'vibisual-message',
    } });
    expect((win.options.webPreferences as Record<string, unknown>).preload).toBeUndefined();
    const deny = vi.fn(); win.webContents.session.setPermissionRequestHandler.mock.calls[0]![0]({}, 'camera', deny);
    expect(deny).toHaveBeenCalledWith(false);
    expect(win.webContents.session.setPermissionCheckHandler.mock.calls[0]![0]()).toBe(false);
    expect(win.webContents.setWindowOpenHandler.mock.calls[0]![0]()).toEqual({ action: 'deny' });
    const event = { preventDefault: vi.fn() };
    win.webContents.emit('will-navigate', event, 'https://example.com');
    expect(event.preventDefault).toHaveBeenCalledOnce(); expect(win.destroy).not.toHaveBeenCalled();
    win.emit('ready-to-show'); expect(win.show).toHaveBeenCalledOnce(); expect(win.focus).toHaveBeenCalledOnce();
    const activeAtClose = vi.fn(); win.once('closed', () => activeAtClose(hasAppMessageBox()));
    win.webContents.emit('will-navigate', event, responseUrl(win, 1));
    await expect(result).resolves.toEqual({ response: 1 });
    expect(hasAppMessageBox()).toBe(true);
    expect(activeAtClose).toHaveBeenCalledWith(true);
    expect(win.destroy).toHaveBeenCalledOnce();
    await vi.runAllTimersAsync(); expect(win.destroy).toHaveBeenCalledOnce(); expect(hasAppMessageBox()).toBe(false);
  });

  it('window close cancels and duplicate responses cannot approve after cancellation', async () => {
    const result = showAppMessageBox(options); const win = current(); const event = { preventDefault: vi.fn() };
    win.emit('close', event); win.webContents.emit('will-navigate', event, responseUrl(win, 1));
    await expect(result).resolves.toEqual({ response: 0 });
    await vi.runAllTimersAsync(); expect(win.destroy).toHaveBeenCalledOnce();
  });

  it.each(['load', 'crash', 'timeout'])('fails safely on %s and releases its window', async (kind) => {
    state.failLoad = kind === 'load';
    const result = showAppMessageBox(options); const assertion = expect(result).rejects.toThrow(); const win = current();
    if (kind === 'crash') win.webContents.emit('render-process-gone');
    if (kind === 'timeout') await vi.advanceTimersByTimeAsync(10_000);
    await assertion; await vi.runAllTimersAsync();
    expect(win.destroy).toHaveBeenCalledOnce(); expect(hasAppMessageBox()).toBe(false);
  });
});
