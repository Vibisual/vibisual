import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ModelEditor } from './modelEditor.js';
import { generateMaterialMaps } from './proceduralMaterialPixels.js';
import { MaterialWorkerClient, type MaterialWorkerRequest, type MaterialWorkerResponse } from './proceduralMaterialWorkerClient.js';
import { needsPreparedVibi3DCommands } from './prepareVibi3DCommands.js';
import { serializeModelSource } from './modelSource.js';
import { generateSurfaceWearPixels } from '@vibisual/compute';
import { cachedMaterialTexture, collectMaterialGeneration, deferMaterialGeneration } from './modelProceduralTextures.js';
import { createModelMaterial } from './modelMaterials.js';
import { refreshModelSurfaceWear as referenceSurfaceWear } from './modelSurfaceWear.reference.js';

class ControlledWorker {
  static all: ControlledWorker[] = [];
  onmessage?: (event: MessageEvent<MaterialWorkerResponse>) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  requests: MaterialWorkerRequest[] = [];
  terminated = false;
  constructor() { ControlledWorker.all.push(this); }
  postMessage(request: MaterialWorkerRequest) { this.requests.push(request); }
  terminate() { this.terminated = true; }
  finish(error?: string) {
    const request = this.requests.at(-1)!;
    this.onmessage?.({ data: { id: request.id, ...(error ? { error } : request.kind === 'surface-wear'
      ? { surfaceWear: generateSurfaceWearPixels(request.input) } : { maps: generateMaterialMaps(request.preset, request.options) }) } } as MessageEvent<MaterialWorkerResponse>);
  }
}
afterEach(() => vi.unstubAllGlobals());

