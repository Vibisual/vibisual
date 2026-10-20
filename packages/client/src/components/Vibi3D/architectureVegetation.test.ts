import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { VIBI3D_LIMITS, validateVibi3DRecipe } from '@vibisual/shared';
import { buildArchitectureObject } from './modelArchitecture.js';
import { architectureFoliageGeometry, type ArchitectureFoliageRecipe } from './architectureFoliageGeometry.js';
import { metricUvGeometry } from './modelMetricUvs.js';
import { ModelEditor } from './modelEditor.js';
import { loadModelSource, serializeModelSource } from './modelSource.js';

vi.mock('./modelMaterials.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./modelMaterials.js')>();
  return { ...actual, createModelMaterial: (...args: Parameters<typeof actual.createModelMaterial>) => actual.createModelMaterial({ resolution: 128, ...args[0] }, args[1]) };
});
const meshes = (root: THREE.Object3D): THREE.Mesh[] => { const result: THREE.Mesh[] = []; root.traverse(node => { if (node instanceof THREE.Mesh) result.push(node); }); return result; };
const foliage = (root: THREE.Object3D): THREE.Mesh[] => meshes(root).filter(mesh => mesh.userData['vibi3dFoliageRecipe']);

describe('bounded architectural vegetation', () => {
  it.each(['planter', 'tree'] as const)('%s retains legacy spheres, while architectural branches contain actual curved leaves and deterministic buffers', async style => {
    const legacy = buildArchitectureObject({ kind: 'prop', style }, 'plant');
    expect(foliage(legacy)).toHaveLength(0); expect(meshes(legacy).some(mesh => mesh.userData['vibi3dRecipe'].kind === 'sphere')).toBe(true);
    const first = buildArchitectureObject({ kind: 'prop', style, detail: 'architectural' }, 'plant');
    const second = buildArchitectureObject({ kind: 'prop', style, detail: 'architectural' }, 'plant');
    expect(JSON.stringify(serializeModelSource(first, [])) === JSON.stringify(serializeModelSource(second, []))).toBe(true);
    expect(meshes(first).length).toBeLessThanOrEqual(VIBI3D_LIMITS.moduleParts);
    expect(foliage(first)).toHaveLength(style === 'planter' ? 5 : 7);
    expect(meshes(first).some(mesh => mesh.userData['vibi3dRecipe']?.kind === 'sphere')).toBe(false);
    const loaded = (await loadModelSource(JSON.parse(JSON.stringify(serializeModelSource(first, []))))).object;
    for (const mesh of meshes(first)) {
      const input = mesh.userData['vibi3dFoliageRecipe'] as ArchitectureFoliageRecipe | undefined;
      if (!input) { expect(validateVibi3DRecipe(mesh.userData['vibi3dRecipe'])).not.toBeNull(); continue; }
      expect(input.leaves).toBeGreaterThan(10); expect(mesh.userData['vibi3dRecipe']).toBeUndefined();
      const exact = metricUvGeometry(architectureFoliageGeometry(input), new THREE.Vector3(1, 1, 1));
      expect(mesh.geometry.getAttribute('position').array).toEqual(exact.getAttribute('position').array);
      const reopened = foliage(loaded).find(node => node.userData['vibi3dId'] === mesh.userData['vibi3dId'])!;
      expect(reopened.userData['vibi3dFoliageRecipe']).toEqual(input);
      expect(reopened.geometry.getAttribute('position').array).toEqual(mesh.geometry.getAttribute('position').array);
      expect(reopened.geometry.getAttribute('color').array).toEqual(mesh.geometry.getAttribute('color').array);
      expect((reopened.material as THREE.MeshStandardMaterial).vertexColors).toBe(true);
      expect((reopened.material as THREE.MeshStandardMaterial).side).toBe(THREE.DoubleSide);
      expect(mesh.geometry.getAttribute('position').count / 3).toBeLessThan(1000);
    }
    if (style === 'planter') { expect(first.getObjectByName('soil')).toBeTruthy(); expect(first.getObjectByName('lip')).toBeTruthy(); }
  });
  it('retains semantic branches, manual children, locks and undo when vegetation is regenerated', () => {
    const editor = new ModelEditor(new THREE.Group());
    editor.apply({ type: 'prop', id: 'plant', style: 'planter' }, 0);
    const leaf = foliage(editor.findObject('plant')!)[0]!, id = String(leaf.userData['vibi3dId']);
    const seed = leaf.userData['vibi3dFoliageRecipe'].seed;
    editor.apply({ type: 'create', id: 'tag', name: 'Tag', parentId: id, recipe: { kind: 'box' } }, editor.revision);
    editor.apply({ type: 'protect', id, locked: true }, editor.revision);
    expect(() => editor.apply({ type: 'prop', id: 'plant', radius: 0.4 }, editor.revision)).toThrow('object-protected');
    editor.apply({ type: 'protect', id, locked: false }, editor.revision);
    editor.apply({ type: 'prop', id: 'plant', radius: 0.4 }, editor.revision);
    expect(editor.findObject(id)).toBe(leaf); expect(editor.findObject('tag')!.parent).toBe(leaf);
    expect(leaf.userData['vibi3dFoliageRecipe'].seed).toBe(seed);
    const enlargedLength = leaf.userData['vibi3dFoliageRecipe'].length;
    editor.undo(); expect(leaf.userData['vibi3dFoliageRecipe'].length).toBeLessThan(enlargedLength);
    editor.redo(); expect(leaf.userData['vibi3dFoliageRecipe'].length).toBe(enlargedLength);
    editor.apply({ type: 'geometry', id, recipe: { kind: 'sphere' } }, editor.revision);
    editor.apply({ type: 'prop', id: 'plant', radius: 0.3 }, editor.revision);
    expect(leaf.userData['vibi3dRecipe']).toBeUndefined(); expect(leaf.userData['vibi3dFoliageRecipe']).toBeTruthy();
  });
  it('bounds cluster tessellation and remains finite at the smallest supported prop dimensions', () => {
    for (const style of ['planter', 'tree'] as const) for (const mesh of meshes(buildArchitectureObject({ kind: 'prop', style, detail: 'architectural', radius: 0.01, width: 0.25, height: 0.05 }, style))) {
      expect(Array.from(mesh.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
      if (mesh.userData['vibi3dRecipe']) expect(validateVibi3DRecipe(mesh.userData['vibi3dRecipe'])).not.toBeNull();
    }
    expect(() => architectureFoliageGeometry({ version: 1, seed: 0, leaves: 49, spread: 1, length: 1, width: 1 })).toThrow('architecture-foliage-invalid');
  });
});
