import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppWindowTransfers, type AppTransferEntry, type AppTransferWindow } from './appWindowTransfer';

function fakeWindow(id: number, x = 0, y = 0) {
  let bounds = { x, y, width: 800, height: 600 };
  let visible = true;
  let destroyed = false;
  const win: AppTransferWindow = {
    id,
    webContents: { isDestroyed: () => destroyed, send: vi.fn() },
    isDestroyed: () => destroyed, isVisible: () => visible,
    isMinimized: () => false, isMaximized: () => false,
    getBounds: () => ({ ...bounds }), getContentBounds: () => ({ ...bounds }),
    getNormalBounds: () => ({ ...bounds }),
    setBounds: vi.fn((next) => { bounds = { ...next }; }),
    unmaximize: vi.fn(), restore: vi.fn(), focus: vi.fn(),
    show: vi.fn(() => { visible = true; }), showInactive: vi.fn(() => { visible = true; }),
    hide: vi.fn(() => { visible = false; }), close: vi.fn(() => { destroyed = true; }),
  };
  return win;
}

function setup(primaryPressed?: () => boolean | null) {
  const main = fakeWindow(1, 100, 50);
  const source = fakeWindow(2, 1_100, 100);
  let cursor = { x: 1_150, y: 120 };
  let target: AppTransferWindow | null = main;
  const showGhost = vi.fn(() => true);
  const hideGhost = vi.fn();
  const transfers = new AppWindowTransfers({ main: () => target, cursor: () => cursor,
    dipStep: () => 1, showGhost, hideGhost, ...(primaryPressed ? { primaryPressed } : {}) });
  const entry: AppTransferEntry = { appId: 'vibistudio', window: source, origin: main,
    params: { projectId: 'C:/project', docId: 'before' }, size: { width: 800, height: 600 }, writtenAt: 0 };
  transfers.register(entry);
  return { transfers, main, source, entry, showGhost, hideGhost,
    cursor: (x: number, y: number) => { cursor = { x, y }; },
    clearTarget: () => { target = null; entry.origin = null; } };
}

function redockPayload(win: AppTransferWindow) {
  const calls = vi.mocked(win.webContents.send).mock.calls;
  const sent = calls.find(([channel]) => channel === 'vibisual:app:redock');
  expect(sent).toBeDefined();
  return sent![1] as { requestId: string; appId: string; params: Record<string, string>;
    geometry: { x: number; y: number; w: number; h: number } };
}

