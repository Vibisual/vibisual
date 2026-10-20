import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { captureModel, restoreModel } from './modelHistory.js';
import { modelPickObject, selectionModelBounds, updateSelectionBox, visibleModelBounds } from './modelBounds.js';
import { loadModelSource, serializeModelSource } from './modelSource.js';
import { ModelScene } from '../Creation/modelScene.js';
import { disposeModel } from '../Creation/modelIO.js';

function fixture(): { root: THREE.Group; a: THREE.Group; b: THREE.Group; mesh: THREE.InstancedMesh; prototype: THREE.Mesh } {
  const root = new THREE.Group(); root.userData['vibi3dId'] = 'root';
  const a = new THREE.Group(), b = new THREE.Group();
  a.name = 'Placement A'; a.userData['vibi3dId'] = 'placement-a'; b.userData['vibi3dId'] = 'placement-b';
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial(), 2);
  mesh.userData = { vibi3dKitBucket: true, vibi3dInstanceIds: ['placement-a', 'placement-b'] };
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(10, 0, 0));
  mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(20, 0, 0));
  mesh.setColorAt(0, new THREE.Color('#ff0000')); mesh.setColorAt(1, new THREE.Color('#0000ff'));
  const library = new THREE.Group(); library.userData['vibi3dKitLibrary'] = true; library.visible = false;
  const prototype = new THREE.Mesh(new THREE.BoxGeometry(200, 200, 200), new THREE.MeshBasicMaterial());
  prototype.userData['vibi3dKitPrototype'] = true; prototype.position.set(500, 500, 500); library.add(prototype);
  root.add(a, b, mesh, library); root.updateMatrixWorld(true);
  return { root, a, b, mesh, prototype };
}

describe('instanced authoring history and source', () => {
  it.each(['editor', 'video'] as const)('releases dedicated instance GPU buffers when a %s model is closed', target => {
    const { root, mesh } = fixture(); let disposed = 0;
    mesh.addEventListener('dispose', () => { disposed += 1; });
    if (target === 'editor') disposeModel(root); else new ModelScene(root, []).dispose();
    expect(disposed).toBe(1);
  });

  it('restores matrix buffers, active count, colors, ID order and cached ray bounds on undo/redo', () => {
    const { root, mesh } = fixture(); const before = captureModel(root, []); const gpuMatrix = mesh.instanceMatrix;
    const initialMatrix = [...mesh.instanceMatrix.array], initialColors = [...mesh.instanceColor!.array];
    mesh.count = 1; mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-50, 0, 0));
    mesh.setColorAt(0, new THREE.Color('#00ff00')); mesh.userData['vibi3dInstanceIds'] = ['placement-b']; mesh.computeBoundingSphere();
    const after = captureModel(root, []);
    restoreModel(before, []);
    expect(mesh.count).toBe(2); expect([...mesh.instanceMatrix.array]).toEqual(initialMatrix); expect([...mesh.instanceColor!.array]).toEqual(initialColors);
    expect(mesh.instanceMatrix).toBe(gpuMatrix);
    expect(mesh.userData['vibi3dInstanceIds']).toEqual(['placement-a', 'placement-b']);
    expect(mesh.boundingSphere!.center.x).toBeCloseTo(15);
    expect(new THREE.Raycaster(new THREE.Vector3(20, 0, 5), new THREE.Vector3(0, 0, -1)).intersectObject(mesh)[0]?.instanceId).toBe(1);
    restoreModel(after, []); expect(mesh.count).toBe(1); expect(mesh.boundingSphere!.center.x).toBeCloseTo(-50);
    restoreModel(before, []); expect([...mesh.instanceMatrix.array]).toEqual(initialMatrix);
  });

  it('removes a later color buffer and restores hidden library visibility', () => {
    const { root, mesh, prototype } = fixture(); mesh.instanceColor = null;
    const before = captureModel(root, []); mesh.setColorAt(0, new THREE.Color('red')); prototype.parent!.visible = true;
    restoreModel(before, []); expect(mesh.instanceColor).toBeNull(); expect(prototype.parent!.visible).toBe(false);
  });

  it('round trips actual GPU arrays/count and stable-ID selection through source JSON', async () => {
    const { root, mesh } = fixture(); mesh.count = 1;
    const source = JSON.parse(JSON.stringify(serializeModelSource(root, [])));
    const { object } = await loadModelSource(source);
    const loaded = object.getObjectByProperty('isInstancedMesh', true) as THREE.InstancedMesh;
    expect(loaded.count).toBe(1); expect([...loaded.instanceMatrix.array]).toEqual([...mesh.instanceMatrix.array]);
    expect([...loaded.instanceColor!.array]).toEqual([...mesh.instanceColor!.array]);
    const hit = new THREE.Raycaster(new THREE.Vector3(10, 0, 5), new THREE.Vector3(0, 0, -1)).intersectObject(object, true)
      .find(item => item.object === loaded)!;
    expect(modelPickObject(object, hit)?.userData['vibi3dId']).toBe('placement-a');
  });
});

