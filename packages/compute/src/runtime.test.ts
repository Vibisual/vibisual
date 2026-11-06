import { describe, expect, it } from 'vitest';
import { createCompute, getCompute, withComputeMemory } from './runtime.js';

describe('compiled Rust memory boundary', () => {
  it('loads the same versioned binary in isolated instances', () => {
    expect(getCompute().exports.compute_api_version()).toBe(1);
    expect(createCompute().memory).not.toBe(getCompute().memory);
  });

  it('provides aligned, writable buffers and releases them after failures', () => {
    const expected = new Float64Array([Math.PI, -0, Number.MAX_VALUE, -Infinity]);
    for (let i = 0; i < 100; i++) {
      expect(() => withComputeMemory(expected.byteLength, 7, (ctx, input, output) => {
        expect(input % 8).toBe(0);
        expect(output % 8).toBe(0);
        new Float64Array(ctx.memory.buffer, input, expected.length).set(expected);
        expect(new Float64Array(ctx.memory.buffer, input, expected.length)).toEqual(expected);
        throw new Error('interrupted');
      })).toThrow('interrupted');
    }
    expect(withComputeMemory(8, 8, (ctx, input) => new Float64Array(ctx.memory.buffer, input, 1)[0])).toBe(0);
  });

  it('rejects invalid sizes before entering Wasm', () => {
    for (const bytes of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER]) {
      expect(() => withComputeMemory(bytes, 0, () => true)).toThrow(RangeError);
    }
  });
});
