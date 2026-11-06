import { describe, expect, it } from 'vitest';
import { generateSurfaceWearPixels, getCompute, type SurfaceWearInput } from '@vibisual/compute';
import { surfaceWearReference } from './surfaceWearPixels.reference.js';

function input(overrides: Partial<SurfaceWearInput> = {}): SurfaceWearInput {
  const baseWidth = overrides.baseWidth ?? 17, baseHeight = overrides.baseHeight ?? 8;
  const color = new Uint8Array(baseWidth * baseHeight * 4);
  const ao = new Uint8Array(color.length);
  for (let i = 0; i < color.length; i++) { color[i] = i * 73 + 17 & 255; ao[i] = 255 - (i * 13 & 63); }
  return { bases: [color, ao], baseWidth, baseHeight, pixelsX: 67, pixelsY: 43, width: 4.7, height: 3.1,
    tile: [1.3, 0.7], angle: 0, offset: [0, 0], wear: 0.8, seed: 0, openings: [], scale: [1, 1], ...overrides };
}

function parity(value: SurfaceWearInput): void {
  const before = value.bases.map(base => base.slice());
  const expected = surfaceWearReference(value), actual = generateSurfaceWearPixels(value);
  for (let slot = 0; slot < 2; slot++) {
    const mismatch = actual[slot]!.findIndex((byte, index) => byte !== expected[slot]![index]);
    expect(mismatch, `slot ${slot}, byte ${mismatch}: Rust ${actual[slot]![mismatch]}, JS ${expected[slot]![mismatch]}`).toBe(-1);
    expect(value.bases[slot]).toEqual(before[slot]);
    expect(actual[slot]!.buffer).not.toBe(getCompute().memory.buffer);
  }
}

describe('Rust architectural surface wear', () => {
  it('executes the compiled surface atlas export', () => {
    expect(getCompute().exports.surface_wear).toBeTypeOf('function');
  });

  it('matches packed rows, both slots, rotations, offsets and every seed boundary', () => {
    for (const seed of [0, 1, 0x7fffffff, 0x80000000, 0xffffffff]) {
      for (const angle of [0, Math.PI / 2, -Math.PI / 3, Math.PI * 19.3]) {
        parity(input({ seed, angle, offset: [-3.14, 21.7], scale: [1.3, 0.8], openings: [{ x: 0.2, y: 1.5, w: 0.8 }, { x: 2.1, y: 2, w: 0.4 }] }));
      }
    }
  });

  it('matches zero/full wear, one-pixel bases and source subarrays', () => {
    const backing = new Uint8Array([99, 12, 45, 67, 0, 99]);
    for (const wear of [0, 1]) {
      parity(input({ bases: [backing.subarray(1, 5), backing.subarray(1, 5)], baseWidth: 1, baseHeight: 1, wear }));
    }
  });

  it('matches 1024-pixel output with scaled openings and the Float32 mask boundary', () => {
    parity(input({ baseWidth: 128, baseHeight: 128, pixelsX: 1024, pixelsY: 384, width: 8.3, height: 3.7,
      tile: [0.13, 2.7], angle: -0.981, offset: [-0.433, 0.833], wear: 0.731, seed: 435196,
      scale: [1.5, 0.8], openings: [{ x: 0.1, y: 2.4, w: 0.8 }, { x: 1.7, y: 2.2, w: 0.73 }, { x: 3.7, y: 1.7, w: 0.16 }] }));
  });

  it('rejects invalid buffers and dimensions without detaching input', () => {
    const value = input();
    expect(() => generateSurfaceWearPixels({ ...value, pixelsX: 0 })).toThrow('surface-wear-input-invalid');
    expect(() => generateSurfaceWearPixels({ ...value, angle: NaN })).toThrow('surface-wear-input-invalid');
    expect(() => generateSurfaceWearPixels({ ...value, openings: Array(33).fill({ x: 0, y: 0, w: 1 }) })).toThrow('surface-wear-input-invalid');
    expect(() => generateSurfaceWearPixels({ ...value, bases: [new Uint8Array(1), value.bases[1]] })).toThrow('surface-wear-base-size-invalid');
    expect(value.bases[0].byteLength).toBe(value.baseWidth * value.baseHeight * 4);
  });
});
