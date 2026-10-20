import { randomBytes } from 'node:crypto';
import { BrowserWindow } from 'electron';
import { appMessagePage, messageButtonIndex, messageResponse, type AppMessageOptions } from './appMessagePage';
import { readSplashCache } from './splashCache';
import { splashPalette } from './splashPolicy';
import { coverFirstShow } from './windowCloak';

let active = 0;
/** Closing a parentless notice must not itself start another application quit. Its caller owns that decision. */
export function hasAppMessageBox(): boolean { return active > 0; }

export function showAppMessageBox(options: AppMessageOptions, owner?: BrowserWindow | null): Promise<{ response: number }> {
  return new Promise((resolve, reject) => {
    if (options.buttons.length === 0) { reject(new Error('A message needs at least one button')); return; }
    let theme = options.theme;
    if (!theme) { try { theme = readSplashCache() ?? undefined; } catch { /* Startup has no theme yet. */ } }
    const nonce = randomBytes(24).toString('hex');
    const parent = owner && !owner.isDestroyed() ? owner : undefined;
    const win = new BrowserWindow({
      width: 540, height: options.detail ? 360 : 270, minWidth: 360, minHeight: 220,
      title: options.title, frame: false, show: false, resizable: true, minimizable: false, maximizable: false,
      fullscreenable: false, autoHideMenuBar: true, backgroundColor: splashPalette(theme?.background, theme?.kind).background,
      ...(parent ? { parent, modal: true, skipTaskbar: true } : { center: true }),
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false,
        partition: 'vibisual-message', spellcheck: false },
    });
    active += 1;
    // §3.7 · §9 「시작 화면」 ② 첫 표시 — Windows 의 첫 표시 흰 프레임을 가림 뒤로(스플래시·본체 창과 같은 길).
    void coverFirstShow(win, { platform: process.platform });
    let settled = false;
    let cap: NodeJS.Timeout | undefined;
    const finish = (response: number, error?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(cap);
      // Remove this preload-free window before shutdown enumerates draft-flush targets.
      // Keep the lifetime flag through the next turn so window-all-closed cannot start a second quit.
      if (error) reject(error); else resolve({ response });
      try { if (!win.isDestroyed()) win.destroy(); } finally { setImmediate(() => { active -= 1; }); }
    };
    const cancel = messageButtonIndex(options.cancelId, options.buttons.length);
    const contents = win.webContents;
    contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    contents.session.setPermissionCheckHandler(() => false);
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.on('will-redirect', (event) => event.preventDefault());
    contents.on('will-navigate', (event, destination) => {
      event.preventDefault();
      const response = messageResponse(destination, nonce, options.buttons.length);
      if (response !== null) finish(response);
    });
    contents.once('render-process-gone', () => finish(cancel, new Error('Message window stopped')));
    win.on('close', (event) => { if (!settled) { event.preventDefault(); finish(cancel); } });
    win.once('closed', () => finish(cancel));
    win.once('ready-to-show', () => { clearTimeout(cap); if (!settled) { win.show(); win.focus(); } });
    cap = setTimeout(() => finish(cancel, new Error('Message window did not load')), 10_000);
    void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(appMessagePage({ ...options, theme }, nonce)))
      .catch((error: unknown) => finish(cancel, error));
  });
}
