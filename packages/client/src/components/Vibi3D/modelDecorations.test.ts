import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Vibi3DDecalCommand, Vibi3DImageSource } from '@vibisual/shared';
import { applyModelDecal } from './modelDecal.js';
import { applyModelMascot } from './modelMascot.js';
import { findGraphicObject } from './modelGraphicObjects.js';
import { captureModel, restoreModel } from './modelHistory.js';
import { loadModelSource, serializeModelSource } from './modelSource.js';
import { refreshModelMetricUvs } from './modelMetricUvs.js';
import { modelShadowSettings } from '../Creation/modelShadows.js';
import { modelTextureReferences, pinModelTexture } from './modelTextureReferences.js';
import { visibleModelBounds } from './modelBounds.js';

// Geometry/source round trips need actual maps, while full-resolution pixel quality is tested independently.
vi.mock('./modelMaterials.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./modelMaterials.js')>();
  return { ...actual, createModelMaterial: (...args: Parameters<typeof actual.createModelMaterial>) => actual.createModelMaterial({ resolution: 128, ...args[0] }, args[1]) };
});

const source: Vibi3DImageSource = { kind: 'vibimage', docId: 'drawing' };
function image(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255, 255, 128]), 2, 2);
  texture.needsUpdate = true; return texture;
}
function fixture(curved = false): { root: THREE.Group; target: THREE.Mesh } {
  const root = new THREE.Group(); root.userData['vibi3dId'] = 'root';
  const target = new THREE.Mesh(curved ? new THREE.SphereGeometry(1, 32, 24) : new THREE.BoxGeometry(4, 3, 0.2), new THREE.MeshStandardMaterial());
  target.userData['vibi3dId'] = 'wall'; root.add(target); return { root, target };
}
function decal(projection: 'flat' | 'surface', position: [number, number, number] = [0, 0, 0.1]): Vibi3DDecalCommand {
  return { type: 'decal', id: 'sticker', target: 'wall', position, normal: [0, 0, 1], size: [0.6, 0.8, 0.3], source, projection };
}
function attributes(mesh: THREE.Mesh): unknown {
  return Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([key, value]) => [key, [...value.array]]));
}