describe('material worker transactions', () => {
  it('awaits one shared bake before history, serializes final bytes, and preserves undo/redo', async () => {
    vi.stubGlobal('Worker', ControlledWorker);
    const editor = new ModelEditor(new THREE.Group());
    const task = editor.applyAsync([
      { type: 'create', id: 'first', name: 'First', recipe: { kind: 'box', width: 1, height: 1, depth: 1 }, material: { preset: 'brick', resolution: 128, seed: 781 } },
      { type: 'create', id: 'second', name: 'Second', recipe: { kind: 'box', width: 1, height: 1, depth: 1 }, material: { preset: 'brick', resolution: 128, seed: 781 } },
    ], 0);
    expect(editor.isApplying).toBe(true); expect(editor.revision).toBe(0); expect(editor.canUndo).toBe(false);
    const worker = ControlledWorker.all.at(-1)!; expect(worker.requests).toHaveLength(1); worker.finish();
    await task;
    expect(editor.isApplying).toBe(false); expect(editor.revision).toBe(1); expect(worker.requests).toHaveLength(1);
    const first = editor.findObject('first') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const second = editor.findObject('second') as typeof first;
    expect(first.material.map!.source).toBe(second.material.map!.source);
    expect((first.material.map as THREE.DataTexture).image.width).toBe(128);
    const images = (serializeModelSource(editor.object, []).scene as unknown as { images: { url: { width: number } }[] }).images;
    expect(images.every(image => typeof image.url === 'object' && !Array.isArray(image.url) && image.url.width === 128)).toBe(true);
    editor.undo(); expect(editor.findObject('first')).toBeUndefined();
    editor.redo(); expect(((editor.findObject('first') as typeof first).material.map as THREE.DataTexture).image.width).toBe(128);
  });
  it('rolls back worker failure and cancellation without committing placeholders', async () => {
    vi.stubGlobal('Worker', ControlledWorker);
    for (const [seed, fail] of [[782, true], [783, false]] as const) {
      const editor = new ModelEditor(new THREE.Group()); let active = true;
      const task = editor.applyAsync({ type: 'create', id: 'fresh', name: 'Fresh', recipe: { kind: 'box', width: 1, height: 1, depth: 1 }, material: { preset: 'brick', resolution: 128, seed } }, 0,
        { assertActive: () => { if (!active) throw new Error('scene-changed'); } });
      const rejected = expect(task).rejects.toThrow(fail ? 'worker-test-failure' : 'scene-changed');
      if (!fail) active = false;
      ControlledWorker.all.at(-1)!.finish(fail ? 'worker-test-failure' : undefined);
      await rejected;
      expect(editor.isApplying).toBe(false); expect(editor.revision).toBe(0); expect(editor.object.children).toHaveLength(0); expect(editor.canUndo).toBe(false);
    }
  });
  it('routes manual material and construction commands through existing async preparation', () => {
    expect(needsPreparedVibi3DCommands([{ type: 'material', id: 'x', material: { preset: 'plastic' } }])).toBe(true);
    expect(needsPreparedVibi3DCommands([{ type: 'create', name: 'Box', recipe: { kind: 'box', width: 1, height: 1, depth: 1 } }])).toBe(true);
    expect(needsPreparedVibi3DCommands([{ type: 'update', id: 'x', position: [1, 2, 3] }])).toBe(false);
    expect(needsPreparedVibi3DCommands([{ type: 'update', id: 'x', scale: [2, 1, 1] }])).toBe(true);
    expect(needsPreparedVibi3DCommands([{ type: 'geometry', id: 'x', recipe: { kind: 'wall', width: 4, height: 3, thickness: 0.2 } }])).toBe(true);
  });
  it('waits for cold base pixels before wall runoff and commits the exact original atlas', async () => {
    vi.stubGlobal('Worker', ControlledWorker);
    const recipe = { kind: 'wall' as const, width: 4, height: 3, thickness: 0.2, openings: [{ x: 1, y: 1.5, w: 2, h: 1 }] };
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 0.2), new THREE.MeshStandardMaterial());
    mesh.userData = { vibi3dRecipe: recipe, vibi3dArchitectureDetail: 'architectural' };
    const root = new THREE.Group(); root.add(mesh); const editor = new ModelEditor(root);
    const values = { preset: 'brick' as const, resolution: 128 as const, seed: 784, wear: 0.7, rotation: 23 };
    const task = editor.applyAsync({ type: 'material', id: editor.getId(mesh)!, material: values }, 0);
    const worker = ControlledWorker.all.at(-1)!; expect(worker.requests.at(-1)!.kind).toBe('material'); worker.finish();
    await vi.waitFor(() => expect(worker.requests.at(-1)!.kind).toBe('surface-wear'));
    const request = worker.requests.at(-1)!;
    if (request.kind !== 'surface-wear') throw new Error('missing atlas');
    expect(request.input.baseWidth).toBe(128); expect(new Set(request.input.bases[0]).size).toBeGreaterThan(4);
    expect(editor.revision).toBe(0); worker.finish(); await task;
    const expected = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 0.2), createModelMaterial(values));
    expected.userData = { vibi3dRecipe: recipe, vibi3dArchitectureDetail: 'architectural' };
    referenceSurfaceWear(expected, new THREE.Vector3(1, 1, 1));
    for (const slot of ['map', 'aoMap'] as const) {
      const actual = mesh.material[slot] as THREE.DataTexture, original = expected.material[slot] as THREE.DataTexture;
      expect(actual.image.width).toBe(original.image.width);
      expect(Buffer.from(actual.image.data as Uint8Array).equals(Buffer.from(original.image.data as Uint8Array))).toBe(true);
    }
    expect(editor.revision).toBe(1); expect(editor.canUndo).toBe(true);
  });
  it('settles every scheduled computation before rejection and blocks late installers after construction failure', async () => {
    vi.stubGlobal('Worker', ControlledWorker);
    let release: (() => void) | undefined; const installed = vi.fn(), settled = vi.fn();
    const batch = collectMaterialGeneration(() => {
      deferMaterialGeneration(async () => { await new Promise<void>(resolve => { release = resolve; }); return installed; });
      cachedMaterialTexture(new Map(), 'map', { kind: 'procedural', preset: 'plastic', seed: 785, resolution: 128 }, {});
    });
    let finished = false;
    const outcome = batch.ready.catch(error => { finished = true; return error; });
    await Promise.resolve(); ControlledWorker.all.at(-1)!.finish('late-failure');
    await Promise.resolve(); await Promise.resolve(); expect(finished).toBe(false);
    release!(); expect((await outcome).message).toBe('late-failure'); expect(installed).toHaveBeenCalledOnce();
    const late = vi.fn();
    expect(() => collectMaterialGeneration(() => {
      deferMaterialGeneration(async () => late, settled); throw new Error('construction-failed');
    })).toThrow('construction-failed');
    await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce()); expect(late).not.toHaveBeenCalled();
  });
});

describe('material worker queue', () => {
  it('terminates a cancelled preview, ignores its late response, and recovers after worker failure', async () => {
    const client = new MaterialWorkerClient(() => new ControlledWorker() as unknown as Worker);
    const abort = new AbortController();
    const old = client.generate('plastic', { size: 32 }, abort.signal);
    const cancelled = expect(old).rejects.toThrow('cancelled');
    const first = ControlledWorker.all.at(-1)!;
    const next = client.generate('glass', { size: 32 }); abort.abort(); await cancelled;
    expect(first.terminated).toBe(true);
    const second = ControlledWorker.all.at(-1)!; first.finish(); second.finish();
    expect((await next).map.width).toBe(32);
    const failing = client.generate('glass', { size: 32 }); const rejected = expect(failing).rejects.toThrow('material-worker-failed'); second.onerror?.(); await rejected;
    const recovered = client.generate('glass', { size: 32 }); ControlledWorker.all.at(-1)!.finish(); await recovered;
    client.dispose();
  });
});

