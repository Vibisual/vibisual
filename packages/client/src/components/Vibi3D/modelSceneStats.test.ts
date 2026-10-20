import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { modelSceneStats } from './modelSceneStats.js';

describe('native scene statistics', () => {
  it('counts instanced triangles and base draw calls while excluding hidden prototypes from objects and memory', () => {
    const root = new THREE.Group(), library = new THREE.Group(), container = new THREE.Group();
    library.visible = false; library.userData['vibi3dKitLibrary'] = true;
    container.userData['vibi3dKitBucket'] = true; root.add(library, container);
    library.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    const pixels = new THREE.DataTexture(new Uint8Array(16), 2, 2); pixels.generateMipmaps = false;
    const material = new THREE.MeshStandardMaterial({ map: pixels });
    const bucket = new THREE.InstancedMesh(new THREE.BoxGeometry(), material, 2000); container.add(bucket);
    bucket.userData['vibi3dKitBucket'] = true;
    for (let index = 0; index < 2000; index++) { const logical = new THREE.Group(); logical.userData['vibi3dInstance'] = {}; root.add(logical); }
    const stats = modelSceneStats(root, 7);
    expect(stats).toMatchObject({ sceneRevision: 7, objects: 2000, instances: 2000, triangles: 24000, drawCalls: 1, textureBytes: 16, drawCallsSource: 'estimated' });
  });
  it('deduplicates shared image uploads and reports budget warnings without mutating the scene', () => {
    const root = new THREE.Group(), pixels = new THREE.DataTexture(new Uint8Array(16), 2, 2); pixels.generateMipmaps = false;
    const a = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: pixels }));
    const b = new THREE.InstancedMesh(a.geometry, new THREE.MeshStandardMaterial({ map: pixels.clone() }), 200001);
    root.add(a, b); const before = root.children.slice(), stats = modelSceneStats(root, 0);
    expect(stats.textureBytes).toBe(16); expect(stats.drawCalls).toBe(2);
    expect(stats.warnings.some(warning => warning.metric === 'triangles')).toBe(true);
    expect(root.children).toEqual(before);
  });
  it('honours indexed geometry draw ranges and visible material groups', () => {
    const root = new THREE.Group(), geometry = new THREE.BoxGeometry();
    geometry.setDrawRange(0, 12);
    const visible = new THREE.MeshBasicMaterial(), hidden = new THREE.MeshBasicMaterial({ visible: false });
    root.add(new THREE.Mesh(geometry, [visible, hidden, visible, visible, visible, visible]));
    expect(modelSceneStats(root, 0)).toMatchObject({ triangles: 2, drawCalls: 1 });
  });
});
