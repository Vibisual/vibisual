import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VIBI3D_MATERIAL_PRESETS, VIBI3D_MATERIAL_MAP_SLOTS, validateVibi3DSnapshot, type Vibi3DMaterial, type Vibi3DRecipe } from '@vibisual/shared';
import { ModelEditor } from './modelEditor.js';
import { loadModelSource, serializeModelSource } from './modelSource.js';
import { generateMaterialMaps } from './proceduralMaterialPixels.js';
import { defaultRecipe } from './Vibi3DAuthoring.js';

function fixture(material?: Vibi3DMaterial, recipe: Vibi3DRecipe = { kind: 'box', width: 4, height: 3, depth: 2 }) {
  const editor = new ModelEditor(new THREE.Group(), [], { projectId: 'project' });
  editor.apply({ type: 'create', id: 'surface', name: 'Surface', recipe, material: material ? { resolution: 128, ...material } : undefined }, 0);
  const mesh = editor.findObject('surface') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  return { editor, mesh };
}
const pixel = (value: number) => new THREE.DataTexture(new Uint8Array([value, 2, 3, 255]), 1, 1);

describe('editable procedural and physical materials', () => {
  it.each(VIBI3D_MATERIAL_PRESETS)('%s applies actual deterministic pixels and embeds all four maps', async (preset) => {
    const { editor, mesh } = fixture({ preset, seed: 17, wear: 0.6 });
    const generated = generateMaterialMaps(preset, { seed: 17, wear: 0.6, resolution: 128 });
    for (const slot of ['map', 'normalMap', 'roughnessMap', 'aoMap'] as const) {
      const texture = mesh.material[slot] as THREE.DataTexture;
      expect(texture.image.data).toEqual(generated[slot].data);
      expect(texture.colorSpace).toBe(slot === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace);
      expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    }
    expect(validateVibi3DSnapshot(editor.snapshot())).toEqual(editor.snapshot());
    const loaded = await loadModelSource(JSON.parse(JSON.stringify(serializeModelSource(editor.object, []))));
    const restored = loaded.object.children[0] as typeof mesh;
    expect((restored.material.normalMap as THREE.DataTexture).image.data).toEqual(generated.normalMap.data);
    expect(restored.material.userData['vibi3dMaterial'].preset).toBe(preset);
    expect(restored.geometry.getAttribute('uv').array).toEqual(mesh.geometry.getAttribute('uv').array);
  });

  it('keeps map identity on scalar changes and restores material classes, slots and maps on undo/redo', () => {
    const { editor, mesh } = fixture({ preset: 'brick' }); const standard = mesh.material; const map = standard.map;
    editor.apply({ type: 'material', id: 'surface', material: { roughness: 0.2, emissive: '#224466', emissiveIntensity: 2 } }, editor.revision);
    expect(mesh.material.map).toBe(map);
    editor.apply({ type: 'material', id: 'surface', material: { physical: { transmission: 0.9, ior: 1.7, thickness: 0.08, clearcoat: 0.5 } } }, editor.revision);
    const physical = mesh.material; expect(physical).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    editor.undo(); expect(mesh.material).toBe(standard); expect(mesh.material.map).toBe(map); expect(mesh.material.roughness).toBe(1);
    expect(editor.snapshot().nodes.find(node => node.id === 'surface')!.material!.roughness).toBe(0.2);
    editor.redo(); expect(mesh.material).toBe(physical); expect((mesh.material as THREE.MeshPhysicalMaterial).transmission).toBe(0.9);
    editor.apply({ type: 'material', id: 'surface', material: { preset: 'painted-concrete' } }, editor.revision);
    expect((mesh.material as THREE.MeshPhysicalMaterial).transmission).toBe(0); expect(mesh.material.emissive.getHex()).toBe(0);
  });

  it('owns prepared UV transforms and source pins, preserves linked maps during wear edits and respects each batch index', () => {
    const { editor, mesh } = fixture({ preset: 'brick' }); const a = pixel(10), b = pixel(20);
    a.userData['vibi3dSource'] = { docId: 'a', revision: 1 }; b.userData['vibi3dSource'] = { docId: 'b', revision: 2 };
    editor.apply([
      { type: 'material', id: 'surface', material: { maps: { map: { source: { kind: 'vibimage', docId: 'a' } } }, tileSize: [2, 3] } },
      { type: 'material', id: 'surface', material: { maps: { map: { source: { kind: 'vibimage', docId: 'b' } } }, rotation: 90 } },
    ], editor.revision, { materialMaps: { 0: { map: a }, 1: { map: b } } });
    expect(mesh.material.map).not.toBe(b); expect(mesh.material.map!.userData).toEqual(b.userData); expect(b.repeat.toArray()).toEqual([1, 1]);
    const linked = mesh.material.map!; expect(linked.repeat.toArray()).toEqual([0.5, 1 / 3]); expect(linked.rotation).toBeCloseTo(Math.PI / 2);
    editor.apply({ type: 'material', id: 'surface', material: { wear: 0.8 } }, editor.revision);
    expect(mesh.material.map!.source).toBe(linked.source); expect(mesh.material.map!.userData['vibi3dSource'].docId).toBe('b');
    editor.undo(); expect(mesh.material.map).toBe(linked); editor.undo(); expect(mesh.material.map!.userData['vibi3dSource']).toBeUndefined();
    editor.redo(); expect(mesh.material.map).toBe(linked);
  });

  it('shares generated pixel sources across a group without sharing texture transforms', () => {
    const { editor, mesh } = fixture(); editor.apply({ type: 'duplicate', id: 'surface', count: 2 }, editor.revision);
    editor.apply({ type: 'material', id: editor.getId(editor.object)!, material: { preset: 'pavers', params: { metalness: 0.3 } } }, editor.revision);
    const other = editor.object.children[1] as typeof mesh;
    expect(other.material.map).not.toBe(mesh.material.map); expect(other.material.map!.source).toBe(mesh.material.map!.source);
    expect(mesh.material.metalness).toBe(0.3);
    const source = serializeModelSource(editor.object, []);
    expect((source.scene as THREE.Object3DJSON & { images: unknown[] }).images).toHaveLength(4);
  });

  it('supports every external map slot with the correct color space and cloned pin metadata', () => {
    const { editor, mesh } = fixture();
    const maps = Object.fromEntries(VIBI3D_MATERIAL_MAP_SLOTS.map(slot => [slot, { source: { kind: 'vibimage', docId: 'image' } }]));
    const textures = Object.fromEntries(VIBI3D_MATERIAL_MAP_SLOTS.map(slot => [slot, pixel(20)]));
    editor.applyMaterialMaps('surface', { maps, alphaTest: 0.2, transparent: true, side: 'double', polygonOffset: true, polygonOffsetFactor: -1 }, textures, editor.revision);
    for (const slot of VIBI3D_MATERIAL_MAP_SLOTS) {
      expect(mesh.material[slot]).not.toBe(textures[slot]);
      expect(mesh.material[slot]!.colorSpace).toBe(['map', 'emissiveMap'].includes(slot) ? THREE.SRGBColorSpace : THREE.NoColorSpace);
    }
    expect(mesh.material.side).toBe(THREE.DoubleSide); expect(mesh.material.polygonOffset).toBe(true); expect(mesh.material.alphaTest).toBe(0.2);
  });

  it('restores every slot in a multi-material mesh after physical conversion', () => {
    const root = new THREE.Group(); const original = [new THREE.MeshStandardMaterial({ color: '#123456' }), new THREE.MeshStandardMaterial({ color: '#abcdef' })];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), original); root.add(mesh); const editor = new ModelEditor(root);
    editor.applyMaterialMaps(editor.getId(mesh)!, { physical: { clearcoat: 0.8 } }, {}, 0);
    const physical = mesh.material; expect(physical.every(material => material instanceof THREE.MeshPhysicalMaterial)).toBe(true);
    editor.undo(); expect(mesh.material).toEqual(original); expect(mesh.material[0]).toBe(original[0]);
    editor.redo(); expect(mesh.material).toEqual(physical); expect(mesh.material[1]).toBe(physical[1]);
  });

  it('rejects locked and stale map edits and rolls a partial conversion back atomically', () => {
    const { editor, mesh } = fixture(); const prior = mesh.material;
    expect(() => editor.applyMaterialMaps('surface', { physical: { transmission: 1 }, maps: { normalMap: { source: { kind: 'vibimage', docId: 'missing' } } } }, {}, editor.revision)).toThrow('image-source-unavailable');
    expect(mesh.material).toBe(prior); expect(editor.revision).toBe(1);
    editor.apply({ type: 'protect', id: 'surface', locked: true }, editor.revision);
    expect(() => editor.applyMaterialMaps('surface', {}, { map: pixel(4) }, 0)).toThrow('model-changed');
    expect(() => editor.applyMaterialMaps('surface', { maps: { map: { source: { kind: 'vibimage', docId: 'a' } } } }, { map: pixel(4) }, editor.revision)).toThrow('object-protected');
    expect(mesh.material).toBe(prior);
  });

  it('manual image replacement removes stale source metadata and survives procedural wear updates and undo', () => {
    const { editor, mesh } = fixture({ preset: 'brick' });
    editor.applyMaterialMaps('surface', { maps: { map: { source: { kind: 'vibimage', docId: 'old' } } } }, { map: pixel(3) }, editor.revision);
    const linked = mesh.material.map;
    editor.applyTexture('surface', pixel(9), editor.revision, 'image.png');
    const custom = mesh.material.map;
    expect(mesh.material.userData['vibi3dMaterial'].maps).toBeUndefined();
    editor.apply({ type: 'material', id: 'surface', material: { wear: 0.5 } }, editor.revision);
    expect(mesh.material.map!.source).toBe(custom!.source);
    editor.undo(); editor.undo(); expect(mesh.material.map).toBe(linked); expect(mesh.material.userData['vibi3dMaterial'].maps.map.source.docId).toBe('old');
  });
});

