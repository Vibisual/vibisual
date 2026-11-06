import { withComputeMemory } from './runtime.js';

/** Numeric geometry only: config[7], body radius/half-width pairs, then cosine/sine pairs. */
export function packBundleGeometry(input: Float64Array, count: number, directions: number): Float64Array {
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(directions) || directions < 4
    || input.length !== 7 + count * 2 + directions * 2) throw new RangeError('Invalid bundle geometry');
  const outputLength = count * 2 + 2;
  return withComputeMemory(input.byteLength, outputLength * Float64Array.BYTES_PER_ELEMENT, (ctx, inputPtr, outputPtr) => {
    new Float64Array(ctx.memory.buffer, inputPtr, input.length).set(input);
    const status = ctx.exports.bundle_pack(inputPtr, count, directions, outputPtr);
    if (status !== 0) throw new Error(`Rust bundle packing failed (${status})`);
    return new Float64Array(ctx.memory.buffer, outputPtr, outputLength).slice();
  });
}
