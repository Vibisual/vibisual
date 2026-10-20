import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { buildArchitectureObject } from './modelArchitecture.js';
import { refreshModelMetricUvs } from './modelMetricUvs.js';
import { loadModelSource, serializeModelSource } from './modelSource.js';

vi.mock('./modelMaterials.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./modelMaterials.js')>();
  return { ...actual, createModelMaterial: (...args: Parameters<typeof actual.createModelMaterial>) => actual.createModelMaterial({ resolution: 128, ...args[0] }, args[1]) };
});
function assertWidthMapping(root: THREE.Object3D): void {
  root.updateMatrixWorld(true); let checked = 0;
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh) || !['canopy', 'valance'].includes(node.name) && !node.name.startsWith('seam-at-')) return;
    const positions = node.geometry.getAttribute('position'), normals = node.geometry.getAttribute('normal'), uv = node.geometry.getAttribute('uv');
    for (let vertex = 0; vertex < positions.count; vertex++) {
      if (node.name === 'valance' && Math.abs(normals.getZ(vertex)) < 0.5) continue;
      const point = new THREE.Vector3().fromBufferAttribute(positions, vertex).applyMatrix4(node.matrixWorld);
      expect(uv.getX(vertex), node.name).toBeCloseTo(point.x, 5); checked++;
    }
  });
  expect(checked).toBeGreaterThan(100);
}
describe('continuous metre-sized awning stripes', () => {
  it('aligns canopy, seams and front valance at the same width coordinates after scaling and a document round trip', async () => {
    const shop = buildArchitectureObject({ kind: 'storefront', detail: 'architectural', width: 4, awning: { depth: 1.2, drop: 0.3 } }, 'shop');
    assertWidthMapping(shop);
    shop.scale.set(2, 1, 0.75); refreshModelMetricUvs(shop); assertWidthMapping(shop);
    const loaded = await loadModelSource(serializeModelSource(shop, [])); assertWidthMapping(loaded.object);
    const canopy = loaded.object.getObjectByName('canopy') as THREE.Mesh;
    expect(canopy.geometry.userData['vibi3dMetricUvProjection']).toEqual({ axes: [2, 0], offset: [-2, 0] });
  });
  it('keeps a drainage grate flush with the asphalt instead of floating above it', () => {
    const street = buildArchitectureObject({ kind: 'street', detail: 'architectural', length: 3, sidewalks: 'left' }, 'street');
    const grate = street.getObjectByName('grate')!;
    expect(new THREE.Box3().setFromObject(grate).max.y).toBeCloseTo(0, 6);
  });
});
