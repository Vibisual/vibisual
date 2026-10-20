import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

const electron = vi.hoisted(() => ({
  windows: [] as unknown[], ipc: null as unknown as import('node:events').EventEmitter,
  flushStorageData: vi.fn(),
}));
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => electron.windows },
  ipcMain: { on: (...args: Parameters<EventEmitter['on']>) => electron.ipc.on(...args),
    removeListener: (...args: Parameters<EventEmitter['removeListener']>) => electron.ipc.removeListener(...args) },
  session: { defaultSession: { flushStorageData: electron.flushStorageData } },
}));
vi.mock('./verificationWindows', () => ({ isVerificationWindow: (id: number) => id === 90 }));

import { flushRendererDrafts, releaseRendererDrafts } from './rendererFlush';
import { FLUSH_DRAFTS_REQUEST_CHANNEL, FLUSH_DRAFTS_DONE_CHANNEL, FLUSH_DRAFTS_CANCELED_CHANNEL,
  rendererDraftsFlushed } from './rendererFlushPlan';

function windowStub(id: number, options: { hidden?: boolean; preload?: boolean; crashed?: boolean; ack?: boolean | 'silent' } = {}) {
  return {
    isDestroyed: () => false,
    isVisible: vi.fn(() => !options.hidden),
    webContents: {
      id, isDestroyed: () => false, isCrashed: () => !!options.crashed,
      getURL: () => options.preload === false ? 'data:text/html,notice' : pathToFileURL(join(__dirname, '../renderer/index.html')).href,
      send: vi.fn((channel: string, payload?: { requestId: number }) => {
        if (channel === FLUSH_DRAFTS_REQUEST_CHANNEL && options.ack !== 'silent') {
          electron.ipc.emit(FLUSH_DRAFTS_DONE_CHANNEL, { sender: { id } }, { requestId: payload!.requestId, ok: options.ack ?? true });
        }
      }),
    },
  };
}

beforeEach(() => {
  electron.ipc = new EventEmitter();
  electron.windows = [];
  electron.flushStorageData.mockReset();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('renderer draft flush wiring', () => {
  it('waits for hidden retained app renderers but excludes preload-free notices and verification pages', async () => {
    const visible = windowStub(1);
    const hidden = windowStub(2, { hidden: true, ack: 'silent' });
    const notice = windowStub(3, { preload: false });
    const verification = windowStub(90);
    electron.windows = [visible, hidden, notice, verification];
    const promise = flushRendererDrafts();
    let settled = false;
    void promise.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(hidden.isVisible).not.toHaveBeenCalled();
    expect(electron.flushStorageData).not.toHaveBeenCalled();
    const request = hidden.webContents.send.mock.calls[0]![1]!;
    electron.ipc.emit(FLUSH_DRAFTS_DONE_CHANNEL, { sender: { id: 2 } }, { ...request, ok: true });
    expect(await promise).toEqual({ requested: 2, acked: 2, failed: 0, timedOut: false });
    expect(notice.webContents.send).not.toHaveBeenCalled();
    expect(verification.webContents.send).not.toHaveBeenCalled();
    expect(electron.flushStorageData).toHaveBeenCalledOnce();
    expect(electron.ipc.listenerCount(FLUSH_DRAFTS_DONE_CHANNEL)).toBe(0);
  });

  it('does not count an old sync-only ACK as proof of a durable write', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const editor = windowStub(1, { ack: 'silent' });
    electron.windows = [editor];
    const promise = flushRendererDrafts(10);
    const request = editor.webContents.send.mock.calls[0]![1]!;
    electron.ipc.emit(FLUSH_DRAFTS_DONE_CHANNEL, { sender: { id: 1 } }, request.requestId);
    await vi.advanceTimersByTimeAsync(10);
    const result = await promise;
    expect(result.timedOut).toBe(true);
    expect(rendererDraftsFlushed(result)).toBe(false);
  });

  it('blocks teardown on explicit save failure or crashed renderer', async () => {
    electron.windows = [windowStub(1, { ack: false }), windowStub(2, { crashed: true })];
    const result = await flushRendererDrafts();
    expect(result.failed).toBe(2);
    expect(rendererDraftsFlushed(result)).toBe(false);
  });

  it('blocks teardown if committing browser storage fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    electron.windows = [windowStub(1)];
    electron.flushStorageData.mockImplementation(() => { throw new Error('disk unavailable'); });
    expect(rendererDraftsFlushed(await flushRendererDrafts())).toBe(false);
  });

  it('releases hidden editors after failed or canceled shutdown', () => {
    const hidden = windowStub(1, { hidden: true });
    electron.windows = [hidden];
    releaseRendererDrafts();
    expect(hidden.webContents.send).toHaveBeenCalledWith(FLUSH_DRAFTS_CANCELED_CHANNEL);
  });
});
