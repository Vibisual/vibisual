import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Worker } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = await mkdtemp(join(tmpdir(), 'vibisual-surface-wear-bench-'));
const require = createRequire(new URL('../package.json', import.meta.url));
const viteRequire = createRequire(require.resolve('vite/package.json'));
const { build } = viteRequire('esbuild');
await build({ stdin: { contents: `
  export { generateSurfaceWearPixels as rust } from './packages/compute/src/surfaceWear.ts';
  export { surfaceWearReference as js } from './packages/client/src/components/Vibi3D/surfaceWearPixels.reference.ts';
  export { MaterialWorkerClient } from './packages/client/src/components/Vibi3D/proceduralMaterialWorkerClient.ts';
`, resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile: join(output, 'entry.mjs'), logLevel: 'silent' });
await build({ entryPoints: [resolve(root, 'packages/client/src/components/Vibi3D/proceduralMaterialWorker.ts')],
  bundle: true, platform: 'node', format: 'esm', outfile: join(output, 'worker.mjs'), logLevel: 'silent' });
await writeFile(join(output, 'shim.mjs'), `import { parentPort } from 'node:worker_threads';
  globalThis.self = { postMessage: (data, transfer) => parentPort.postMessage(data, transfer) };
  await import('./worker.mjs'); parentPort.on('message', data => self.onmessage({ data }));
`);
const { js, rust, MaterialWorkerClient } = await import(pathToFileURL(join(output, 'entry.mjs')).href);
class BrowserWorker {
  constructor() {
    this.worker = new Worker(pathToFileURL(join(output, 'shim.mjs')));
    this.worker.on('message', data => this.onmessage?.({ data }));
    this.worker.on('error', error => { console.error(error); this.onerror?.(); });
  }
  postMessage(data, transfer) { this.worker.postMessage(data, transfer); }
  terminate() { void this.worker.terminate(); }
}
const worker = new MaterialWorkerClient(() => new BrowserWorker());
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: +sorted[Math.floor(sorted.length / 2)].toFixed(3), p95: +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))].toFixed(3) };
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, warmup: 3, samples: 9, units: 'ms',
  note: 'Real bundled production worker via Node worker_threads shim. Rust includes Wasm copies; worker includes original-preserving base copies and both transfers. Scene/GPU installation is excluded.' }));
try {
  for (const size of [512, 1024]) {
    const color = new Uint8Array(size * size * 4), ao = new Uint8Array(color.length);
    for (let i = 0; i < color.length; i++) { color[i] = i * 73 + 17 & 255; ao[i] = 255 - (i * 13 & 63); }
    const input = { bases: [color, ao], baseWidth: size, baseHeight: size, pixelsX: size, pixelsY: size * 0.75,
      width: 6, height: 4.5, tile: [0.7, 1.3], angle: 0.873, offset: [-1.13, 0.44], wear: 0.7, seed: 91,
      openings: [{ x: 0.4, y: 1.7, w: 0.8 }, { x: 2.1, y: 2.2, w: 1.1 }, { x: 4.4, y: 2.4, w: 0.7 }], scale: [1, 1] };
    const started = performance.now(), remote = await worker.surfaceWear(input);
    if (size === 512) console.log(JSON.stringify({ coldWorkerMs: +(performance.now() - started).toFixed(3) }));
    const expected = js(input), direct = rust(input);
    for (let slot = 0; slot < 2; slot++) {
      assert.deepEqual(direct[slot], expected[slot]); assert.deepEqual(remote[slot], expected[slot]);
    }
    for (let i = 0; i < 3; i++) { js(input); rust(input); await worker.surfaceWear(input); }
    const times = { js: [], rust: [], worker: [], mainSubmit: [] };
    for (let i = 0; i < 9; i++) {
      for (const key of i % 2 === 0 ? ['js', 'rust', 'worker'] : ['worker', 'rust', 'js']) {
        const start = performance.now();
        if (key === 'worker') { const job = worker.surfaceWear(input); times.mainSubmit.push(performance.now() - start); await job; }
        else (key === 'rust' ? rust : js)(input);
        times[key].push(performance.now() - start);
      }
    }
    assert.equal(color.byteLength, size * size * 4); assert.equal(ao.byteLength, color.byteLength);
    console.log(JSON.stringify({ base: [size, size], atlas: [input.pixelsX, input.pixelsY], timings: Object.fromEntries(Object.entries(times).map(([key, values]) => [key, stats(values)])) }));
  }
} finally { worker.dispose(); await rm(output, { recursive: true, force: true }); }
