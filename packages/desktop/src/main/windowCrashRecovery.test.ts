import { EventEmitter } from 'node:events';
import type { BrowserWindow, RenderProcessGoneDetails } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { installWindowCrashRecovery, isAppRecoveryPage } from './windowCrashRecovery';

const APP_PAGE = 'file:///C:/Program%20Files/Vibisual/resources/app/out/renderer/index.html';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(url = `${APP_PAGE}?window=ide#session-42`) {
  const state = { url, quitting: false, windowDestroyed: false, contentsDestroyed: false };
  const contents = Object.assign(new EventEmitter(), {
    id: 42,
    getURL: vi.fn(() => state.url),
    isDestroyed: vi.fn(() => state.contentsDestroyed),
    reload: vi.fn(),
  });
  const window = {
    webContents: contents,
    isDestroyed: vi.fn(() => state.windowDestroyed),
  } as unknown as BrowserWindow;
  const answer = deferred<boolean>();
  const askReload = vi.fn(() => answer.promise);
  const log = vi.fn();
  installWindowCrashRecovery(window, {
    appPageUrl: APP_PAGE,
    isQuitting: () => state.quitting,
    askReload,
    log,
  });
  const gone = (reason: RenderProcessGoneDetails['reason'] = 'crashed', exitCode = 1) => {
    contents.emit('render-process-gone', {}, { reason, exitCode });
  };
  return { state, contents, window, answer, askReload, log, gone };
}

// Let the recovery promise complete, including rejection handlers, without Electron or timers.
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('isAppRecoveryPage', () => {
  it.each([
    APP_PAGE,
    `${APP_PAGE}#detached-ide`,
    `${APP_PAGE}?window=command-center#session-42`,
    'file:///C:/Program%20Files/Vibisual/resources/app/out/renderer/./index.html',
  ])('accepts the bundled app document: %s', (url) => {
    expect(isAppRecoveryPage(url, APP_PAGE)).toBe(true);
  });

  it.each([
    'https://example.com/index.html',
    'http://127.0.0.1:3000/index.html',
    'about:blank',
    'data:text/html,hello',
    'not a URL',
    `${APP_PAGE}/preview`,
    APP_PAGE.replace('/renderer/', '/preview/'),
    APP_PAGE.replace('C:/', 'D:/'),
    APP_PAGE.replace('file:///', 'file://remote-host/'),
    'file:///C:/Program%20Files/Vibisual/resources/app/out/renderer/%2Findex.html',
  ])('rejects other documents and remote pages: %s', (url) => {
    expect(isAppRecoveryPage(url, APP_PAGE)).toBe(false);
  });

  it('also requires the expected page to be a valid file URL', () => {
    expect(isAppRecoveryPage(APP_PAGE, 'bad URL')).toBe(false);
    expect(isAppRecoveryPage('https://example.com/index.html', 'https://example.com/index.html')).toBe(false);
  });
});

