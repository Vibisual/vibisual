import { describe, expect, it } from 'vitest';
import * as rust from './imageEdit.js';
import * as oracle from './imageEdit.oracle.js';

describe('compiled Rust image kernels match the previous pixel implementation', () => {
  it('preserves every byte across randomized alpha, seeds, tolerance, feather and color inputs', () => {
    let state = 0x732913;
    const random = (): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
    for (let round = 0; round < 150; round++) {
      const width = 1 + Math.floor(random() * 35), height = 1 + Math.floor(random() * 27);
      const data = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < data.length; i++) data[i] = random() < 0.15 ? 0 : Math.floor(random() * 256);
      const buffer = { width, height, data };
      const original = data.slice();
      const color = { r: random() * 255, g: Math.floor(random() * 256), b: random() * 255 };
      const options = { color, tolerance: random() * 300 - 20, feather: round % 3 ? random() * 80 : 0,
        contiguous: round % 2 === 0, seeds: [{ x: random() * width, y: random() * height }, { x: -1, y: 0 }, { x: width - 1, y: height - 1 }] };
      const distances = oracle.colorDistances(buffer, color);
      expect(rust.colorDistances(buffer, color)).toEqual(distances);
      expect(rust.colorKey(buffer, options)).toEqual(oracle.colorKey(buffer, options));
      expect(rust.colorKey(buffer, { ...options, distances })).toEqual(oracle.colorKey(buffer, { ...options, distances }));
      expect(rust.flattenAlpha(buffer, color)).toEqual(oracle.flattenAlpha(buffer, color));
      expect(rust.hasTransparency(buffer)).toBe(oracle.hasTransparency(buffer));
      expect(rust.trimBounds(buffer, round % 256)).toEqual(oracle.trimBounds(buffer, round % 256));
      expect(data).toEqual(original);
    }
  });

  it('preserves empty inputs, transparent paths, boundary feathers and invalid/outside seeds', () => {
    for (const width of [0, 1, 31]) {
      const height = width ? 17 : 0;
      const data = new Uint8ClampedArray(width * height * 4).fill(255);
      for (let p = 0; p < width * height; p++) {
        if (p % 7 === 0) data[p * 4 + 3] = 0;
        if (p % 5 === 0) data[p * 4] = 240;
      }
      const buffer = { width, height, data };
      for (const tolerance of [0, 14, 15, 255, NaN]) for (const contiguous of [false, true]) {
        const options = { color: { r: 255, g: 255, b: 255 }, tolerance, contiguous,
          seeds: [{ x: 0, y: 0 }, { x: NaN, y: 0 }, { x: Infinity, y: 0 }, { x: width, y: height }] };
        expect(rust.colorKey(buffer, options)).toEqual(oracle.colorKey(buffer, options));
      }
      expect(rust.trimBounds(buffer)).toEqual(oracle.trimBounds(buffer));
      expect(rust.hasTransparency(buffer)).toBe(oracle.hasTransparency(buffer));
    }
  });

  it('remains correct after Wasm memory grows for a larger image', () => {
    const large = { width: 1024, height: 1024, data: new Uint8ClampedArray(1024 * 1024 * 4).fill(255) };
    const options = { color: { r: 255, g: 255, b: 255 }, tolerance: 0, contiguous: true, seeds: [{ x: 0, y: 0 }] };
    const actual = rust.colorKey(large, options), expected = oracle.colorKey(large, options);
    expect(actual.changed).toBe(expected.changed);
    expect(actual.buffer.data.length).toBe(expected.buffer.data.length);
    expect(actual.buffer.data.every((byte, index) => byte === expected.buffer.data[index])).toBe(true);
    const small = { width: 1, height: 1, data: new Uint8ClampedArray([10, 20, 30, 77]) };
    expect(rust.flattenAlpha(small, options.color)).toEqual(oracle.flattenAlpha(small, options.color));
  });

  it('matches all 3×3 connected-region layouts from every seed, including a feather-only starting point', () => {
    for (let mask = 0; mask < 512; mask++) {
      const data = new Uint8ClampedArray(36).fill(255);
      for (let p = 0; p < 9; p++) if (!(mask & (1 << p))) data[p * 4] = 239;
      const buffer = { width: 3, height: 3, data };
      for (let seed = 0; seed < 9; seed++) {
        const options = { color: { r: 255, g: 255, b: 255 }, tolerance: 0, feather: 20, contiguous: true,
          seeds: [{ x: seed % 3, y: Math.floor(seed / 3) }] };
        const expected = oracle.colorKey(buffer, options), actual = rust.colorKey(buffer, options);
        expect(actual.changed).toBe(expected.changed);
        expect(actual.buffer.data.every((byte, index) => byte === expected.buffer.data[index])).toBe(true);
      }
    }
  });
});
