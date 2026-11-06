import { withComputeMemory } from './runtime.js';

/** Packed BGRA/RGBA bytes, with the original ArrayLike number contract for non-byte inputs. */
export function straightRgbaBytes(data: ArrayLike<number>, order: 'bgra' | 'rgba', premultiplied: boolean): Uint8ClampedArray<ArrayBuffer> {
  const length = data.length - data.length % 4;
  if (length === 0) return new Uint8ClampedArray(0);
  const bgra = order === 'bgra' ? 1 : 0;
  const premultipliedFlag = premultiplied ? 1 : 0;
  if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) {
    return withComputeMemory(length, 0, ({ exports, memory }, input) => {
      new Uint8Array(memory.buffer, input, length).set(data.subarray(0, length));
      const written = exports.video_straight_rgba(input, length, bgra, premultipliedFlag);
      if (written !== length) throw new Error('Incomplete Rust pixel conversion');
      return new Uint8ClampedArray(memory.buffer, input, length).slice();
    });
  }
  return withComputeMemory(length * 8, length, ({ exports, memory }, input, output) => {
    const numbers = new Float64Array(memory.buffer, input, length);
    for (let i = 0; i < length; i += 4) {
      numbers[i + 3] = data[i + 3] ?? 0;
      numbers[i + (bgra ? 2 : 0)] = data[i + (bgra ? 2 : 0)] ?? 0;
      numbers[i + 1] = data[i + 1] ?? 0;
      numbers[i + (bgra ? 0 : 2)] = data[i + (bgra ? 0 : 2)] ?? 0;
    }
    const written = exports.video_straight_rgba_f64(input, length, bgra, premultipliedFlag, output);
    if (written !== length) throw new Error('Incomplete Rust pixel conversion');
    return new Uint8ClampedArray(memory.buffer, output, length).slice();
  });
}
