import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { externalizeCreationValue, resolveCreationValue, validateVibi3DMaterialParams, validateVibi3DCommand, type CreationValue } from '@vibisual/shared';
import { generateMaterialMaps } from './proceduralMaterialPixels.js';
import { sampleGlassInterior } from './proceduralGlassInterior.js';
import { createModelMaterial } from './modelMaterials.js';
import { ModelEditor } from './modelEditor.js';
import { loadModelSource, serializeModelSource } from './modelSource.js';
import { modelShadowSettings } from '../Creation/modelShadows.js';

function fingerprints(options: Parameters<typeof generateMaterialMaps>[1]): number[] {
  return Object.values(generateMaterialMaps('glass', options)).map(image => {
    let hash = 2166136261; for (const byte of image.data) hash = Math.imul(hash ^ byte, 16777619); return hash >>> 0;
  });
}

describe('optional procedural glass interiors', () => {
  it('keeps the optional room disabled when omitted or explicitly false', () => {
    const options = { size: 32, seed: 125, wear: 0.35 };
    expect(fingerprints({ ...options, params: { fakeInterior: false } })).toEqual(fingerprints(options));
  });

  it('validates boolean input through both material and procedural map commands', () => {
    for (const fakeInterior of [true, false]) {
      expect(validateVibi3DMaterialParams({ fakeInterior })).toEqual({ fakeInterior });
      expect(validateVibi3DCommand({ type: 'material', id: 'glass', preset: 'glass', params: { fakeInterior } })).toBeTruthy();
      expect(validateVibi3DCommand({ type: 'material', id: 'glass', maps: { map: { source: { kind: 'procedural', preset: 'glass', params: { fakeInterior } } } } })).toBeTruthy();
    }
    for (const fakeInterior of ['true', 1, null, {}]) expect(validateVibi3DMaterialParams({ fakeInterior })).toBeNull();
  });

  it('uses reproducible room pixels while keeping surface normals, roughness and AO as glass', () => {
    const options = { size: 64, seed: 214, wear: 0.25 }, plain = generateMaterialMaps('glass', options);
    const room = generateMaterialMaps('glass', { ...options, params: { fakeInterior: true } });
    expect(room).toEqual(generateMaterialMaps('glass', { ...options, params: { fakeInterior: true } }));
    expect(room.map.data).not.toEqual(plain.map.data);
    expect(room.map.data).not.toEqual(generateMaterialMaps('glass', { ...options, seed: 215, params: { fakeInterior: true } }).map.data);
    for (const slot of ['normalMap', 'roughnessMap', 'aoMap'] as const) expect(room[slot].data).toEqual(plain[slot].data);
  });

  it('draws distinct rear, ceiling, floor and side faces with dark furnishings', () => {
    const tint: [number, number, number] = [215, 234, 240];
    const sample = (u: number, v: number) => sampleGlassInterior(12, u, v, tint);
    const points = [[0.5, 0.58], [0.5, 0.95], [0.5, 0.05], [0.05, 0.53], [0.95, 0.53]];
    const faces = points.map(([u, v]) => sample(u!, v!));
    expect(new Set(faces.map(value => JSON.stringify(value))).size).toBe(5);
    expect(faces[1]![0]).toBeGreaterThan(faces[2]![0]);
    const pixels = generateMaterialMaps('glass', { size: 64, seed: 12, params: { fakeInterior: true } }).map.data;
    const red = Array.from(pixels).filter((_value, index) => index % 4 === 0);
    expect(Math.min(...red)).toBeLessThan(40); expect(Math.max(...red)).toBeGreaterThan(95);
  });

  it('toggles only automatic transmission, preserving shadow exemptions and undo', () => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), createModelMaterial({ preset: 'glass' }));
    const root = new THREE.Group(); root.add(mesh); const editor = new ModelEditor(root), id = editor.getId(mesh)!;
    const physical = mesh.material as THREE.MeshPhysicalMaterial, original = physical.map;
    expect(physical.transmission).toBe(0.9);
    editor.apply({ type: 'material', id, material: { params: { fakeInterior: true } } }, 0);
    expect(physical.transmission).toBe(0.08); expect(modelShadowSettings(mesh)).toEqual({ cast: false, receive: false });
    editor.undo(); expect(physical.transmission).toBe(0.9); expect(physical.map).toBe(original);
    editor.redo(); expect(physical.transmission).toBe(0.08);
    editor.apply({ type: 'material', id, material: { params: { fakeInterior: false } } }, editor.revision);
    expect(physical.transmission).toBe(0.9);
  });

  it('preserves explicit transmission across later toggles and unmarked legacy values', () => {
    for (const value of [0, 0.45, 0.9]) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), createModelMaterial({ preset: 'glass', params: { fakeInterior: true }, physical: { transmission: value } }));
      const editor = new ModelEditor(mesh), id = editor.getId(mesh)!;
      for (const fakeInterior of [false, true]) editor.apply({ type: 'material', id, material: { params: { fakeInterior } } }, editor.revision);
      expect((mesh.material as THREE.MeshPhysicalMaterial).transmission).toBe(value);
    }
    const legacy = createModelMaterial({ preset: 'glass' }) as THREE.MeshPhysicalMaterial;
    delete legacy.userData['vibi3dAutoTransmission']; const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), legacy), editor = new ModelEditor(mesh);
    editor.apply({ type: 'material', id: editor.getId(mesh)!, material: { params: { fakeInterior: true } } }, 0);
    expect(legacy.transmission).toBe(0.9);
  });

  it('freezes all four map byte buffers into creation blobs and restores the option and physical values', async () => {
    const material = createModelMaterial({ preset: 'glass', params: { fakeInterior: true }, seed: 84, wear: 0.3, resolution: 128 }) as THREE.MeshPhysicalMaterial;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material), blobs = new Map<string, Uint8Array>();
    const payload = serializeModelSource(mesh, []) as unknown as CreationValue;
    const frozen = await externalizeCreationValue(payload, async binary => {
      const name = `${(blobs.size + 1).toString(16).padStart(64, '0')}.${binary.ext}`;
      blobs.set(name, binary.bytes.slice()); return `vibi-blob:${name}`;
    });
    expect(blobs.size).toBeGreaterThanOrEqual(4); expect(JSON.stringify(frozen)).toContain('vibi-blob:');
    const hydrated = await resolveCreationValue(frozen, async ref => blobs.get(ref.name)!);
    const loaded = await loadModelSource(hydrated), restored = (loaded.object as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
    expect(restored.userData['vibi3dMaterial'].params.fakeInterior).toBe(true); expect(restored.transmission).toBe(0.08);
    for (const slot of ['map', 'normalMap', 'roughnessMap', 'aoMap'] as const) {
      expect((restored[slot] as THREE.DataTexture).image.data).toEqual((material[slot] as THREE.DataTexture).image.data);
    }
    const editor = new ModelEditor(loaded.object);
    editor.apply({ type: 'material', id: editor.getId(loaded.object)!, material: { params: { fakeInterior: false } } }, 0);
    expect(restored.transmission).toBe(0.9);
  });
});
