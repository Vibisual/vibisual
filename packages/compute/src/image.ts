import { createCompute, withComputeMemory, type ComputeContext } from './runtime.js';

export interface ImagePixels { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> }
export interface ImageRgb { r: number; g: number; b: number }
export interface ImagePoint { x: number; y: number }
export interface ImageKeyOptions {
  color: ImageRgb; tolerance: number; feather?: number; contiguous: boolean;
  seeds?: readonly ImagePoint[]; distances?: Uint8Array;
}
export interface ImageKeyResult { buffer: ImagePixels; changed: number }
export interface ImageBounds { x: number; y: number; w: number; h: number }

function countPixels(buf: ImagePixels): number {
  const count = buf.width * buf.height;
  if (!Number.isSafeInteger(buf.width) || !Number.isSafeInteger(buf.height) || buf.width < 0 || buf.height < 0
    || !Number.isSafeInteger(count) || count > 0x7fff_ffff / 4 || buf.data.length !== count * 4) throw new RangeError('Invalid image pixels');
  return count;
}
const align = (bytes: number): number => Math.ceil(bytes / 8) * 8;

export function imageColorDistances(buf: ImagePixels, color: ImageRgb): Uint8Array {
  const count = countPixels(buf);
  return withComputeMemory(buf.data.byteLength, count, (ctx, input, output) => {
    new Uint8Array(ctx.memory.buffer, input, buf.data.length).set(buf.data);
    ctx.exports.image_distances(input, count, color.r, color.g, color.b, output);
    return new Uint8Array(ctx.memory.buffer, output, count).slice();
  });
}

export function imageColorKey(buf: ImagePixels, options: ImageKeyOptions): ImageKeyResult {
  const count = countPixels(buf);
  const seeds = options.seeds ?? [];
  const distanceOffset = buf.data.byteLength;
  const seedOffset = align(distanceOffset + count);
  const tolerance = Math.min(255, Math.max(0, Math.round(options.tolerance)));
  const feather = Math.max(0, Math.round(options.feather ?? 4 + Math.round(tolerance / 2)));
  return withComputeMemory(seedOffset + seeds.length * 16, buf.data.byteLength, (ctx, input, output) => {
    new Uint8Array(ctx.memory.buffer, input, buf.data.length).set(buf.data);
    if (options.distances?.length === count) new Uint8Array(ctx.memory.buffer, input + distanceOffset, count).set(options.distances);
    else ctx.exports.image_distances(input, count, options.color.r, options.color.g, options.color.b, input + distanceOffset);
    const seedView = new Float64Array(ctx.memory.buffer, input + seedOffset, seeds.length * 2);
    seeds.forEach((seed, index) => { seedView[index * 2] = seed.x; seedView[index * 2 + 1] = seed.y; });
    const changed = ctx.exports.image_color_key(input, buf.width, buf.height, input + distanceOffset,
      tolerance, feather, input + seedOffset, seeds.length, options.contiguous ? 1 : 0, output);
    return { buffer: { width: buf.width, height: buf.height, data: new Uint8ClampedArray(ctx.memory.buffer, output, buf.data.length).slice() }, changed };
  });
}

export function imageFlattenAlpha(buf: ImagePixels, color: ImageRgb): ImagePixels {
  const count = countPixels(buf);
  return withComputeMemory(buf.data.byteLength, buf.data.byteLength, (ctx, input, output) => {
    new Uint8Array(ctx.memory.buffer, input, buf.data.length).set(buf.data);
    ctx.exports.image_flatten(input, count, color.r, color.g, color.b, output);
    return { width: buf.width, height: buf.height, data: new Uint8ClampedArray(ctx.memory.buffer, output, buf.data.length).slice() };
  });
}

export function imageHasTransparency(buf: ImagePixels): boolean {
  const count = countPixels(buf);
  return withComputeMemory(buf.data.byteLength, 0, (ctx, input) => {
    new Uint8Array(ctx.memory.buffer, input, buf.data.length).set(buf.data);
    return ctx.exports.image_has_transparency(input, count) !== 0;
  });
}

