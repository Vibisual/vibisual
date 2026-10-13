import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  create: (): object => { throw new Error('no window factory'); },
  cursor: vi.fn(() => ({ x: 300, y: 200 })),
}));
vi.mock('electron', () => ({
  BrowserWindow: function BrowserWindow(): object { return mock.create(); },
  screen: { getCursorScreenPoint: mock.cursor },
}));

import { hidePopOutGhost, isPopOutGhostVisible, popOutGhostBounds, showPopOutGhost } from './ghostFrame';

class GhostWindow extends EventEmitter {
  dead = false;
  isDestroyed = (): boolean => this.dead;
  webContents = Object.assign(new EventEmitter(), {
    isDestroyed: (): boolean => this.dead,
    executeJavaScript: vi.fn(() => Promise.resolve()),
  });
  setIgnoreMouseEvents = vi.fn();
  setAlwaysOnTop = vi.fn();
  setBounds = vi.fn();
  getBounds = vi.fn(() => ({ x: 290, y: 190, width: 601, height: 399 }));
  showInactive = vi.fn();
  loadURL = vi.fn((_url: string): Promise<void> => Promise.resolve());
  destroy = vi.fn((): void => { this.dead = true; this.emit('closed'); });
}

const options = { width: 600, height: 400, grabX: 10, grabY: 10 };
let window: GhostWindow;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  window = new GhostWindow();
  mock.create = (): object => window;
});
afterEach(() => {
  hidePopOutGhost();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ghost initialization and ownership', () => {
  it('loads escaped multilingual/special text with cleanup installed before load', () => {
    window.loadURL.mockImplementation((url: string): Promise<void> => {
      expect(window.listenerCount('closed')).toBe(1);
      expect(window.webContents.listenerCount('did-finish-load')).toBe(1);
      const html = Buffer.from(url.split(',')[1]!, 'base64').toString('utf8');
      expect(html).toContain('한글 العربية 😀 &lt;script&gt; &amp; �');
      expect(html).not.toContain('<script>');
      return Promise.resolve();
    });
    expect(showPopOutGhost({ ...options, label: '한글 العربية 😀 <script> & \ud800', hint: `${'a'.repeat(159)}😀` })).toBe(true);
    expect(isPopOutGhostVisible()).toBe(true);
    window.destroy();
    expect(vi.getTimerCount()).toBe(0);
    expect(isPopOutGhostVisible()).toBe(false);
  });

  it.each(['load', 'show'] as const)('cleans up synchronous %s failure without leaving timers', (phase) => {
    const fail = (): never => { throw new Error('native initialization failed'); };
    if (phase === 'load') window.loadURL.mockImplementation(fail);
    else window.showInactive.mockImplementation(fail);
    expect(showPopOutGhost(options)).toBe(false);
    expect(window.destroy).toHaveBeenCalledOnce();
    expect(isPopOutGhostVisible()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up asynchronous load rejection even when diagnostics throw', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => { throw new Error('stderr closed'); });
    window.loadURL.mockRejectedValue(new Error('load failed'));
    expect(showPopOutGhost(options)).toBe(true);
    await Promise.resolve();
    expect(window.destroy).toHaveBeenCalledOnce();
    expect(isPopOutGhostVisible()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not create timers if load synchronously closes the window', () => {
    window.loadURL.mockImplementation((): Promise<void> => { window.destroy(); return Promise.resolve(); });
    expect(showPopOutGhost(options)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not destroy a replacement when the old load rejects late', async () => {
    let reject!: (error: Error) => void;
    window.loadURL.mockReturnValue(new Promise<void>((_resolve, no) => { reject = no; }));
    expect(showPopOutGhost(options)).toBe(true);
    const oldWindow = window;
    hidePopOutGhost();
    window = new GhostWindow();
    expect(showPopOutGhost(options)).toBe(true);
    reject(new Error('old load aborted'));
    await Promise.resolve();
    expect(oldWindow.destroy).toHaveBeenCalledOnce();
    expect(window.destroy).not.toHaveBeenCalled();
    expect(isPopOutGhostVisible()).toBe(true);
    expect(vi.getTimerCount()).toBe(2);
  });
});

// §5.13 (S-10) — 앱 안 창을 끌어내 놓으면 선은 **그 자리에 멈추고**, 새 창은 그 선의 자리·크기에 선다.
//   멈추지 않으면 새 창이 뜨기까지 선이 커서를 따라가 창과 어긋난다.
describe('§5.13 (S-10) settled ghost', () => {
  it('stops polling the cursor in place, and a later drag resumes it', () => {
    expect(showPopOutGhost(options)).toBe(true);
    expect(vi.getTimerCount()).toBe(2); // cursor poll + life net
    const moves = window.setBounds.mock.calls.length;

    expect(showPopOutGhost({ ...options, settled: true })).toBe(true);
    expect(vi.getTimerCount()).toBe(1); // only the life net remains
    mock.cursor.mockReturnValue({ x: 900, y: 700 });
    vi.advanceTimersByTime(200);
    expect(window.setBounds.mock.calls.length).toBe(moves);

    expect(showPopOutGhost(options)).toBe(true);
    expect(vi.getTimerCount()).toBe(2);
    expect(window.setBounds.mock.calls.length).toBeGreaterThan(moves);
    mock.cursor.mockReturnValue({ x: 300, y: 200 });
  });

  it('a ghost first raised after release stands without polling', () => {
    expect(showPopOutGhost({ ...options, settled: true })).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('reports where it stands with the ledger size, not the rounded native size', () => {
    expect(popOutGhostBounds()).toBeNull();
    expect(showPopOutGhost({ ...options, settled: true })).toBe(true);
    expect(popOutGhostBounds()).toEqual({ x: 290, y: 190, width: 600, height: 400 });
    hidePopOutGhost();
    expect(popOutGhostBounds()).toBeNull();
  });
});
