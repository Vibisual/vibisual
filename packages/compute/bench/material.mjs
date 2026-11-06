// Run after building @vibisual/compute: node packages/compute/bench/material.mjs
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(join(root, 'packages/client/package.json'));
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const temporary = await mkdtemp(join(tmpdir(), 'vibisual-material-bench-'));
const clientPath = join(root, 'packages/client/src/components/Vibi3D').replaceAll('\\', '/');
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
let worker;
try {
  await build({ stdin: { contents: `export {generateMaterialMaps as rust} from '${clientPath}/proceduralMaterialPixels.ts';
    export {generateMaterialMaps as js} from '${clientPath}/proceduralMaterialPixels.reference.ts';
    export {MaterialWorkerClient} from '${clientPath}/proceduralMaterialWorkerClient.ts';`, resolveDir: root },
  bundle: true, platform: 'node', format: 'esm', outfile: join(temporary, 'entry.mjs'), logLevel: 'silent' });
  await build({ entryPoints: [join(clientPath, 'proceduralMaterialWorker.ts')], bundle: true, platform: 'node', format: 'esm',
    outfile: join(temporary, 'worker.mjs'), logLevel: 'silent' });
  await writeFile(join(temporary, 'shim.mjs'), `import {parentPort} from 'node:worker_threads';
    globalThis.self={postMessage:(data,transfer)=>parentPort.postMessage(data,transfer)};
    await import('./worker.mjs');parentPort.on('message',data=>self.onmessage({data}));`);
  const { js, rust, MaterialWorkerClient } = await import(pathToFileURL(join(temporary, 'entry.mjs')).href);
  const threads = [];
  class BrowserWorker {
    constructor() {
      this.thread = new Worker(pathToFileURL(join(temporary, 'shim.mjs'))); threads.push(this.thread);
      this.thread.on('message', data => this.onmessage?.({ data }));
      this.thread.on('error', error => { console.error(error); this.onerror?.(); });
    }
    postMessage(data, transfer) { this.thread.postMessage(data, transfer); }
    terminate() { void this.thread.terminate(); }
  }
  worker = new MaterialWorkerClient(() => new BrowserWorker());
  let start = performance.now(); await worker.generate('painted-concrete', { size: 512, seed: 5, wear: 0.35 });
  console.log(JSON.stringify({ coldWorker512: performance.now() - start }));
  for (const [preset, size] of [['painted-concrete', 512], ['wood-planks', 512], ['pavers', 512], ['painted-concrete', 1024]]) {
    const options = { size, seed: 5, wear: 0.35 };
    const expected = js(preset, options), actual = rust(preset, options), remote = await worker.generate(preset, options);
    for (const key of Object.keys(expected)) {
      if (!Buffer.from(expected[key].data).equals(Buffer.from(actual[key].data))
        || !Buffer.from(expected[key].data).equals(Buffer.from(remote[key].data))) throw new Error(`Pixel mismatch: ${preset}/${key}`);
    }
    const times = { js: [], rust: [], worker: [], submit: [] };
    for (let n = 0; n < 5; n++) {
      start = performance.now(); js(preset, options); times.js.push(performance.now() - start);
      start = performance.now(); rust(preset, options); times.rust.push(performance.now() - start);
      start = performance.now(); const pending = worker.generate(preset, options); times.submit.push(performance.now() - start);
      await pending; times.worker.push(performance.now() - start);
    }
    console.log(JSON.stringify({ preset, size, bytes: size * size * 16, samples: 5,
      median: Object.fromEntries(Object.entries(times).map(([name, values]) => [name, median(values)])), raw: times }));
  }
  worker.dispose(); worker = undefined;
  await Promise.all(threads.map(thread => thread.terminate()));
} finally {
  worker?.dispose();
  if (dirname(resolve(temporary)) === resolve(tmpdir())) await rm(temporary, { recursive: true, force: true });
}
