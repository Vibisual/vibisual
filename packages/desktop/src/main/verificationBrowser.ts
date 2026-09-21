import { randomUUID } from 'node:crypto';
import { BrowserWindow, session, type WebContents } from 'electron';
import { VERIFICATION_AUTOMATION, type VerificationAction, type VerificationCheck, type VerificationElement } from '@vibisual/shared';
import type { VerificationObservation } from '@vibisual/server';
import { verificationUrl } from './verificationAutomationPolicy';
import { browserInput, verificationDom } from './verificationBrowserInput';
import { normalizeVerificationImage } from './verificationImage';
import { registerVerificationWindow, unregisterVerificationWindow } from './verificationWindows';

const PAINT_SETTLE_MS = 120;
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function within<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out.`)), VERIFICATION_AUTOMATION.actionTimeoutMs); })]);
  } finally { if (timer) clearTimeout(timer); }
}

async function settle(wc: WebContents): Promise<void> {
  // Two paints are not sufficient for navigation: wait for the main document to finish loading too.
  await wait(PAINT_SETTLE_MS);
  if (wc.isDestroyed()) throw new Error('The verification target was closed.');
  if (wc.isLoadingMainFrame()) {
    let done: () => void = () => undefined;
    try {
      await within(new Promise<void>((resolve) => {
        done = resolve;
        wc.once('did-stop-loading', done); wc.once('destroyed', done);
      }), 'Target navigation');
    } finally { wc.removeListener('did-stop-loading', done); wc.removeListener('destroyed', done); }
    await wait(PAINT_SETTLE_MS);
  }
}

/** One hidden browser belongs to one run. It never inherits the application's preload or cookies. */
export class VerificationBrowser {
  private readonly window: BrowserWindow;
  private readonly origin: string;
  private blockedReason: string | undefined;

  constructor(url: string) {
    this.origin = verificationUrl(url).origin;
    const isolatedSession = session.fromPartition(`verify-${randomUUID()}`);
    isolatedSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    isolatedSession.setPermissionCheckHandler(() => false);
    isolatedSession.on('will-download', (event) => { event.preventDefault(); this.blockedReason = 'Downloads are not enabled for this verification target.'; });
    this.window = new BrowserWindow({
      show: false, width: VERIFICATION_AUTOMATION.imageWidth, height: VERIFICATION_AUTOMATION.imageHeight,
      useContentSize: true, skipTaskbar: true, autoHideMenuBar: true,
      webPreferences: { session: isolatedSession, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false },
    });
    const wc = this.window.webContents;
    registerVerificationWindow(wc.id);
    wc.once('destroyed', () => { unregisterVerificationWindow(wc.id); });
    wc.setWindowOpenHandler(() => { this.blockedReason = 'Popups are not enabled for this verification target.'; return { action: 'deny' }; });
    const navigationGuard = (event: Electron.Event, next: string): void => {
      try { verificationUrl(next, this.origin); }
      catch (error) { event.preventDefault(); this.blockedReason = error instanceof Error ? error.message : String(error); }
    };
    wc.on('will-navigate', navigationGuard);
    wc.on('will-redirect', navigationGuard);
    wc.on('login', (event, _details, _authInfo, callback) => { event.preventDefault(); callback(); });
    try { wc.debugger.attach('1.3'); }
    catch (error) { unregisterVerificationWindow(wc.id); this.window.destroy(); throw error; }
  }

  private contents(): WebContents {
    if (this.window.isDestroyed() || this.window.webContents.isDestroyed()) throw new Error('The verification target was closed.');
    return this.window.webContents;
  }

  async navigate(url: string): Promise<void> {
    verificationUrl(url, this.origin);
    this.blockedReason = undefined;
    await within(this.window.loadURL(url), 'Opening verification target');
    await settle(this.contents());
    this.assertBoundary();
  }

  private assertBoundary(): void {
    if (this.blockedReason) throw new Error(this.blockedReason);
    verificationUrl(this.contents().getURL(), this.origin);
  }

  async observe(): Promise<VerificationObservation> {
    this.assertBoundary();
    const wc = this.contents();
    const snapshot = await verificationDom<{ elements: VerificationElement[] }>(wc, { operation: 'snapshot', limit: VERIFICATION_AUTOMATION.maxElements });
    const image = await wc.capturePage(undefined, { stayHidden: true, stayAwake: true });
    return { ...normalizeVerificationImage(image), url: wc.getURL(), title: wc.getTitle(), elements: snapshot.elements };
  }

  async act(action: VerificationAction): Promise<string> {
    this.assertBoundary();
    if (action.kind === 'navigate') await this.navigate(action.url);
    else if (action.kind === 'wait') await wait(Math.min(action.ms, VERIFICATION_AUTOMATION.maxWaitMs));
    else { await browserInput(this.contents(), action, process.platform); await settle(this.contents()); }
    this.assertBoundary();
    return `${action.kind} executed in the selected browser target.`;
  }

  async check(check: VerificationCheck): Promise<{ passed: boolean; detail: string }> {
    this.assertBoundary();
    if (check.kind === 'url') {
      const actual = this.contents().getURL();
      return { passed: actual === check.expected, detail: `Actual URL: ${actual}` };
    }
    if (check.kind === 'screenshot') throw new Error('Screenshot checks are handled by the image comparator.');
    return verificationDom(this.contents(), { operation: 'check', kind: check.kind, selector: check.selector, ...('expected' in check ? { expected: check.expected } : {}) });
  }

  close(): void {
    if (this.window.isDestroyed()) return;
    const wc = this.window.webContents;
    unregisterVerificationWindow(wc.id);
    if (!wc.isDestroyed() && wc.debugger.isAttached()) wc.debugger.detach();
    this.window.destroy();
  }
}
