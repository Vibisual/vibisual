import { withComputeMemory } from './runtime.js';

/** Numeric material configuration; the caller owns validation and preset defaults. */
export function generateMaterialPixels(preset: number, seed: number, size: number, config: Float64Array): Uint8Array {
  if (!Number.isInteger(preset) || preset < 0 || preset > 15 || ![32, 64, 128, 256, 512, 1024].includes(size)
    || config.length !== 24 || !config.every(Number.isFinite)) throw new RangeError('material-source-invalid');
  return withComputeMemory(config.byteLength, size * size * 16, (context, input, output) => {
    new Float64Array(context.memory.buffer, input, 24).set(config);
    if (context.exports.material_generate(input, size, preset, seed >>> 0, output) !== 0) throw new Error('material-generation-failed');
    return new Uint8Array(context.memory.buffer, output, size * size * 16).slice();
  });
}
