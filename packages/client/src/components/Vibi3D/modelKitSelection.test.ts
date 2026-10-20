import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyModelKit, refreshModelKit, updateModelKitMatrices } from './modelKit.js';
import { captureModel, restoreModel } from './modelHistory.js';
import { firstModelPick, selectionModelBounds, visibleModelBounds } from './modelBounds.js';
import { loadModelSource, serializeModelSource } from './modelSource.js';

function rootWithModule(): THREE.Group {
  const root = new THREE.Group(); root.userData['vibi3dId'] = 'root';
  const source = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial());
  source.userData['vibi3dId'] = 'source'; root.add(source);
  applyModelKit(root, { type: 'kitModule', id: 'module', sourceId: 'source' });
  source.removeFromParent();
  return root;
}

describe('kit engine, history and logical selection integration', () => {
  it('preserves a selected stable ID through array resizing, source reload, live transform and history', async () => {
    const root = rootWithModule();
    applyModelKit(root, { type: 'array', id: 'row', moduleId: 'module', counts: [3, 1, 1], step: [4, 0, 0] });
    refreshModelKit(root);
    const array = root.children.find(node => node.userData['vibi3dArray'])!;
    const selected = array.children[1]!, id = selected.userData['vibi3dId'];
    const before = captureModel(root, []);
    array.position.x = 10; updateModelKitMatrices(root);
    expect(selectionModelBounds(root, selected).getCenter(new THREE.Vector3()).x).toBe(14);
    restoreModel(before, []);
    expect(selectionModelBounds(root, selected).getCenter(new THREE.Vector3()).x).toBe(4);
    applyModelKit(root, { type: 'array', id: 'row', moduleId: 'module', counts: [5, 1, 1], step: [4, 0, 0] });
    refreshModelKit(root);
    expect(array.children[1]!.userData['vibi3dId']).toBe(id);
    const { object } = await loadModelSource(JSON.parse(JSON.stringify(serializeModelSource(root, []))));
    const ray = new THREE.Raycaster(new THREE.Vector3(4, 0, 10), new THREE.Vector3(0, 0, -1));
    object.updateMatrixWorld(true);
    const hit = firstModelPick(object, ray.intersectObject(object, true));
    expect(hit?.userData['vibi3dId']).toBe(id);
    expect(selectionModelBounds(object, hit!).getCenter(new THREE.Vector3()).x).toBe(4);
  });

  it('does not frame hidden prototypes or zero-scaled preview placeholders', () => {
    const root = rootWithModule();
    applyModelKit(root, { type: 'place', id: 'one', moduleId: 'module', position: [30, 0, 0] });
    applyModelKit(root, { type: 'place', id: 'two', moduleId: 'module', position: [40, 0, 0] });
    refreshModelKit(root);
    const one = root.children.find(node => node.userData['vibi3dId'] === 'one')!;
    one.visible = false; updateModelKitMatrices(root);
    expect(visibleModelBounds(root).min.x).toBe(39);
    refreshModelKit(root); expect(visibleModelBounds(root).min.x).toBe(39);
  });
});