describe('native decals', () => {
  it('creates a flat alpha plane with preserved image UVs, depth offset and shadow exemption', () => {
    const { root, target } = fixture(); applyModelDecal(root, decal('flat'), image());
    const object = findGraphicObject(root, 'sticker') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    expect(object.parent).toBe(target); expect(object.material.transparent).toBe(true); expect(object.material.alphaTest).toBe(0.01);
    expect(object.material.polygonOffsetFactor).toBeLessThan(0); expect(object.material.depthWrite).toBe(false);
    expect(modelShadowSettings(object)).toEqual({ cast: false, receive: false });
    const uv = [...object.geometry.getAttribute('uv').array]; root.scale.set(2, 3, 4); refreshModelMetricUvs(root);
    expect([...object.geometry.getAttribute('uv').array]).toEqual(uv);
    object.geometry.computeBoundingBox(); expect(object.geometry.boundingBox!.getSize(new THREE.Vector3()).toArray()).toEqual([expect.closeTo(0.6), expect.closeTo(0.8), 0]);
  });

  it('clips curved geometry in target-local coordinates and follows a nonuniformly transformed target', () => {
    const { root, target } = fixture(true); const command = decal('surface', [0, 0, 1]);
    applyModelDecal(root, command, image()); const object = findGraphicObject(root, 'sticker') as THREE.Mesh;
    const before = attributes(object), position = object.geometry.getAttribute('position');
    const depths = new Set(Array.from({ length: position.count }, (_, index) => position.getZ(index).toFixed(5)));
    expect(position.count).toBeGreaterThan(6); expect(depths.size).toBeGreaterThan(1);
    target.position.set(7, 3, -2); target.rotation.set(0.3, 0.8, -0.2); target.scale.set(2, 0.5, 3); root.updateMatrixWorld(true);
    const local = new THREE.Vector3().fromBufferAttribute(position, 0);
    expect(local.clone().applyMatrix4(object.matrixWorld).distanceTo(local.clone().applyMatrix4(target.matrixWorld))).toBeLessThan(1e-10);
    applyModelDecal(root, { type: 'decal', id: 'sticker', rotation: 0 }); expect(attributes(object)).toEqual(before);
  });

  it.each(['flat', 'surface'] as const)('%s recipe, geometry, alpha pixels and source pins round trip exactly', async projection => {
    const { root } = fixture(projection === 'surface'), texture = image();
    pinModelTexture(texture, { id: 'drawing', revision: 3 }, 'sticker', 'map', 'link');
    applyModelDecal(root, decal(projection, [0, 0, projection === 'surface' ? 1 : 0.1]), texture);
    const original = findGraphicObject(root, 'sticker') as THREE.Mesh;
    const loaded = await loadModelSource(JSON.parse(JSON.stringify(serializeModelSource(root, []))));
    const object = findGraphicObject(loaded.object, 'sticker') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    expect(attributes(object)).toEqual(attributes(original)); expect(object.userData['vibi3dDecalRecipe']).toEqual(original.userData['vibi3dDecalRecipe']);
    expect((object.material.map as THREE.DataTexture).image.data).toEqual(texture.image.data);
    expect(modelTextureReferences(loaded.object, [])[0]).toMatchObject({ sourceId: 'drawing', sourceRevision: 3, targets: ['sticker'] });
  });

  it('regenerates the same node, restores geometry via history, and rejects locked or missed targets atomically', () => {
    const { root, target } = fixture(); applyModelDecal(root, decal('flat'), image());
    const object = findGraphicObject(root, 'sticker') as THREE.Mesh, geometry = object.geometry, before = captureModel(root, []);
    applyModelDecal(root, { type: 'decal', id: 'sticker', rotation: 90 }); expect(findGraphicObject(root, 'sticker')).toBe(object);
    expect(object.geometry).not.toBe(geometry); restoreModel(before, []); expect(object.geometry).toBe(geometry);
    target.userData['vibi3dLocked'] = true; expect(() => applyModelDecal(root, { type: 'decal', id: 'sticker', rotation: 20 })).toThrow('object-protected');
    expect(object.geometry).toBe(geometry); delete target.userData['vibi3dLocked'];
    expect(() => applyModelDecal(root, { ...decal('surface', [100, 0, 0]), id: 'outside' }, image())).toThrow('decal-misses-surface');
    expect(findGraphicObject(root, 'outside')).toBeUndefined();
  });
});

