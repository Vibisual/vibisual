import { withComputeMemory } from './runtime.js';

export interface SurfaceWearInput {
  bases: readonly [Uint8Array, Uint8Array];
  baseWidth: number;
  baseHeight: number;
  pixelsX: number;
  pixelsY: number;
  width: number;
  height: number;
  tile: readonly [number, number];
  angle: number;
  offset: readonly [number, number];
  wear: number;
  seed: number;
  openings: readonly { x: number; y: number; w: number }[];
  scale: readonly [number, number];
}

/** Two packed RGBA atlases sharing owned output memory; inputs remain unchanged. */
export function generateSurfaceWearPixels(input: SurfaceWearInput): [Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>] {
  const { bases, baseWidth, baseHeight, pixelsX, pixelsY, width, height, tile, angle, offset, wear, seed, openings, scale } = input;
  if (![baseWidth, baseHeight, pixelsX, pixelsY].every(value => Number.isInteger(value) && value > 0 && value <= 4096)
    || ![width, height, ...tile, angle, ...offset, wear, seed, ...scale].every(Number.isFinite)
    || width <= 0 || height <= 0 || tile.some(value => value <= 0) || openings.length > 32
    || openings.some(opening => ![opening.x, opening.y, opening.w].every(Number.isFinite))) throw new RangeError('surface-wear-input-invalid');
  const baseLength = baseWidth * baseHeight * 4;
  if (bases.some(base => base.byteLength !== baseLength)) throw new RangeError('surface-wear-base-size-invalid');
  // V8 evaluates these two scalar functions once; the pixel loop retains the same trigonometric inputs.
  const config = new Float64Array([width, height, ...tile, Math.cos(angle), Math.sin(angle), ...offset, wear, ...scale]);
  const openingBytes = openings.length * 3 * 8;
  const baseOffset = config.byteLength + openingBytes;
  const atlasLength = pixelsX * pixelsY * 4;
  return withComputeMemory(baseOffset + baseLength * 2, atlasLength * 2, ({ exports, memory }, from, output) => {
    new Float64Array(memory.buffer, from, config.length).set(config);
    const rows = new Float64Array(memory.buffer, from + config.byteLength, openings.length * 3);
    for (let i = 0; i < openings.length; i++) rows.set([openings[i]!.x, openings[i]!.y, openings[i]!.w], i * 3);
    new Uint8Array(memory.buffer, from + baseOffset, baseLength).set(bases[0]);
    new Uint8Array(memory.buffer, from + baseOffset + baseLength, baseLength).set(bases[1]);
    const result = exports.surface_wear(from, from + config.byteLength, openings.length, from + baseOffset,
      from + baseOffset + baseLength, baseWidth, baseHeight, pixelsX, pixelsY, seed >>> 0, output);
    if (result !== 0) throw new Error('surface-wear-generation-failed');
    const pixels = new Uint8Array(memory.buffer, output, atlasLength * 2).slice();
    return [pixels.subarray(0, atlasLength), pixels.subarray(atlasLength)];
  });
}