export function imageTrimBounds(buf: ImagePixels, reference: { color: ImageRgb; alpha: number; transparent: boolean }, tolerance: number): ImageBounds | null {
  countPixels(buf);
  return withComputeMemory(buf.data.byteLength, 32, (ctx, input, output) => {
    new Uint8Array(ctx.memory.buffer, input, buf.data.length).set(buf.data);
    const { color } = reference;
    if (!ctx.exports.image_trim(input, buf.width, buf.height, color.r, color.g, color.b,
      reference.alpha, reference.transparent ? 1 : 0, tolerance, output)) return null;
    const result = new Float64Array(ctx.memory.buffer, output, 4);
    return { x: result[0]!, y: result[1]!, w: result[2]!, h: result[3]! };
  });
}

/** Worker-owned immutable source. Source, distance cache and output capacity stay
 * in Wasm between slider requests; only the resulting RGBA bytes cross back.
 * Dispose/replacement drops the isolated memory, including flood-fill scratch. */
export class ImagePixelSession {
  private ctx: ComputeContext | null = createCompute();
  private allocations: Array<{ pointer: number; bytes: number }> = [];
  private source = 0;
  private distances = 0;
  private output = 0;
  private color: ImageRgb | null = null;
  private readonly count: number;
  private readonly width: number;
  private readonly height: number;

  constructor(pixels: ImagePixels) {
    this.count = countPixels(pixels); this.width = pixels.width; this.height = pixels.height;
    try {
      this.source = this.allocate(pixels.data.byteLength);
      this.distances = this.allocate(this.count);
      this.output = this.allocate(Math.max(32, pixels.data.byteLength));
      new Uint8Array(this.context().memory.buffer, this.source, pixels.data.length).set(pixels.data);
    } catch (error) { this.dispose(); throw error; }
  }
  private context(): ComputeContext {
    if (!this.ctx) throw new Error('Image pixel session is disposed');
    return this.ctx;
  }
  private allocate(bytes: number): number {
    const pointer = this.context().exports.compute_alloc(bytes);
    if (!pointer) throw new Error('Image pixel allocation failed');
    this.allocations.push({ pointer, bytes }); return pointer;
  }
  private pixels(): ImagePixels {
    return { width: this.width, height: this.height,
      data: new Uint8ClampedArray(this.context().memory.buffer, this.output, this.count * 4).slice() };
  }
  key(options: Omit<ImageKeyOptions, 'distances'>): ImageKeyResult {
    const ctx = this.context(), color = options.color;
    if (!this.color || !Object.is(this.color.r, color.r) || !Object.is(this.color.g, color.g) || !Object.is(this.color.b, color.b)) {
      ctx.exports.image_distances(this.source, this.count, color.r, color.g, color.b, this.distances);
      this.color = { ...color };
    }
    const seeds = options.seeds ?? [], bytes = seeds.length * 16;
    const pointer = ctx.exports.compute_alloc(bytes);
    if (!pointer) throw new Error('Image seed allocation failed');
    try {
      const view = new Float64Array(ctx.memory.buffer, pointer, seeds.length * 2);
      seeds.forEach((seed, i) => { view[i * 2] = seed.x; view[i * 2 + 1] = seed.y; });
      const tolerance = Math.min(255, Math.max(0, Math.round(options.tolerance)));
      const feather = Math.max(0, Math.round(options.feather ?? 4 + Math.round(tolerance / 2)));
      const changed = ctx.exports.image_color_key(this.source, this.width, this.height, this.distances,
        tolerance, feather, pointer, seeds.length, options.contiguous ? 1 : 0, this.output);
      return { buffer: this.pixels(), changed };
    } finally { ctx.exports.compute_dealloc(pointer, bytes); }
  }
  flatten(color: ImageRgb): ImagePixels {
    this.context().exports.image_flatten(this.source, this.count, color.r, color.g, color.b, this.output);
    return this.pixels();
  }
  hasTransparency(): boolean { return this.context().exports.image_has_transparency(this.source, this.count) !== 0; }
  trim(reference: { color: ImageRgb; alpha: number; transparent: boolean }, tolerance: number): ImageBounds | null {
    const ctx = this.context(), { color } = reference;
    if (!ctx.exports.image_trim(this.source, this.width, this.height, color.r, color.g, color.b,
      reference.alpha, reference.transparent ? 1 : 0, tolerance, this.output)) return null;
    const out = new Float64Array(ctx.memory.buffer, this.output, 4);
    return { x: out[0]!, y: out[1]!, w: out[2]!, h: out[3]! };
  }
  dispose(): void {
    const ctx = this.ctx; this.ctx = null;
    for (const { pointer, bytes } of this.allocations) ctx?.exports.compute_dealloc(pointer, bytes);
    this.allocations = []; this.color = null;
  }
}
