import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { VIBI3D_BUILTIN_KITS } from '@vibisual/shared';
import { applyModelKit, refreshModelKit, updateModelKitMatrices, readModelKitModules } from './modelKit.js';
import { findKitObject, kitPlacements } from './modelKitMetadata.js';
import { ModelEditor } from './modelEditor.js';
import { serializeModelSource, loadModelSource } from './modelSource.js';

vi.mock('./modelMaterials.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./modelMaterials.js')>();
  return { ...actual, createModelMaterial: (...args: Parameters<typeof actual.createModelMaterial>) => actual.createModelMaterial({ resolution: 128, ...args[0] }, args[1]) };
});

const buckets = (root: THREE.Object3D): THREE.InstancedMesh[] => { const result: THREE.InstancedMesh[] = []; root.traverse(node => { if (node instanceof THREE.InstancedMesh) result.push(node); }); return result; };
function fixture(): { root: THREE.Group; source: THREE.Mesh } {
  const root = new THREE.Group(); root.uuid = 'root'; root.userData['vibi3dId'] = 'root';
  const source = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()); source.uuid = 'source'; source.userData['vibi3dId'] = 'source'; root.add(source);
  applyModelKit(root, { type: 'kitModule', id: 'module', sourceId: 'source' }); return { root, source };
}

