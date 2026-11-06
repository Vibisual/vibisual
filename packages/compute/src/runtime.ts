import { COMPUTE_WASM_BASE64 } from './generated/wasmBytes.js';

export interface ComputeExports {
  memory: WebAssembly.Memory;
  compute_api_version(): number;
  compute_alloc(bytes: number): number;
  compute_dealloc(ptr: number, bytes: number): void;
  physics_frozen_satellites(input: number, count: number, gap: number, output: number): number;
  stream_order(sortTs: number, timestamps: number, ranks: number, count: number, output: number): number;
  preview_order(times: number, offsets: number, names: number, count: number, output: number): number;
  stream_runs(types: number, sessions: number, count: number, output: number): number;
  stream_turns(eventTs: number, eventCount: number, anchorTs: number, anchorCount: number, output: number): number;
  bundle_pack(input: number, count: number, directions: number, output: number): number;
  video_straight_rgba(data: number, byteLength: number, bgra: number, premultiplied: number): number;
  video_straight_rgba_f64(input: number, valueCount: number, bgra: number, premultiplied: number, output: number): number;
  image_distances(src: number, count: number, r: number, g: number, b: number, out: number): number;
  image_color_key(src: number, width: number, height: number, dist: number, tolerance: number, feather: number, seeds: number, seedCount: number, contiguous: number, out: number): number;
  image_flatten(src: number, count: number, r: number, g: number, b: number, out: number): number;
  image_has_transparency(src: number, count: number): number;
  image_trim(src: number, width: number, height: number, r: number, g: number, b: number, alpha: number, transparent: number, tolerance: number, out: number): number;
  material_generate(config: number, size: number, preset: number, seed: number, output: number): number;
  surface_wear(config: number, openings: number, openingCount: number, color: number, ao: number, baseWidth: number, baseHeight: number, pixelsX: number, pixelsY: number, seed: number, output: number): number;
}

export interface ComputeContext {
  exports: ComputeExports;
  memory: WebAssembly.Memory;
}

let compiled: WebAssembly.Module | undefined;
let shared: ComputeContext | undefined;
const MAX_BUFFER_BYTES = 512 * 1024 * 1024;

function getModule(): WebAssembly.Module {
  if (!compiled) {
    const decoded = atob(COMPUTE_WASM_BASE64);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
    compiled = new WebAssembly.Module(bytes);
  }
  return compiled;
}

/** Create isolated Wasm memory; numerical kernels normally share one instance. */
export function createCompute(imports: WebAssembly.Imports = {}): ComputeContext {
  const module = getModule();
  const resolved: WebAssembly.Imports = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    const namespace = resolved[entry.module] ??= {};
    namespace[entry.name] = imports[entry.module]?.[entry.name] ?? (() => {
      throw new Error(`Rust compute import is unavailable: ${entry.module}.${entry.name}`);
    });
  }
  const instance = new WebAssembly.Instance(module, resolved);
  // ABI is versioned and built together with this adapter; there is no downloaded runtime code.
  const exports = instance.exports as unknown as ComputeExports;
  if (exports.compute_api_version() !== 1) throw new Error('Unsupported Rust compute ABI');
  return { exports, memory: exports.memory };
}

export function getCompute(): ComputeContext {
  return shared ??= createCompute();
}

function checkSize(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_BUFFER_BYTES) {
    throw new RangeError('Invalid Rust compute buffer size');
  }
}

/** Views must be recreated after a Wasm call: growing memory invalidates old views. */
export function withComputeMemory<T>(
  inputBytes: number,
  outputBytes: number,
  run: (ctx: ComputeContext, inputPtr: number, outputPtr: number) => T,
): T {
  checkSize(inputBytes);
  checkSize(outputBytes);
  const ctx = getCompute();
  const input = ctx.exports.compute_alloc(inputBytes);
  if (!input) throw new Error('Rust compute input allocation failed');
  let output = 0;
  try {
    output = ctx.exports.compute_alloc(outputBytes);
    if (!output) throw new Error('Rust compute output allocation failed');
    return run(ctx, input, output);
  } finally {
    if (output) ctx.exports.compute_dealloc(output, outputBytes);
    ctx.exports.compute_dealloc(input, inputBytes);
  }
}
