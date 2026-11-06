import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => {
  const state = { bitmap: Buffer.alloc(16), png: Buffer.alloc(4) };
  const capturePage = vi.fn(async () => ({
    getSize: () => ({ width: 2, height: 2 }),
    toBitmap: () => state.bitmap,
    toPNG: () => state.png,
  }));
  class BrowserWindow {
    destroyed = false;
    readonly webContents = {
      executeJavaScript: vi.fn(async () => true),
      capturePage,
    };
    async loadFile(): Promise<void> {}
    isDestroyed(): boolean { return this.destroyed; }
    destroy(): void { this.destroyed = true; }
  }
  return { state, capturePage, BrowserWindow, nativeImage: { createFromDataURL: () => ({ isEmpty: () => false, toBitmap: () => Buffer.from([0, 0, 255, 255]) }) } };
});

vi.mock('electron', () => ({ BrowserWindow: electron.BrowserWindow, nativeImage: electron.nativeImage }));
vi.mock('./windowSize.js', () => ({ growWindowToContent: () => ({ fit: 1 }) }));

import { captureOffscreenAt, closeAllOffscreen, openOffscreen, setMainHost } from './offscreen.js';
import { isRawFrame } from '../render/rawFrame.js';
import type { AppMainHost } from '../host.js';

beforeEach(async () => {
  electron.state.bitmap = Buffer.alloc(16);
  electron.state.png = Buffer.from([1, 2, 3, 4]);
  setMainHost({ preloadFile: 'preload.js', rendererFile: 'index.html' } as AppMainHost);
  await openOffscreen({ width: 2, height: 2, project: 'project', docId: 'doc', session: 'test' });
});
afterEach(() => { closeAllOffscreen(); });

describe('offscreen raw capture delivery', () => {
  it('reuses the exact owned bitmap while retaining dimensions and channel metadata', async () => {
    electron.state.bitmap.set([1, 2, 3, 4]);
    const frame = await captureOffscreenAt(1.5, 'test', 'raw');
    expect(isRawFrame(frame)).toBe(true);
    if (!isRawFrame(frame)) throw new Error('Expected raw capture');
    expect(frame.data).toBe(electron.state.bitmap.buffer);
    expect(frame).toEqual({ kind: 'raw', width: 2, height: 2, order: 'bgra', premultiplied: true, data: electron.state.bitmap.buffer });
    expect(electron.capturePage).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 2, height: 2 });
  });

  it('copies only the bitmap view when a native buffer has a larger backing store', async () => {
    const parent = Buffer.alloc(48, 99);
    electron.state.bitmap = parent.subarray(8, 24).fill(13);
    const frame = await captureOffscreenAt(2, 'test', 'raw');
    if (!isRawFrame(frame)) throw new Error('Expected raw capture');
    expect(frame.data.byteLength).toBe(16);
    expect(frame.data).not.toBe(parent.buffer);
    expect(new Uint8Array(frame.data)).toEqual(new Uint8Array(16).fill(13));
  });

  it('keeps explicit and default PNG capture behavior', async () => {
    expect(await captureOffscreenAt(0, 'test', 'png')).toBe(electron.state.png);
    expect(await captureOffscreenAt(0, 'test')).toBe(electron.state.png);
  });
});