describe('native mascot assemblies', () => {
  it.each(['round', 'standee'] as const)('%s mascot preserves actual shapes and recipes through source JSON', async style => {
    const root = new THREE.Group();
    applyModelMascot(root, { type: 'mascot', id: 'friend', style, height: 1.8, ...(style === 'standee' ? { source } : {}) }, style === 'standee' ? image() : undefined);
    const original = findGraphicObject(root, 'friend')!;
    const loaded = await loadModelSource(JSON.parse(JSON.stringify(serializeModelSource(root, []))));
    const restored = findGraphicObject(loaded.object, 'friend')!;
    expect(restored.userData['vibi3dMascotRecipe']).toEqual(original.userData['vibi3dMascotRecipe']);
    for (const child of original.children as THREE.Mesh[]) {
      const other = findGraphicObject(loaded.object, child.userData['vibi3dId']) as THREE.Mesh;
      expect(JSON.stringify(attributes(other))).toBe(JSON.stringify(attributes(child)));
      expect(other.userData['vibi3dRecipe']).toEqual(child.userData['vibi3dRecipe']);
    }
  });

  it('builds editable curved primitives at the requested height, with procedural plastic and cloth', () => {
    const root = new THREE.Group(); applyModelMascot(root, { type: 'mascot', id: 'friend', style: 'round', height: 1.6 });
    const object = findGraphicObject(root, 'friend')!;
    expect(object.children).toHaveLength(11); expect(visibleModelBounds(object).getSize(new THREE.Vector3()).y).toBeCloseTo(1.6, 5);
    expect(object.children.every(child => child.userData['vibi3dRecipe'] && child.userData['vibi3dId'])).toBe(true);
    const kinds = new Set(object.children.map(child => child.userData['vibi3dRecipe'].kind));
    expect(kinds).toEqual(new Set(['capsule', 'sphere', 'roundedBox', 'path']));
    for (const child of object.children as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[]) expect(child.material.map).toBeTruthy();
  });

  it('keeps generated part IDs, user-added children and history while updating the mascot', () => {
    const root = new THREE.Group(); applyModelMascot(root, { type: 'mascot', id: 'friend', style: 'round' });
    const object = findGraphicObject(root, 'friend')!, head = object.children.find(child => child.userData['vibi3dMascotPart'] === 'head')!;
    const extra = new THREE.Group(); extra.userData['vibi3dId'] = 'user-extra'; head.add(extra);
    const before = captureModel(root, []), headId = head.userData['vibi3dId'];
    applyModelMascot(root, { type: 'mascot', id: 'friend', height: 2, colors: { body: '#4477aa' } });
    expect(findGraphicObject(root, headId)).toBe(head); expect(extra.parent).toBe(head);
    expect(visibleModelBounds(object).getSize(new THREE.Vector3()).y).toBeCloseTo(2, 5);
    restoreModel(before, []); expect(object.userData['vibi3dMascotRecipe'].height).toBeUndefined();
    head.userData['vibi3dLocked'] = true; expect(() => applyModelMascot(root, { type: 'mascot', id: 'friend', height: 3 })).toThrow('object-protected');
  });

  it('reuses regrouped generated parts without duplicating IDs and respects their new protected parent', () => {
    const root = new THREE.Group(); applyModelMascot(root, { type: 'mascot', id: 'friend', style: 'round' });
    const mascot = findGraphicObject(root, 'friend')!, head = mascot.children.find(child => child.userData['vibi3dMascotPart'] === 'head')!;
    const group = new THREE.Group(); root.add(group); group.add(head); group.userData['vibi3dLocked'] = true;
    expect(() => applyModelMascot(root, { type: 'mascot', id: 'friend', height: 2 })).toThrow('object-protected');
    delete group.userData['vibi3dLocked'];
    applyModelMascot(root, { type: 'mascot', id: 'friend', height: 2 }); expect(head.parent).toBe(mascot);
    const ids: unknown[] = []; root.traverse(node => { if (node.userData['vibi3dId']) ids.push(node.userData['vibi3dId']); });
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('pins a standee image to its surface, preserves aspect and image UVs, and supports switching to native shapes', () => {
    const root = new THREE.Group(), texture = image(); pinModelTexture(texture, { id: 'drawing', revision: 2 }, 'friend', 'map', 'standee-link');
    applyModelMascot(root, { type: 'mascot', id: 'friend', style: 'standee', height: 2, source }, texture);
    const object = findGraphicObject(root, 'friend')!, plane = object.children.find(child => child.userData['vibi3dMascotPart'] === 'image') as THREE.Mesh;
    const uv = [...plane.geometry.getAttribute('uv').array]; object.scale.set(2, 2, 2); refreshModelMetricUvs(root);
    expect([...plane.geometry.getAttribute('uv').array]).toEqual(uv);
    expect(modelTextureReferences(root, [])[0]!.targets).toEqual([plane.userData['vibi3dId']]);
    expect(texture.userData['vibi3dSource'].target).toBe('friend');
    applyModelMascot(root, { type: 'mascot', id: 'friend', style: 'round' });
    expect(object.userData['vibi3dMascotRecipe'].source).toBeUndefined(); expect(object.children).toHaveLength(11);
  });
});
