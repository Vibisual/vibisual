import * as THREE from 'three';

/** Authoring prototypes are data, not part of the rendered scene or the camera's frame. */
export function modelObjectVisible(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (!node.visible || node.userData['vibi3dKitLibrary'] === true || node.userData['vibi3dKitPrototype'] === true) return false;
  }
  return true;
}

function localBounds(object: THREE.Object3D): THREE.Box3 | null {
  const mesh = object as THREE.Mesh;
  if (!mesh.geometry) return null;
  if (object instanceof THREE.SkinnedMesh) {
    object.computeBoundingBox();
    return object.boundingBox;
  }
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox;
}

function expandMesh(box: THREE.Box3, object: THREE.Object3D, ids?: Set<string>): void {
  const bounds = localBounds(object);
  if (!bounds) return;
  if (object instanceof THREE.InstancedMesh) {
    const mapped: unknown = object.userData['vibi3dInstanceIds'];
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < object.count; index += 1) {
      if (ids && (!Array.isArray(mapped) || !ids.has(mapped[index] as string))) continue;
      object.getMatrixAt(index, matrix); matrix.premultiply(object.matrixWorld);
      // During a transform preview the kit engine hides removed instances with a zero-scale matrix.
      if (matrix.determinant() === 0) continue;
      box.union(bounds.clone().applyMatrix4(matrix));
    }
  } else if (!ids) box.union(bounds.clone().applyMatrix4(object.matrixWorld));
}

/** All visible vertices, including each live instance; never a hidden prototype's origin or size. */
export function visibleModelBounds(root: THREE.Object3D): THREE.Box3 {
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  root.traverse(object => { if (modelObjectVisible(object)) expandMesh(box, object); });
  return box;
}

/** Logical placements have no geometry: collect their stable IDs and the matching GPU instances. */
export function selectionModelBounds(root: THREE.Object3D, selected: THREE.Object3D): THREE.Box3 {
  root.updateWorldMatrix(true, true);
  const ids = new Set<string>();
  selected.traverse(object => {
    const id: unknown = object.userData['vibi3dId'];
    if (typeof id === 'string' && modelObjectVisible(object)) ids.add(id);
  });
  const bounds = visibleModelBounds(selected);
  root.traverse(object => {
    if (object.userData['vibi3dKitBucket'] === true && modelObjectVisible(object)) expandMesh(bounds, object, ids);
  });
  return bounds;
}

/** The command target is always a stable logical object, never an exposed GPU instance index. */
export function modelPickObject(root: THREE.Object3D, hit: THREE.Intersection): THREE.Object3D | null {
  if (!modelObjectVisible(hit.object)) return null;
  if (hit.object.userData['vibi3dKitBucket'] !== true) return hit.object;
  const ids: unknown = hit.object.userData['vibi3dInstanceIds'];
  if (hit.instanceId === undefined || !Array.isArray(ids)) return null;
  const id: unknown = ids[hit.instanceId];
  if (typeof id !== 'string') return null;
  let selected: THREE.Object3D | null = null;
  root.traverse(object => { if (object.userData['vibi3dId'] === id && modelObjectVisible(object)) selected = object; });
  return selected;
}

/** Stop after the nearest usable hit; mapping all intersected instances would repeatedly scan the logical tree. */
export function firstModelPick(root: THREE.Object3D, hits: THREE.Intersection[]): THREE.Object3D | null {
  for (const hit of hits) {
    const selected = modelPickObject(root, hit);
    if (selected) return selected;
  }
  return null;
}

/** Keep the existing selection helper; its world-space corners can also describe empty placement groups. */
export function updateSelectionBox(helper: THREE.BoxHelper, root: THREE.Object3D, selected: THREE.Object3D | null | undefined): void {
  const box = selected ? selectionModelBounds(root, selected) : new THREE.Box3();
  helper.visible = !box.isEmpty();
  if (box.isEmpty()) return;
  const { min, max } = box;
  const positions = helper.geometry.getAttribute('position');
  positions.setXYZ(0, max.x, max.y, max.z); positions.setXYZ(1, min.x, max.y, max.z);
  positions.setXYZ(2, min.x, min.y, max.z); positions.setXYZ(3, max.x, min.y, max.z);
  positions.setXYZ(4, max.x, max.y, min.z); positions.setXYZ(5, min.x, max.y, min.z);
  positions.setXYZ(6, min.x, min.y, min.z); positions.setXYZ(7, max.x, min.y, min.z);
  positions.needsUpdate = true; helper.geometry.computeBoundingSphere();
}
