import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCompute } from '@vibisual/compute';
import { drawRawFrame, rawToStraightRgba, type BitmapOrder, type RawFrame } from './rawFrame.js';
import type { Ctx2D } from './canvas2d.js';

function reference(data: ArrayLike<number>, order: BitmapOrder, premultiplied: boolean): Uint8ClampedArray {
  const n = data.length - data.length % 4;
  const out = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i += 4) {
    const a = data[i + 3] ?? 0;
    let r = (order === 'bgra' ? data[i + 2] : data[i]) ?? 0;
    let g = data[i + 1] ?? 0;
    let b = (order === 'bgra' ? data[i] : data[i + 2]) ?? 0;
    if (premultiplied) {
      if (a === 0) { r = 0; g = 0; b = 0; }
      else if (a < 255) {
        r = Math.min(255, Math.round(r * 255 / a));
        g = Math.min(255, Math.round(g * 255 / a));
        b = Math.min(255, Math.round(b * 255 / a));
      }
    }
    out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a;
  }
  return out;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('Rust raw frame conversion', () => {
  it('loads the actual compiled pixel exports', () => {
    expect(getCompute().exports.video_straight_rgba).toBeTypeOf('function');
    expect(getCompute().exports.video_straight_rgba_f64).toBeTypeOf('function');
  });

  it.each(['bgra', 'rgba'] as const)('matches every channel/alpha byte pair in %s order', (order) => {
    const bytes = new Uint8Array(256 * 256 * 4);
    for (let alpha = 0; alpha < 256; alpha++) {
      for (let value = 0; value < 256; value++) {
        bytes.set([value, 255 - value, value * 73 & 255, alpha], (alpha * 256 + value) * 4);
      }
    }
    const before = bytes.slice();
    for (const premultiplied of [false, true]) {
      expect(rawToStraightRgba(bytes, order, premultiplied)).toEqual(reference(bytes, order, premultiplied));
    }
    expect(bytes).toEqual(before);
  });

  it('preserves generic number clamping, sparse values, rounding and incomplete trailing pixels', () => {
    const values = [-Infinity, -1, -0, 0, 0.1, 0.49999999999999994, 0.5, 1.5, 2.5, 127.5, 128, 254.5, 255, 256, Infinity, NaN];
    const numbers: number[] = [];
    for (const alpha of values) for (const value of values) numbers.push(value, value / 2, value * 2, alpha);
    const sparse = new Array<number>(19);
    sparse[2] = 128; sparse[3] = 128; sparse[9] = 23; sparse[11] = 255;
    for (const bytes of [numbers, sparse, [1, 2, 3], [], [1, 2, 3, 255, 9, 8]]) {
      for (const order of ['rgba', 'bgra'] as const) for (const premultiplied of [false, true]) {
        expect(rawToStraightRgba(bytes, order, premultiplied)).toEqual(reference(bytes, order, premultiplied));
      }
    }
  });

  it('respects typed-array byte offsets and consecutive packed rows', () => {
    const backing = new Uint8ClampedArray([99, 99, 1, 2, 3, 255, 5, 6, 7, 128, 9, 10, 11, 64, 13, 14, 15, 0, 99]);
    const data = backing.subarray(2, 18);
    expect(rawToStraightRgba(data, 'bgra', true)).toEqual(reference(data, 'bgra', true));
    expect(backing[0]).toBe(99);
    expect(backing[18]).toBe(99);
    expect(rawToStraightRgba(new Uint8Array([1, 2, 3, 255, 99]), 'rgba', false)).toEqual(new Uint8ClampedArray([1, 2, 3, 255]));
  });

  it('returns owned output that survives memory growth and later frames', () => {
    const first = rawToStraightRgba(new Uint8Array([0, 0, 128, 128]), 'bgra', true);
    const large = new Uint8Array(2 * 1024 * 1024).fill(128);
    const second = rawToStraightRgba(large, 'rgba', true);
    expect(first).toEqual(new Uint8ClampedArray([255, 0, 0, 128]));
    expect(first.buffer).not.toBe(getCompute().memory.buffer);
    expect(second.slice(0, 4)).toEqual(new Uint8ClampedArray([255, 255, 255, 128]));
  });
});

function context(): Ctx2D {
  return { clearRect: vi.fn(), drawImage: vi.fn(), putImageData: vi.fn() } as unknown as Ctx2D;
}

const FRAME: RawFrame = { kind: 'raw', width: 2, height: 1, order: 'bgra', premultiplied: true, data: new Uint8Array([0, 0, 128, 128, 1, 2, 3, 255]).buffer };

describe('drawing raw frames', () => {
  it('keeps opaque native VideoFrame rendering and closes its frame', async () => {
    const close = vi.fn();
    const made: unknown[] = [];
    vi.stubGlobal('VideoFrame', class { close = close; constructor(...args: unknown[]) { made.push(args); } });
    const ctx = context();
    expect(await drawRawFrame(ctx, FRAME, 4, 2, false)).toBe(0.5);
    expect(made).toHaveLength(1);
    expect(made[0]).toEqual([new Uint8Array(FRAME.data), { format: 'BGRX', codedWidth: 2, codedHeight: 1, timestamp: 0 }]);
    expect(ctx.drawImage).toHaveBeenCalledOnce();
    expect(ctx.putImageData).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it.each(['transparent', 'missing-native', 'failed-native'] as const)('uses exact Rust pixels for %s output', async (mode) => {
    const data: Uint8ClampedArray[] = [];
    vi.stubGlobal('ImageData', class { constructor(rgba: Uint8ClampedArray, readonly width: number, readonly height: number) { data.push(rgba); } });
    vi.stubGlobal('VideoFrame', mode === 'missing-native' ? undefined : class { constructor() { throw new Error('unsupported'); } });
    const ctx = context();
    expect(await drawRawFrame(ctx, FRAME, 2, 1, mode === 'transparent')).toBe(1);
    expect(data).toEqual([reference(new Uint8Array(FRAME.data), 'bgra', true)]);
    expect(ctx.putImageData).toHaveBeenCalledOnce();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it('scales converted transparent frames and releases the temporary bitmap on failure', async () => {
    vi.stubGlobal('ImageData', class {});
    const bitmap = { close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
    const ctx = context();
    vi.mocked(ctx.drawImage).mockImplementation(() => { throw new Error('draw failed'); });
    await expect(drawRawFrame(ctx, FRAME, 4, 2, true)).rejects.toThrow('draw failed');
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
});