describe('installWindowCrashRecovery', () => {
  it('records a clean exit without prompting or reloading', async () => {
    const h = harness();
    h.gone('clean-exit', 0);
    await settle();
    expect(h.log).toHaveBeenCalledWith('info', expect.stringContaining('reason=clean-exit exitCode=0'));
    expect(h.askReload).not.toHaveBeenCalled();
    expect(h.contents.reload).not.toHaveBeenCalled();
  });

  it.each(['abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'integrity-failure'] as const)(
    'offers manual recovery for %s without automatically reloading', async (reason) => {
      const h = harness();
      h.gone(reason, -1);
      expect(h.log).toHaveBeenCalledWith('fatal', expect.stringContaining(`reason=${reason} exitCode=-1`));
      expect(h.askReload).toHaveBeenCalledWith(h.window);
      expect(h.contents.reload).not.toHaveBeenCalled();
      h.answer.resolve(false);
      await settle();
      expect(h.contents.reload).not.toHaveBeenCalled();
    },
  );

  it('reloads the existing document once only after consent, preserving its query and hash', async () => {
    const h = harness();
    const originalUrl = h.state.url;
    h.gone();
    expect(h.contents.reload).not.toHaveBeenCalled();
    h.answer.resolve(true);
    await settle();
    expect(h.contents.reload).toHaveBeenCalledExactlyOnceWith();
    expect(h.state.url).toBe(originalUrl);
    expect(h.log).toHaveBeenCalledWith('info', 'webContents=42 renderer recovery requested');
  });

  it('coalesces repeated crash notifications while a prompt is pending', async () => {
    const h = harness();
    h.gone();
    h.gone('oom');
    h.gone('killed');
    expect(h.askReload).toHaveBeenCalledTimes(1);
    h.answer.resolve(true);
    await settle();
    expect(h.contents.reload).toHaveBeenCalledTimes(1);
  });

  it('permits a later prompt after the user cancels an earlier one', async () => {
    const h = harness();
    h.gone();
    h.answer.resolve(false);
    await settle();
    const second = deferred<boolean>();
    h.askReload.mockImplementationOnce(() => second.promise);
    h.gone();
    expect(h.askReload).toHaveBeenCalledTimes(2);
    second.resolve(true);
    await settle();
    expect(h.contents.reload).toHaveBeenCalledTimes(1);
  });

  it.each(['quitting', 'windowDestroyed', 'contentsDestroyed'] as const)(
    'does not prompt when %s is already true', async (flag) => {
      const h = harness();
      h.state[flag] = true;
      h.gone();
      await settle();
      expect(h.askReload).not.toHaveBeenCalled();
      expect(h.contents.reload).not.toHaveBeenCalled();
    },
  );

  it.each(['quitting', 'windowDestroyed', 'contentsDestroyed'] as const)(
    'ignores a pending affirmative answer after %s becomes true', async (flag) => {
      const h = harness();
      h.gone();
      h.state[flag] = true;
      h.answer.resolve(true);
      await settle();
      expect(h.contents.reload).not.toHaveBeenCalled();
    },
  );

  it.each(['https://example.com/login', 'file:///C:/preview/index.html', 'about:blank'])(
    'does not offer app recovery for another page: %s', async (url) => {
      const h = harness(url);
      h.gone();
      await settle();
      expect(h.askReload).not.toHaveBeenCalled();
      expect(h.contents.reload).not.toHaveBeenCalled();
    },
  );

  it.each([
    'https://example.com/login',
    'file:///C:/preview/index.html',
    `${APP_PAGE}?window=other#session-42`,
    `${APP_PAGE}?window=ide#different-session`,
  ])('does not reload after navigation during a pending prompt: %s', async (url) => {
    const h = harness();
    h.gone();
    h.state.url = url;
    h.answer.resolve(true);
    await settle();
    expect(h.contents.reload).not.toHaveBeenCalled();
  });

  it('does not reload a new document that navigated away and back to the same URL', async () => {
    const h = harness();
    const originalUrl = h.state.url;
    h.gone();
    h.contents.emit('did-start-navigation', {}, 'https://example.com', false, true);
    h.state.url = 'https://example.com';
    h.contents.emit('did-start-navigation', {}, originalUrl, false, true);
    h.state.url = originalUrl;
    h.answer.resolve(true);
    await settle();
    expect(h.contents.reload).not.toHaveBeenCalled();
  });

  it.each([false, true])('invalidates an old prompt when main-frame navigation starts (in-place=%s)', async (inPlace) => {
    const h = harness();
    h.gone();
    // The navigation need not finish or change getURL() to supersede the crashed document.
    h.contents.emit('did-start-navigation', {}, h.state.url, inPlace, true);
    h.answer.resolve(true);
    await settle();
    expect(h.contents.reload).not.toHaveBeenCalled();
  });

  it('keeps app recovery available when only an embedded frame navigates', async () => {
    const h = harness();
    h.gone();
    h.contents.emit('did-start-navigation', {}, 'https://example.com/preview', false, false);
    h.answer.resolve(true);
    await settle();
    expect(h.contents.reload).toHaveBeenCalledTimes(1);
  });

  it('allows a fresh crash to recover after a stale prompt was invalidated', async () => {
    const h = harness();
    h.gone();
    h.contents.emit('did-start-navigation', {}, h.state.url, false, true);
    h.answer.resolve(true);
    await settle();
    expect(h.contents.reload).not.toHaveBeenCalled();
    h.askReload.mockResolvedValueOnce(true);
    h.gone();
    await settle();
    expect(h.askReload).toHaveBeenCalledTimes(2);
    expect(h.contents.reload).toHaveBeenCalledTimes(1);
  });

  it('contains dialog rejection and allows a later recovery attempt', async () => {
    const h = harness();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      h.gone();
      h.answer.reject(new Error('dialog unavailable'));
      await settle();
      expect(unhandled).not.toHaveBeenCalled();
      expect(h.log).toHaveBeenCalledWith('error', expect.stringContaining('dialog unavailable'));
      expect(h.contents.reload).not.toHaveBeenCalled();
      h.askReload.mockResolvedValueOnce(true);
      h.gone();
      await settle();
      expect(h.askReload).toHaveBeenCalledTimes(2);
      expect(h.contents.reload).toHaveBeenCalledTimes(1);
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('contains synchronous dialog and reload failures without an escaping exception', async () => {
    const h = harness();
    h.askReload.mockImplementationOnce(() => { throw new Error('dialog closed'); });
    expect(() => h.gone()).not.toThrow();
    await settle();
    expect(h.log).toHaveBeenCalledWith('error', expect.stringContaining('dialog closed'));
    h.askReload.mockResolvedValueOnce(true);
    h.contents.reload.mockImplementationOnce(() => { throw new Error('contents gone'); });
    h.gone();
    await settle();
    expect(h.log).toHaveBeenCalledWith('error', expect.stringContaining('contents gone'));
  });

  it('logging failure cannot prevent manual recovery', async () => {
    const h = harness();
    h.log.mockImplementation(() => { throw new Error('disk unavailable'); });
    expect(() => h.gone()).not.toThrow();
    h.answer.resolve(true);
    await settle();
    expect(h.contents.reload).toHaveBeenCalledTimes(1);
  });

  it('logs preload/main-frame failures while ignoring aborted and subframe loads', () => {
    const h = harness();
    h.contents.emit('preload-error', {}, '/preload.cjs', new Error('preload failed'));
    h.contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', APP_PAGE, true);
    h.contents.emit('did-fail-load', {}, -2, 'preview failed', 'https://example.com', false);
    h.contents.emit('did-fail-load', {}, -6, 'FILE_NOT_FOUND', APP_PAGE, true);
    expect(h.log.mock.calls).toEqual([
      ['error', 'webContents=42 preload-error: preload failed'],
      ['error', 'webContents=42 did-fail-load code=-6 FILE_NOT_FOUND'],
    ]);
    expect(h.askReload).not.toHaveBeenCalled();
  });
});
