import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { validateVibi3DCommand, validateVibi3DMaterialMapSource } from '@vibisual/shared';
import { ModelEditor } from './modelEditor.js';
import { createModelMaterial } from './modelMaterials.js';
import { generateMaterialMaps } from './proceduralMaterialPixels.js';
import { serializeModelSource, loadModelSource } from './modelSource.js';
import { refreshModelMetricUvs } from './modelMetricUvs.js';
import { materialNoise, materialNoiseSampler, materialRGB } from './proceduralMaterialNoise.js';
import { sampleMaterialPattern } from './proceduralMaterialPatterns.js';
import { materialPresetDefaults } from './proceduralMaterialDefaults.js';
import { masonryJointMasks } from './proceduralMasonry.js';

describe('authored material quality and compatibility', () => {
  it('reuses lattice hashes without changing their sampled noise', () => {
    const sample = materialNoiseSampler(237);
    for (const [u, v] of [[0.01, 0.9], [-0.12, 1.22], [0.499, 0.12]]) {
      expect(sample(u!, v!, 48, 3, 41)).toBe(materialNoise(237, u!, v!, 48, 3, 41));
    }
  });
  it('validates explicit bake resolution and shares the default 512 pixel source across applications', () => {
    for (const resolution of [128, 256, 512, 1024]) {
      expect(validateVibi3DCommand({ type: 'material', id: 'wall', preset: 'plastic', resolution })).toBeTruthy();
      expect(validateVibi3DMaterialMapSource({ kind: 'procedural', preset: 'plastic', resolution })).toBeTruthy();
    }
    expect(validateVibi3DCommand({ type: 'material', id: 'wall', preset: 'plastic', resolution: 2048 })).toBeNull();
    const a = createModelMaterial({ preset: 'plastic' }), b = createModelMaterial({ preset: 'plastic' });
    expect((a.map as THREE.DataTexture).image.width).toBe(512); expect(a.map!.source).toBe(b.map!.source);
    expect(a.map!.uuid).toBe(b.map!.uuid);
    const shifted = createModelMaterial({ preset: 'plastic', offset: [0.25, 0] });
    expect(shifted.map!.source).toBe(a.map!.source); expect(shifted.map!.uuid).not.toBe(a.map!.uuid);
  });

  it('fits one complete room to each window while its surface maps retain metre tiling, including undo and reload', async () => {
    const editor = new ModelEditor(new THREE.Group());
    editor.apply({ type: 'create', id: 'window', name: 'Window', recipe: { kind: 'box', width: 3.06, height: 1.526, depth: 0.025 },
      material: { preset: 'glass', resolution: 128, tileSize: [3, 2], offset: [0.4, 0.6], params: { fakeInterior: true } } }, 0);
    const mesh = editor.findObject('window') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
    const geometry = mesh.geometry, uv = geometry.getAttribute('uv2'), positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
    for (let index = 0; index < uv.count; index++) if (normals.getZ(index) > 0.99) {
      expect(uv.getX(index)).toBeCloseTo((positions.getX(index) + 1.53) / 3.06, 5);
      expect(uv.getY(index)).toBeCloseTo((positions.getY(index) + 0.763) / 1.526, 5);
    }
    expect(mesh.material.map!.channel).toBe(2); expect(mesh.material.map!.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(mesh.material.map!.repeat.toArray()).toEqual([1, 1]); expect(mesh.material.map!.offset.toArray()).toEqual([0, 0]);
    expect(mesh.material.normalMap!.channel).toBe(0); expect(mesh.material.normalMap!.repeat.toArray()).toEqual([1 / 3, 0.5]);
    editor.apply({ type: 'geometry', id: 'window', recipe: { kind: 'box', width: 6, height: 3, depth: 0.025 } }, editor.revision);
    expect(Math.max(...Array.from(mesh.geometry.getAttribute('uv2').array))).toBe(1);
    editor.undo(); expect(mesh.geometry).toBe(geometry);
    const loaded = await loadModelSource(serializeModelSource(mesh, [])); const restored = loaded.object as typeof mesh;
    expect(restored.geometry.getAttribute('uv2').array).toEqual(uv.array); expect(restored.material.map!.channel).toBe(2);
  });

  it('applies authored color and roughness once and reports those values to the agent', () => {
    const editor = new ModelEditor(new THREE.Group());
    editor.apply({ type: 'create', id: 'surface', name: 'Surface', recipe: { kind: 'plane', width: 2, height: 2 },
      material: { preset: 'painted-concrete', resolution: 128, color: '#929ca4', roughness: 0.35, params: { color: '#929ca4', roughness: 0.35 } } }, 0);
    const mesh = editor.findObject('surface') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    expect(mesh.material.color.getHexString()).toBe('ffffff'); expect(mesh.material.roughness).toBe(1);
    const data = (mesh.material.roughnessMap as THREE.DataTexture).image.data as Uint8Array;
    let mean = 0; for (let index = 0; index < data.length; index += 4) mean += data[index]! / 255;
    expect(mean / (data.length / 4)).toBeCloseTo(0.35, 1);
    const snapshot = editor.snapshot().nodes.find(node => node.id === 'surface')!.material!;
    expect(snapshot.color).toBe('#929ca4'); expect(snapshot.roughness).toBe(0.35);
    const map = mesh.material.map; editor.apply({ type: 'material', id: 'surface', material: { roughness: 0.8 } }, editor.revision);
    expect(mesh.material.map).toBe(map); expect(mesh.material.roughness).toBe(1);
    expect(editor.snapshot().nodes.find(node => node.id === 'surface')!.material!.roughness).toBe(0.8);
  });

  it('does not regenerate or remap a legacy frozen material on load and scalar edits', async () => {
    const pixels = new Uint8Array([12, 45, 78, 255, 90, 21, 43, 255]);
    const map = new THREE.DataTexture(pixels, 2, 1), material = new THREE.MeshStandardMaterial({ map });
    material.userData['vibi3dMaterial'] = { preset: 'glass', params: { fakeInterior: true }, tileSize: [2, 2] };
    const loaded = await loadModelSource(serializeModelSource(new THREE.Mesh(new THREE.PlaneGeometry(), material), []));
    const mesh = loaded.object as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>, original = mesh.material.map;
    const editor = new ModelEditor(mesh); editor.apply({ type: 'material', id: editor.getId(mesh)!, material: { roughness: 0.4 } }, 0);
    expect(mesh.material.map).toBe(original); expect((original as THREE.DataTexture).image.data).toEqual(pixels);
    expect(original!.channel).toBe(0); expect(mesh.geometry.getAttribute('uv2')).toBeUndefined(); expect(mesh.material.roughness).toBe(0.4);
  });

  it('keeps a metre grout width when the complete tile repeat doubles', () => {
    const count = (meters: number): number => {
      const image = generateMaterialMaps('wall-tile', { resolution: 512, tileSize: [meters, 1.2], params: { color: '#ffffff', secondaryColor: '#ffffff', accentColor: '#000000', contrast: 0, groutWidth: 0.02 } }).map;
      let dark = 0; const row = 64;
      for (let x = 0; x < image.width; x++) dark += 1 - image.data[(row * image.width + x) * 4]! / 255;
      return dark * meters / image.width;
    };
    expect(Math.abs(count(1.2) - count(2.4))).toBeLessThan(0.005);
  });

  it('keeps interlocking grout height continuous at each horizontal connector', () => {
    const defaults = materialPresetDefaults('pavers');
    const context = { preset: 'pavers' as const, seed: 0, params: { contrast: 0 }, defaults, resolution: 512,
      tileSize: defaults.tileSize, primary: materialRGB(defaults.color), secondary: materialRGB(defaults.secondaryColor),
      accent: materialRGB(defaults.accentColor), noise: materialNoiseSampler(0) };
    for (const across of [0.87, 0.91, 0.97, 0.99]) for (const connector of [0.25, 0.75]) {
      const before = sampleMaterialPattern(context, across / 6, (connector - 0.000001) / 6);
      const after = sampleMaterialPattern(context, across / 6, (connector + 0.000001) / 6);
      expect(Math.abs(before.height - after.height)).toBeLessThan(0.0001);
    }
  });

  it('uses the full physical grout width and keeps its color mask separate from the bevel', () => {
    for (const texel of [1.2 / 64, 1.2 / 512, 1.2 / 1024]) {
      let area = 0; const step = 0.00001;
      for (let distance = -0.03; distance < 0.03; distance += step) area += masonryJointMasks(Math.abs(distance), 0.003, 0.003, texel).grout * step;
      expect(area).toBeCloseTo(0.003, 5);
    }
    const shoulder = masonryJointMasks(0.003, 0.003, 0.003, 1.2 / 512);
    expect(shoulder.grout).toBe(0); expect(shoulder.bevel).toBeGreaterThan(0);
  });

  it('places architectural wall runoff beneath the actual opening without repeating it over the whole wall', () => {
    const recipe = { kind: 'wall' as const, width: 4, height: 3, thickness: 0.2, openings: [{ x: 1, y: 1.5, w: 2, h: 1 }] };
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), createModelMaterial({ preset: 'painted-concrete', resolution: 128, wear: 1 }));
    mesh.userData = { vibi3dRecipe: recipe, vibi3dArchitectureDetail: 'architectural' }; refreshModelMetricUvs(mesh);
    expect(mesh.material.map!.channel).toBe(3); expect(mesh.material.aoMap!.channel).toBe(3); expect(mesh.material.normalMap!.channel).toBe(0);
    expect(mesh.geometry.getAttribute('uv3')).toBeDefined(); const prior = mesh.material.map;
    refreshModelMetricUvs(mesh); expect(mesh.material.map).toBe(prior);
    mesh.userData['vibi3dRecipe'] = { ...recipe, openings: [{ ...recipe.openings[0]!, x: 0.25 }] }; refreshModelMetricUvs(mesh);
    expect(mesh.material.map!.source).not.toBe(prior!.source);
    expect((mesh.material.map as THREE.DataTexture).image.data).not.toEqual((prior as THREE.DataTexture).image.data);
  });
});
