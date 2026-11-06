// Actual compiled Rust and production Web Worker entry; no app or user files are opened.
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { imageColorKey, imageColorDistances } from './dist/image.js';
const clientRequire = createRequire(new URL('../client/package.json', import.meta.url));
const { build } = createRequire(clientRequire.resolve('vite'))('esbuild');
const directory = mkdtempSync(join(tmpdir(), 'vibi-image-bench-'));
const files = [];
const emit = (name, text) => { const path = join(directory, name); writeFileSync(path, text); files.push(path); return path; };
const bundle = async (relative, name) => {
  const result = await build({ entryPoints: [fileURLToPath(new URL(relative, import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent' });
  return emit(name, result.outputFiles[0].text);
};
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const measure = callback => { const times = []; for (let i = 0; i < 8; i++) { const start = performance.now(); callback(); if (i > 1) times.push(performance.now() - start); } return median(times); };
const workers = [];
try {
  const entry = await bundle('../client/src/components/IDE/imagePixelWorkerEntry.ts', 'entry.mjs');
  const clientPath = await bundle('../client/src/components/IDE/imagePixelWorkerClient.ts', 'client.mjs');
  const oraclePath = await bundle('../client/src/components/IDE/imageEdit.oracle.ts', 'oracle.mjs');
  const oracle = await import(pathToFileURL(oraclePath).href);
  const { ImagePixelWorkerClient } = await import(pathToFileURL(clientPath).href);
  const workerPath = emit('worker.mjs', `import { parentPort } from 'node:worker_threads';\nglobalThis.self = { onmessage: null, postMessage(message, transfer) { parentPort.postMessage(message, transfer); } };\nawait import(${JSON.stringify(pathToFileURL(entry).href)});\nparentPort.on('message', data => self.onmessage({ data }));\n`);
  const workerFactory = () => {
    const thread = new Worker(pathToFileURL(workerPath)); workers.push(thread);
    const port = { onmessage: null, onerror: null, onmessageerror: null,
      postMessage: (message, transfer) => thread.postMessage(message, transfer), terminate: () => { void thread.terminate(); } };
    thread.on('message', data => port.onmessage?.({ data }));
    thread.on('error', error => port.onerror?.({ message: error.message }));
    thread.on('messageerror', error => port.onmessageerror?.({ data: error }));
    return port;
  };
  for (const [width, height] of [[1024, 1024], [3840, 2160]]) {
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let y = height >> 2; y < height * 3 / 4; y++) for (let x = width >> 2; x < width * 3 / 4; x++) {
      const at = (y * width + x) * 4; data[at] = 20; data[at + 1] = 60; data[at + 2] = 160;
    }
    const pixels = { width, height, data };
    const options = { color: { r: 255, g: 255, b: 255 }, tolerance: 25, contiguous: true, seeds: [{ x: 0, y: 0 }] };
    const distances = oracle.colorDistances(pixels, options.color);
    const baseline = oracle.colorKey(pixels, { ...options, distances });
    const rust = imageColorKey(pixels, { ...options, distances });
    if (rust.changed !== baseline.changed || !rust.buffer.data.every((byte, i) => byte === baseline.buffer.data[i])) throw new Error('Direct Rust parity mismatch');
    const jsMs = measure(() => oracle.colorKey(pixels, { ...options, distances }));
    const rustMs = measure(() => imageColorKey(pixels, { ...options, distances }));
    const jsDistanceMs = measure(() => oracle.colorDistances(pixels, options.color));
    const rustDistanceMs = measure(() => imageColorDistances(pixels, options.color));
    const client = new ImagePixelWorkerClient(workerFactory);
    let start = performance.now(); const cold = client.run(pixels, { kind: 'key', options });
    const coldSubmitMs = performance.now() - start;
    const result = await cold; const coldMs = performance.now() - start;
    if (result.changed !== baseline.changed || !result.buffer.data.every((byte, i) => byte === baseline.buffer.data[i])) throw new Error('Worker parity mismatch');
    const roundtrips = [], submits = [];
    for (let i = 0; i < 8; i++) {
      start = performance.now(); const result = client.run(pixels, { kind: 'key', options: { ...options, tolerance: 20 + i } });
      const submitted = performance.now() - start; await result;
      if (i > 1) { roundtrips.push(performance.now() - start); submits.push(submitted); }
    }
    console.log(JSON.stringify({ size: `${width}x${height}`, jsMs, rustMs, workerMs: median(roundtrips), mainSubmitMs: median(submits), coldMs, coldSubmitMs, jsDistanceMs, rustDistanceMs, parity: true }));
    client.dispose();
  }
} finally {
  await Promise.all(workers.map(worker => worker.terminate()));
  for (const path of files.reverse()) unlinkSync(path);
  rmdirSync(directory);
}
