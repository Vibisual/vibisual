import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ffi = vi.hoisted(() => ({
  load: vi.fn(),
  struct: vi.fn(),
  sizeof: vi.fn(),
  decode: vi.fn(),
  GetCursorPos: vi.fn(),
  GetAsyncKeyState: vi.fn(),
  GetSystemMetrics: vi.fn(),
  ReleaseCapture: vi.fn(),
  PostMessageW: vi.fn(),
}));

vi.mock('koffi', () => ({ default: ffi }));

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'win32' });
  ffi.load.mockReturnValue({
    func: (signature: string) => {
      const name = /__stdcall (\w+)\(/.exec(signature)?.[1];
      if (!name || !(name in ffi)) throw new Error(`Unexpected binding: ${signature}`);
      return ffi[name as keyof typeof ffi];
    },
  });
  ffi.sizeof.mockReturnValue(8);
  ffi.decode.mockReturnValue(0x123456789abn);
  ffi.GetCursorPos.mockImplementation((point: { x: number; y: number }) => {
    Object.assign(point, { x: 1800, y: 90 });
    return 1;
  });
  ffi.GetAsyncKeyState.mockReturnValue(-32768);
  ffi.GetSystemMetrics.mockReturnValue(0);
  ffi.ReleaseCapture.mockReturnValue(1);
  ffi.PostMessageW.mockReturnValue(1);
});

afterEach(() => {
  Object.defineProperty(process, 'platform', platformDescriptor);
  vi.restoreAllMocks();
});

async function fixture() {
  const { tryStartNativeTitlebarMove } = await import('./nativeTitlebarMove');
  const handle = Buffer.alloc(8);
  handle.writeBigUInt64LE(0x123456789abn);
  const win = { isDestroyed: vi.fn(() => false), getNativeWindowHandle: vi.fn(() => handle) };
  return { win, handle, start: () => tryStartNativeTitlebarMove(win as Pick<BrowserWindow, 'isDestroyed' | 'getNativeWindowHandle'>) };
}

describe('native titlebar handoff', () => {
  it('decodes the HWND and posts a caption press at native pixel coordinates after releasing capture', async () => {
    const f = await fixture();
    expect(f.start()).toBe('started');
    expect(ffi.decode).toHaveBeenCalledWith(f.handle, 'void *');
    expect(ffi.PostMessageW).toHaveBeenCalledExactlyOnceWith(0x123456789abn, 0xa1, 2, (90 << 16) | 1800);
    expect(ffi.ReleaseCapture.mock.invocationCallOrder[0]).toBeLessThan(ffi.PostMessageW.mock.invocationCallOrder[0]!);
  });

  it('preserves signed coordinates on monitors left of and above the primary monitor', async () => {
    const f = await fixture();
    ffi.GetCursorPos.mockImplementation((point: { x: number; y: number }) => {
      Object.assign(point, { x: -1920, y: -120 });
      return 1;
    });
    expect(f.start()).toBe('started');
    const packed = ffi.PostMessageW.mock.calls[0]![3] as number;
    expect((packed << 16) >> 16).toBe(-1920);
    expect(packed >> 16).toBe(-120);
  });

  it('uses the physical right button when it is mapped to primary click', async () => {
    const f = await fixture();
    ffi.GetSystemMetrics.mockReturnValue(1);
    expect(f.start()).toBe('started');
    expect(ffi.GetSystemMetrics).toHaveBeenCalledWith(23);
    expect(ffi.GetAsyncKeyState.mock.calls.map(([key]) => key)).toEqual([0x02, 0x02]);
  });

  it.each([0, 1])('does not start after button release (state %s, including the unreliable recent-press bit)', async (state) => {
    const f = await fixture();
    ffi.GetAsyncKeyState.mockReturnValue(state);
    expect(f.start()).toBe('released');
    expect(ffi.ReleaseCapture).not.toHaveBeenCalled();
    expect(ffi.PostMessageW).not.toHaveBeenCalled();
  });

  it('rechecks release before handing off an IPC request that arrived late', async () => {
    const f = await fixture();
    ffi.GetAsyncKeyState.mockReturnValueOnce(-32768).mockReturnValueOnce(0);
    expect(f.start()).toBe('released');
    expect(ffi.ReleaseCapture).not.toHaveBeenCalled();
    expect(ffi.PostMessageW).not.toHaveBeenCalled();
  });

  it('does not require client capture to exist', async () => {
    const f = await fixture();
    ffi.ReleaseCapture.mockReturnValue(0);
    expect(f.start()).toBe('started');
    expect(ffi.PostMessageW).toHaveBeenCalledOnce();
  });

  it.each(['darwin', 'linux'] as const)('does not load Windows bindings on %s', async (platform) => {
    Object.defineProperty(process, 'platform', { ...platformDescriptor, value: platform });
    const f = await fixture();
    expect(f.start()).toBe('unavailable');
    expect(ffi.load).not.toHaveBeenCalled();
  });

  it('does not access a destroyed window or load native bindings for it', async () => {
    const f = await fixture();
    f.win.isDestroyed.mockReturnValue(true);
    expect(f.start()).toBe('released');
    expect(ffi.load).not.toHaveBeenCalled();
    expect(f.win.getNativeWindowHandle).not.toHaveBeenCalled();
  });

  it('loads bindings once, and retains a failed load for the manual fallback', async () => {
    const f = await fixture();
    ffi.load.mockImplementation(() => { throw new Error('unavailable'); });
    expect(f.start()).toBe('unavailable');
    expect(f.start()).toBe('unavailable');
    expect(ffi.load).toHaveBeenCalledOnce();
    expect(ffi.PostMessageW).not.toHaveBeenCalled();
  });

  it('reuses successfully loaded bindings', async () => {
    const f = await fixture();
    expect(f.start()).toBe('started');
    expect(f.start()).toBe('started');
    expect(ffi.load).toHaveBeenCalledOnce();
  });

  it.each(['cursor', 'handle', 'short-handle', 'post', 'exception', 'coordinate-overflow'] as const)('keeps manual fallback when %s fails', async (failure) => {
    const f = await fixture();
    if (failure === 'cursor') ffi.GetCursorPos.mockReturnValue(0);
    if (failure === 'handle') ffi.decode.mockReturnValue(null);
    if (failure === 'short-handle') f.win.getNativeWindowHandle.mockReturnValue(Buffer.alloc(2));
    if (failure === 'post') ffi.PostMessageW.mockReturnValue(0);
    if (failure === 'exception') ffi.GetCursorPos.mockImplementation(() => { throw new Error('native failure'); });
    if (failure === 'coordinate-overflow') ffi.GetCursorPos.mockImplementation((point: { x: number; y: number }) => {
      point.x = 40000;
      return 1;
    });
    expect(f.start()).toBe('unavailable');
    if (failure !== 'post') expect(ffi.PostMessageW).not.toHaveBeenCalled();
  });
});