describe('meter-valued recipe UVs', () => {
  it.each(['box', 'plane', 'lathe', 'extrude', 'path'] as const)('%s uses actual coordinates for each projected face', async (kind) => {
    const { mesh } = fixture({ preset: 'brick', tileSize: [0.5, 0.75] }, defaultRecipe(kind));
    const position = mesh.geometry.getAttribute('position'), uv = mesh.geometry.getAttribute('uv');
    for (let i = 0; i < position.count; i++) {
      expect([Math.abs(position.getX(i)), Math.abs(position.getY(i)), Math.abs(position.getZ(i))]).toContain(Math.abs(uv.getX(i)));
      expect(Number.isFinite(uv.getY(i))).toBe(true);
    }
    expect(mesh.material.map!.repeat.toArray()).toEqual([2, 1 / 0.75]);
    expect(mesh.geometry.getAttribute('uv1').array).toEqual(uv.array);
    const loaded = await loadModelSource(serializeModelSource(mesh, []));
    expect((loaded.object as THREE.Mesh).geometry.getAttribute('uv').array).toEqual(uv.array);
  });

  it('resizing recipe dimensions and scaling a parent increase repeats and keep history geometry immutable', () => {
    const { editor, mesh } = fixture({ preset: 'brick', tileSize: [1, 1] }, { kind: 'plane', width: 4, height: 2 });
    const span = () => { const uv = mesh.geometry.getAttribute('uv'); const xs = Array.from({ length: uv.count }, (_, n) => uv.getX(n)); return Math.max(...xs) - Math.min(...xs); };
    const original = mesh.geometry; expect(span()).toBe(4);
    editor.apply({ type: 'geometry', id: 'surface', recipe: { kind: 'plane', width: 8, height: 2 } }, editor.revision); expect(span()).toBe(8);
    editor.apply({ type: 'update', id: editor.getId(editor.object)!, scale: [2, 1, 1] }, editor.revision); expect(span()).toBe(16);
    editor.undo(); expect(span()).toBe(8); editor.undo(); expect(mesh.geometry).toBe(original); expect(span()).toBe(4);
  });
});