describe('app window ownership transfer', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('returns the latest document and geometry, closing only after the origin acknowledges', () => {
    const s = setup();
    s.transfers.updateTarget(2, { projectId: 'C:/project', docId: 'current' });
    expect(s.transfers.redock(2)).toBe(true);
    const sent = redockPayload(s.main);
    expect(sent.params.docId).toBe('current');
    expect(sent.geometry).toEqual({ x: 1_000, y: 50, w: 800, h: 600 });
    expect(s.source.close).not.toHaveBeenCalled();
    expect(s.transfers.ackRedock(99, sent.requestId)).toBe(false);
    expect(s.source.close).not.toHaveBeenCalled();
    expect(s.transfers.ackRedock(1, sent.requestId)).toBe(true);
    expect(s.source.close).toHaveBeenCalledOnce();
    expect(s.transfers.ackRedock(1, sent.requestId)).toBe(false);
  });

  it('uses the project window that opened the app instead of the main window', () => {
    const s = setup();
    const project = fakeWindow(3, 400, 200);
    s.entry.origin = project;
    expect(s.transfers.redock(2)).toBe(true);
    expect(redockPayload(project).geometry).toEqual({ x: 700, y: -100, w: 800, h: 600 });
    expect(s.main.webContents.send).not.toHaveBeenCalled();
    expect(s.transfers.ackRedock(1, redockPayload(project).requestId)).toBe(false);
  });

  it('falls back to main when the origin has closed, and retains source when neither exists', () => {
    const s = setup();
    const project = fakeWindow(3);
    project.close();
    s.entry.origin = project;
    expect(s.transfers.redock(2)).toBe(true);
    expect(redockPayload(s.main)).toBeTruthy();
    s.transfers.reuse(2, s.entry.params, null);
    s.clearTarget();
    expect(s.transfers.redock(2)).toBe(false);
    expect(s.source.close).not.toHaveBeenCalled();
  });

  it('keeps the app when the receiver never acknowledges', () => {
    const s = setup();
    s.transfers.redock(2);
    const sent = redockPayload(s.main);
    vi.advanceTimersByTime(5_001);
    expect(s.source.isVisible()).toBe(true);
    expect(s.source.close).not.toHaveBeenCalled();
    expect(s.transfers.ackRedock(1, sent.requestId)).toBe(false);
  });

  it('invalidates stale acknowledgements when the existing app opens another target', () => {
    const s = setup();
    s.transfers.redock(2);
    const sent = redockPayload(s.main);
    s.transfers.reuse(2, { projectId: 'C:/other', docId: 'new' }, s.main);
    expect(s.transfers.ackRedock(1, sent.requestId)).toBe(false);
    expect(s.source.close).not.toHaveBeenCalled();
    expect(s.entry.params.docId).toBe('new');
  });

  it('commits a reused target and its origin only after that editor accepts', async () => {
    const s = setup();
    const nextOrigin = fakeWindow(3);
    const requested = s.transfers.requestTarget(2, { docId: 'new' }, nextOrigin, 'app=vibistudio&docId=new');
    const sent = vi.mocked(s.source.webContents.send).mock.calls.find(([channel]) => channel === 'vibisual:app:show-target')![1] as { requestId: string };
    expect(s.entry.params.docId).toBe('before');
    expect(s.entry.origin).toBe(s.main);
    expect(s.transfers.ackTarget(99, sent.requestId, true)).toBe(false);
    expect(s.transfers.ackTarget(2, sent.requestId, true)).toBe(true);
    await expect(requested).resolves.toBeUndefined();
    expect(s.entry.params.docId).toBe('new');
    expect(s.entry.origin).toBe(nextOrigin);
  });

  it('rejecting a reused target preserves the old document and origin', async () => {
    const s = setup();
    const requested = s.transfers.requestTarget(2, { docId: 'new' }, fakeWindow(3), 'app=vibistudio');
    const result = expect(requested).rejects.toThrow('cancelled');
    const sent = vi.mocked(s.source.webContents.send).mock.calls[0]![1] as { requestId: string };
    s.transfers.ackTarget(2, sent.requestId, false);
    await result;
    expect(s.entry.params.docId).toBe('before');
    expect(s.entry.origin).toBe(s.main);
  });

  it('a missing target acknowledgement preserves the old editor and rejects late acknowledgements', async () => {
    const s = setup();
    const requested = s.transfers.requestTarget(2, { docId: 'new' }, fakeWindow(3), 'app=vibistudio');
    const result = expect(requested).rejects.toThrow('did not accept');
    const sent = vi.mocked(s.source.webContents.send).mock.calls[0]![1] as { requestId: string };
    vi.advanceTimersByTime(5_001);
    await result;
    expect(s.entry.params.docId).toBe('before');
    expect(s.transfers.ackTarget(2, sent.requestId, true)).toBe(false);
    expect(s.source.close).not.toHaveBeenCalled();
  });

  it('closing an editor while target acceptance is pending rejects the open', async () => {
    const s = setup();
    const requested = s.transfers.requestTarget(2, { docId: 'new' }, s.main, 'app=vibistudio');
    const result = expect(requested).rejects.toThrow('closed');
    s.transfers.unregister(2);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('app title drag matches IDE enter/dwell/release behavior', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('does not redock a window merely picked up over its origin', () => {
    const s = setup();
    s.cursor(300, 200);
    s.transfers.startDrag(2);
    vi.advanceTimersByTime(600);
    s.transfers.endDrag(2);
    expect(s.showGhost).not.toHaveBeenCalled();
    expect(s.main.webContents.send).not.toHaveBeenCalledWith('vibisual:app:redock', expect.anything());
  });

  it('shows a ghost on entry, arms after dwell, and allows the origin to release the hidden source', () => {
    const s = setup();
    s.transfers.startDrag(2);
    s.cursor(300, 200);
    vi.advanceTimersByTime(16);
    expect(s.showGhost).toHaveBeenLastCalledWith(expect.objectContaining({ armed: false }));
    expect(s.source.isVisible()).toBe(false);
    vi.advanceTimersByTime(512);
    expect(s.showGhost).toHaveBeenLastCalledWith(expect.objectContaining({ armed: true }));
    expect(s.source.close).not.toHaveBeenCalled();
    expect(s.transfers.endDrag(1, true, 'vibistudio')).toBe(true);
    expect(redockPayload(s.main).geometry).toEqual({ x: 150, y: 130, w: 800, h: 600 });
    expect(s.source.close).not.toHaveBeenCalled();
    s.transfers.ackRedock(1, redockPayload(s.main).requestId);
    expect(s.source.close).toHaveBeenCalledOnce();
    expect(s.hideGhost).toHaveBeenCalledOnce();
  });

  it('a deliberate release during the ghost commits even before the dwell highlight', () => {
    const s = setup();
    s.transfers.startDrag(2);
    s.cursor(300, 200);
    vi.advanceTimersByTime(16);
    expect(s.transfers.endDrag(2)).toBe(true);
    expect(redockPayload(s.main)).toBeTruthy();
  });

  it('leaving before release cancels even if the last polling tick was inside', () => {
    const s = setup();
    s.transfers.startDrag(2);
    s.cursor(300, 200);
    vi.advanceTimersByTime(16);
    s.cursor(1_200, 200);
    s.transfers.endDrag(2);
    expect(s.source.isVisible()).toBe(true);
    expect(s.hideGhost).toHaveBeenCalled();
    expect(s.main.webContents.send).not.toHaveBeenCalledWith('vibisual:app:redock', expect.anything());
  });

  it('explicit cancellation restores the native window and clears all timers', () => {
    const s = setup();
    s.transfers.startDrag(2);
    s.cursor(300, 200);
    vi.advanceTimersByTime(600);
    expect(s.transfers.endDrag(2, false)).toBe(true);
    expect(s.source.isVisible()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(s.source.close).not.toHaveBeenCalled();
  });

  it('restores a hidden source if release is lost, and ignores unrelated release senders', () => {
    const s = setup();
    s.transfers.startDrag(2);
    s.cursor(300, 200);
    vi.advanceTimersByTime(16);
    expect(s.transfers.endDrag(99, true, 'vibistudio')).toBe(false);
    vi.advanceTimersByTime(15_001);
    expect(s.source.isVisible()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(s.source.close).not.toHaveBeenCalled();
  });

  it('keeps the native window visible if the ghost cannot be created', () => {
    const s = setup();
    s.showGhost.mockReturnValue(false);
    s.transfers.startDrag(2);
    s.cursor(300, 200);
    vi.advanceTimersByTime(16);
    expect(s.source.isVisible()).toBe(true);
    s.transfers.endDrag(2, false);
    expect(s.hideGhost).not.toHaveBeenCalled();
  });

  it('native release detection ends dragging when neither renderer receives mouseup', () => {
    let pressed = true;
    const s = setup(() => pressed);
    s.transfers.startDrag(2);
    s.cursor(1_200, 200);
    pressed = false;
    vi.advanceTimersByTime(16);
    expect(vi.getTimerCount()).toBe(0);
    expect(s.source.isVisible()).toBe(true);
    expect(s.main.webContents.send).toHaveBeenLastCalledWith('vibisual:app:drag-state',
      { appId: 'vibistudio', dragging: false, armed: false });
  });

  it('explicit cancellation wins over native release while the cursor is inside', () => {
    let pressed = true;
    const s = setup(() => pressed);
    s.transfers.startDrag(2);
    s.cursor(300, 200);
    vi.advanceTimersByTime(16);
    pressed = false;
    s.transfers.endDrag(2, false);
    expect(s.source.isVisible()).toBe(true);
    expect(s.main.webContents.send).not.toHaveBeenCalledWith('vibisual:app:redock', expect.anything());
  });

  it('stops an orphaned drag outside the app even when native polling is unavailable', () => {
    const s = setup(() => null);
    s.transfers.startDrag(2);
    vi.advanceTimersByTime(30_001);
    expect(vi.getTimerCount()).toBe(0);
    expect(s.source.isVisible()).toBe(true);
  });

  it('does not accumulate native fractional-scale size readback during movement', () => {
    const s = setup();
    const actualBounds = s.source.getBounds.bind(s.source);
    s.source.getBounds = () => ({ ...actualBounds(), width: 802, height: 602 });
    s.transfers.startDrag(2);
    for (let i = 0; i < 80; i += 1) {
      s.cursor(1_200 + i, 200);
      vi.advanceTimersByTime(16);
      s.transfers.reportSize(2);
    }
    expect(s.source.setBounds).toHaveBeenLastCalledWith(expect.objectContaining({ width: 800, height: 600 }));
    s.transfers.endDrag(2, false);
  });
});