describe('editable instanced kits', () => {
  it('batches independent placements across parents and updates live transform matrices', () => {
    const { root } = fixture(), parent = new THREE.Group(); parent.userData['vibi3dId'] = 'parent'; parent.position.x = 10; root.add(parent);
    applyModelKit(root, { type: 'place', id: 'a', moduleId: 'module', position: [0.13, 0, 0] });
    applyModelKit(root, { type: 'place', id: 'b', moduleId: 'module', parentId: 'parent', position: [1, 0, 0] }); refreshModelKit(root);
    expect(buckets(root)).toHaveLength(1); const bucket = buckets(root)[0]!; expect(bucket.count).toBe(2);
    const ids = bucket.userData['vibi3dInstanceIds'] as string[]; expect([...ids].sort()).toEqual(['a', 'b']); const matrix = new THREE.Matrix4(); bucket.getMatrixAt(ids.indexOf('a'), matrix); expect(matrix.elements[12]).toBe(0.25);
    findKitObject(root, 'a')!.position.x = 3; updateModelKitMatrices(root); expect(buckets(root)[0]).toBe(bucket);
    bucket.getMatrixAt(ids.indexOf('a'), matrix); expect(matrix.elements[12]).toBe(3); bucket.getMatrixAt(ids.indexOf('b'), matrix); expect(matrix.elements[12]).toBe(11);
    const version = bucket.instanceMatrix.version; updateModelKitMatrices(root); expect(bucket.instanceMatrix.version).toBe(version);
    parent.userData['vibi3dMotions'] = { move: [] }; expect(() => refreshModelKit(root)).not.toThrow(); parent.position.x = 20; updateModelKitMatrices(root);
    const animated = buckets(root)[0]!; animated.getMatrixAt(animated.userData['vibi3dInstanceIds'].indexOf('b'), matrix); expect(matrix.elements[12]).toBe(21);
    parent.visible = false; refreshModelKit(root); expect(buckets(root)[0]!.count).toBe(1);
  });

  it('keeps lattice identities when counts grow and duplicate placements get independent stable identities', () => {
    const { root } = fixture(); applyModelKit(root, { type: 'array', id: 'grid', moduleId: 'module', counts: [2, 1, 2], step: [2, 0, 2] }); refreshModelKit(root);
    const original = new Map(kitPlacements(root).map(node => [node.userData['vibi3dInstance'].cell.join(','), node]));
    applyModelKit(root, { type: 'array', id: 'grid', moduleId: 'module', counts: [3, 1, 2], step: [3, 0, 2] }); refreshModelKit(root);
    for (const [cell, node] of original) expect(kitPlacements(root).find(value => value.userData['vibi3dInstance'].cell.join(',') === cell)).toBe(node);
    const copy = findKitObject(root, 'grid')!.clone(true); copy.userData['vibi3dId'] = 'copy'; copy.traverse(node => { if (node !== copy) node.userData['vibi3dId'] = `copy-${node.userData['vibi3dId']}`; }); root.add(copy); refreshModelKit(root);
    expect(new Set(buckets(root)[0]!.userData['vibi3dInstanceIds']).size).toBe(12);
    expect(copy.children[0]!.userData['vibi3dInstance'].arrayId).toBe('copy');
  });

  it('freezes the source, atomically updates all references, respects locks and restores buffers with history', () => {
    const { root, source } = fixture(); const editor = new ModelEditor(root);
    editor.apply([{ type: 'place', id: 'a', moduleId: 'module' }, { type: 'place', id: 'b', moduleId: 'module' }], editor.revision);
    const previous = buckets(root)[0]!; source.geometry = new THREE.BoxGeometry(5, 2, 1); previous.geometry.computeBoundingBox(); expect(previous.geometry.boundingBox!.max.x).toBe(0.5);
    editor.apply([{ type: 'kitModule', id: 'module', sourceId: 'source', expectedModuleRevision: 1 }], editor.revision);
    expect(buckets(root)[0]).not.toBe(previous); expect(kitPlacements(root).map(node => node.userData['vibi3dInstance'].moduleRevision)).toEqual([2, 2]);
    buckets(root)[0]!.geometry.computeBoundingBox(); expect(buckets(root)[0]!.geometry.boundingBox!.max.x).toBe(2.5);
    editor.apply([{ type: 'undo' }], editor.revision); expect(buckets(root)[0]).toBe(previous); editor.apply([{ type: 'redo' }], editor.revision);
    editor.apply([{ type: 'protect', id: 'a', locked: true }], editor.revision);
    expect(() => editor.apply([{ type: 'kitModule', id: 'module', sourceId: 'source', expectedModuleRevision: 2 }], editor.revision)).toThrow(); expect(readModelKitModules(root)[0]!.revision).toBe(2);
    expect(() => editor.apply([{ type: 'kitModule', id: 'module', sourceId: 'source' }], editor.revision)).toThrow();
  });

  it('separates world scales to retain meter-sized UVs and keeps shared scale instances batched', () => {
    const { root, source } = fixture(); (source.material as THREE.Material).userData['vibi3dMaterial'] = { tileSize: [1, 1] };
    applyModelKit(root, { type: 'kitModule', id: 'module', sourceId: 'source', expectedModuleRevision: 1 });
    for (const [id, scale] of [['a', 1], ['b', 2], ['c', 2]] as const) applyModelKit(root, { type: 'place', id, moduleId: 'module', scale: [scale, scale, scale] }); refreshModelKit(root);
    expect(buckets(root).map(node => node.count)).toEqual([1, 2]);
    const first = buckets(root)[0]!.geometry.getAttribute('uv'), second = buckets(root)[1]!.geometry.getAttribute('uv');
    expect(Array.from(second.array)).toEqual(Array.from(first.array, value => value * 2));
  });

  it('keeps explicit per-placement shadow overrides on separate GPU batches', () => {
    const { root } = fixture(); applyModelKit(root, { type: 'place', id: 'a', moduleId: 'module' }); applyModelKit(root, { type: 'place', id: 'b', moduleId: 'module' });
    findKitObject(root, 'a')!.userData['vibi3dShadows'] = { cast: false }; refreshModelKit(root);
    expect(buckets(root)).toHaveLength(2); expect(buckets(root).find(node => node.userData['vibi3dInstanceIds'].includes('a'))!.userData['vibi3dShadows']).toEqual({ cast: false });
  });

  it('rejects nested, animated, mirrored, empty and malformed kits without silently discarding their data', () => {
    const { root, source } = fixture(); source.userData['vibi3dMotions'] = {}; expect(() => applyModelKit(root, { type: 'kitModule', id: 'clean', sourceId: 'source' })).not.toThrow();
    source.userData['vibi3dMotions'] = { move: [] }; expect(() => applyModelKit(root, { type: 'kitModule', id: 'moving', sourceId: 'source' })).toThrow(); delete source.userData['vibi3dMotions'];
    source.scale.x = -1; expect(() => applyModelKit(root, { type: 'kitModule', id: 'mirror', sourceId: 'source' })).toThrow(); source.scale.x = 1;
    applyModelKit(root, { type: 'place', id: 'a', moduleId: 'module' }); expect(() => applyModelKit(root, { type: 'kitModule', id: 'nested', sourceId: 'a' })).toThrow();
    root.userData['vibi3dKitModules'] = [{ bad: true }]; expect(() => readModelKitModules(root)).toThrow();
  });

  it('creates 2,000 editable placements with one draw bucket and bounded CPU time', () => {
    const { root } = fixture(); const start = performance.now();
    applyModelKit(root, { type: 'array', id: 'large', moduleId: 'module', counts: [40, 1, 50], step: [2, 0, 2] }); refreshModelKit(root);
    const elapsed = performance.now() - start; expect(kitPlacements(root)).toHaveLength(2000); expect(buckets(root)).toHaveLength(1); expect(buckets(root)[0]!.count).toBe(2000);
    expect(elapsed).toBeLessThan(5000); console.info(`kit 2000 placements: ${elapsed.toFixed(1)}ms, 1 draw bucket`);
  });

  it.each(VIBI3D_BUILTIN_KITS)('%s has deterministic prototypes and survives document round trip with editable placements', async builtin => {
    const build = (): THREE.Group => { const root = new THREE.Group(); root.uuid = 'root'; root.userData['vibi3dId'] = 'root';
      applyModelKit(root, { type: 'kitModule', id: 'builtin', builtin }); applyModelKit(root, { type: 'place', id: 'a', moduleId: 'builtin' }); refreshModelKit(root); return root; };
    const root = build(), other = build(); expect(JSON.stringify(serializeModelSource(root, [])) === JSON.stringify(serializeModelSource(other, []))).toBe(true);
    const loaded = await loadModelSource(JSON.parse(JSON.stringify(serializeModelSource(root, [])))); expect(readModelKitModules(loaded.object)).toEqual(readModelKitModules(root));
    expect(buckets(loaded.object).length).toBeGreaterThan(0); expect(kitPlacements(loaded.object)).toHaveLength(1);
    refreshModelKit(loaded.object); expect(buckets(loaded.object).map(node => node.userData['vibi3dInstanceIds'])).toEqual(buckets(root).map(node => node.userData['vibi3dInstanceIds']));
  });
});
