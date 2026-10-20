import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { showAppMessageBox } from './appMessageBox';
import { consentDocuments, type ConsentDocuments } from './consentDocuments';
import { consentLocale, consentStrings, CONSENT_LANGUAGES } from './consentStrings';
import { hasCurrentConsent, saveConsent } from './consentRecord';
import { CONSENT_ACTION_ORIGIN, CONSENT_WINDOW, consentPage } from './consentPage';
import { coverFirstShow } from './windowCloak';

let consentWindow: BrowserWindow | null = null;

export function focusConsentWindow(): void {
  if (!consentWindow || consentWindow.isDestroyed()) return;
  if (consentWindow.isMinimized()) consentWindow.restore();
  consentWindow.show();
  consentWindow.focus();
}

/** Keep the accepted window alive until the main window exists (window-all-closed would quit Windows/Linux). */
export function closeConsentWindow(): void {
  if (consentWindow && !consentWindow.isDestroyed()) consentWindow.destroy();
  consentWindow = null;
}

function askConsent(documents: ConsentDocuments, recordPath: string, initialLocale: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const nonce = randomBytes(24).toString('hex');
    const window = new BrowserWindow({
      ...CONSENT_WINDOW, title: 'Vibisual', show: false, autoHideMenuBar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false,
        partition: 'vibisual-consent', spellcheck: false },
    });
    consentWindow = window;
    // §3.7 · §9 「시작 화면」 ② 첫 표시 — Windows 의 첫 표시 흰 프레임을 가림 뒤로(스플래시·본체 창과 같은 길).
    void coverFirstShow(window, { platform: process.platform });
    let settled = false;
    let saving = false;
    const finish = (accepted: boolean): void => { if (!settled) { settled = true; resolve(accepted); } };
    const fail = (error: unknown): void => { if (!settled) { settled = true; reject(error); } };
    const load = (locale: string, saveFailed = false): void => {
      const html = consentPage(documents, locale, nonce, saveFailed);
      void window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(fail);
    };
    // A separate, in-memory session has no app transport or permissions.
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.session.setPermissionCheckHandler(() => false);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    window.webContents.on('will-redirect', (event) => event.preventDefault());
    window.webContents.on('will-navigate', (event, destination) => {
      event.preventDefault();
      if (settled || saving) return;
      let url: URL;
      try { url = new URL(destination); } catch { return; }
      if (url.origin !== CONSENT_ACTION_ORIGIN || url.searchParams.get('nonce') !== nonce) return;
      if (url.pathname === '/decline') { finish(false); return; }
      const locale = url.searchParams.get('locale');
      if (url.pathname !== '/accept' || url.searchParams.get('accepted') !== 'true'
        || !CONSENT_LANGUAGES.some((language) => language.locale === locale) || !locale) return;
      saving = true;
      try {
        saveConsent(recordPath, documents, locale, app.getVersion());
        window.hide();
        finish(true);
      } catch (error) {
        console.error('[consent] could not persist acceptance:', error);
        saving = false;
        load(locale, true);
      }
    });
    window.once('ready-to-show', () => window.show());
    window.webContents.on('render-process-gone', (_event, details) => fail(new Error(`Consent window stopped: ${details.reason}`)));
    window.on('closed', () => { consentWindow = null; finish(false); });
    load(initialLocale);
  });
}

/**
 * Gate packaged desktop apps; development execution does not prompt for the distribution EULA.
 * `onPrompt` runs right before any consent UI appears (the agreement or its load error) — the
 * startup splash hides there so it never sits beside or over the agreement (§3.7 「시작 화면」).
 */
export async function ensureDesktopConsent(options: { onPrompt?: () => void } = {}): Promise<boolean> {
  if (!app.isPackaged) return true;
  const locale = consentLocale(app.getLocale());
  const prompting = (): void => {
    try { options.onPrompt?.(); } catch (error) { console.error('[consent] onPrompt failed:', error); }
  };
  try {
    const documents = consentDocuments();
    const recordPath = join(app.getPath('userData'), 'legal-consent.json');
    if (hasCurrentConsent(recordPath, documents)) return true;
    prompting();
    return await askConsent(documents, recordPath, locale);
  } catch (error) {
    console.error('[consent] could not open agreement:', error);
    prompting();
    try {
      const strings = consentStrings(locale);
      await showAppMessageBox({ type: 'error', title: strings.title, message: strings.loadError,
        buttons: [strings.decline], locale });
    } catch (dialogError) { console.error('[consent] could not show error:', dialogError); }
    return false;
  }
}
