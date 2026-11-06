import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { rawToStraightRgba } from '../dist/render/rawFrame.js';
import { frameArrayBuffer } from '../dist/main/frameBuffer.js';

function reference(data, order, premultiplied) {
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

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: +sorted[Math.floor(sorted.length / 2)].toFixed(3), p95: +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))].toFixed(3) };
}

let sink = 0;
function paired(before, after, samples = 24) {
  for (let i = 0; i < 6; i++) { before(); after(); }
  globalThis.gc?.();
  const times = [[], []];
  const run = [before, after];
  for (let i = 0; i < samples; i++) {
    for (const which of i % 2 === 0 ? [0, 1] : [1, 0]) {
      const start = performance.now();
      const result = run[which]();
      times[which].push(performance.now() - start);
      sink ^= result.byteLength;
    }
  }
  return { js: stats(times[0]), rust: stats(times[1]) };
}

const coldStart = performance.now();
rawToStraightRgba(new Uint8Array([0, 0, 128, 128]), 'bgra', true);
console.log(JSON.stringify({ node: process.version, platform: process.platform, firstRustCallMs: +(performance.now() - coldStart).toFixed(3), warmup: 6, samples: 24, units: 'ms', note: 'Rust timings include allocation and both Wasm copies. structuredClone models IPC serialization only; capturePage, native toBitmap, Electron transport, draw/upload and encoding are excluded.' }));

for (const [width, height] of [[1920, 1080], [3840, 2160]]) {
  for (const mode of ['semi-transparent', 'mixed', 'opaque-fallback']) {
    const bitmap = Buffer.alloc(width * height * 4);
    for (let i = 0; i < bitmap.length; i += 4) {
      const alpha = mode === 'semi-transparent' ? 128 : mode === 'mixed' ? i / 4 % 256 : 255;
      bitmap[i] = (i / 4 * 13) % (alpha + 1);
      bitmap[i + 1] = (i / 4 * 23) % (alpha + 1);
      bitmap[i + 2] = (i / 4 * 37) % (alpha + 1);
      bitmap[i + 3] = alpha;
    }
    const bytes = new Uint8Array(bitmap.buffer, bitmap.byteOffset, bitmap.byteLength);
    assert.deepEqual(rawToStraightRgba(bytes, 'bgra', true), reference(bytes, 'bgra', true));
    const convert = paired(() => reference(bytes, 'bgra', true), () => rawToStraightRgba(bytes, 'bgra', true));
    const deliver = (rust) => {
      const data = rust ? frameArrayBuffer(bitmap) : bitmap.buffer.slice(bitmap.byteOffset, bitmap.byteOffset + bitmap.byteLength);
      const frame = structuredClone({ kind: 'raw', width, height, order: 'bgra', premultiplied: true, data });
      return rust ? rawToStraightRgba(new Uint8Array(frame.data), frame.order, frame.premultiplied) : reference(new Uint8Array(frame.data), frame.order, frame.premultiplied);
    };
    const deliveryAndConvert = paired(() => deliver(false), () => deliver(true));
    console.log(JSON.stringify({ width, height, mode, bytes: bitmap.byteLength, convert, deliveryAndConvert }));
  }
}
console.log(JSON.stringify({ sink }));