describe('logical instance picking and framing', () => {
  it('frames visible instances and excludes prototypes even if their visible flag is accidentally true', () => {
    const { root, prototype } = fixture();
    for (const visible of [false, true]) {
      prototype.parent!.visible = visible;
      const box = visibleModelBounds(root);
      expect(box.min.toArray()).toEqual([9, -1, -1]); expect(box.max.toArray()).toEqual([21, 1, 1]);
    }
  });

  it('uses stable placement IDs when GPU order changes and rejects hidden/internal hits', () => {
    const { root, a, b, mesh, prototype } = fixture();
    const hit: THREE.Intersection = { object: mesh, instanceId: 0, distance: 0, point: new THREE.Vector3() };
    expect(modelPickObject(root, hit)).toBe(a);
    mesh.userData['vibi3dInstanceIds'] = ['placement-b', 'placement-a']; expect(modelPickObject(root, hit)).toBe(b);
    b.visible = false; expect(modelPickObject(root, hit)).toBeNull();
    expect(modelPickObject(root, { ...hit, object: prototype, instanceId: undefined })).toBeNull();
    expect(modelPickObject(root, { ...hit, instanceId: 7 })).toBeNull();
  });

  it('combines every mesh part for selected logical groups and their transformed parent', () => {
    const { root, a, b, mesh } = fixture();
    const parent = new THREE.Group(); root.add(parent); parent.add(a, b);
    const second = mesh.clone(); second.geometry = new THREE.BoxGeometry(4, 4, 4); second.position.set(0, 3, 0); root.add(second);
    expect(selectionModelBounds(root, a).min.toArray()).toEqual([8, -1, -2]);
    expect(selectionModelBounds(root, a).max.toArray()).toEqual([12, 5, 2]);
    expect(selectionModelBounds(root, parent).max.x).toBe(22);
    root.position.x = 100;
    expect(selectionModelBounds(root, a).min.x).toBe(108);
    const box = new THREE.BoxHelper(new THREE.Object3D()); updateSelectionBox(box, root, a);
    box.geometry.computeBoundingBox(); expect(box.geometry.boundingBox!.max.x).toBe(112);
    updateSelectionBox(box, root, null); expect(box.visible).toBe(false);
  });

  it('video/still picking reports the logical object and its individual screen bounds', () => {
    const { root } = fixture(); const model = new ModelScene(root, []);
    model.seekFrame(800, 600, 0, { cameraPosition: [10, 0, 10], cameraTarget: [10, 0, 0] });
    const hit = model.pickAt(400, 300, 800, 600);
    expect(hit?.objectId).toBe('placement-a'); expect(hit?.text).toBe('Placement A'); expect(hit!.rect.width).toBeLessThan(400);
    model.dispose();
  });
});
