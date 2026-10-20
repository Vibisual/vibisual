import * as THREE from 'three';

function placementVisible(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}
const matrixCache = new WeakMap<THREE.Object3D, Map<string, number[]>>();
/** Lightweight live transform preview; topology and instance membership change only through refreshModelKit. */
export function updateModelKitMatrices(root: THREE.Object3D): void {
  const container = root.children.find(node => node.userData['vibi3dKitBucket']); if (!container) return;
  root.updateWorldMatrix(true, true);
  const nodes = new Map<string, THREE.Object3D>(), previous = matrixCache.get(container), current = new Map<string, number[]>(); let changed = !previous;
  root.traverse(node => {
    if (!node.userData['vibi3dInstance']) return;
    const id = String(node.userData['vibi3dId'] ?? node.uuid), values = [...node.matrixWorld.elements, placementVisible(node) ? 1 : 0], prior = previous?.get(id);
    nodes.set(id, node); current.set(id, values);
    if (!prior || values.some((value, index) => value !== prior[index])) changed = true;
  });
  if (!changed && current.size === previous!.size) return;
  matrixCache.set(container, current);
  const inverse = root.matrixWorld.clone().invert(), matrix = new THREE.Matrix4(), hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  container.traverse(node => {
    if (!(node instanceof THREE.InstancedMesh)) return;
    const ids = node.userData['vibi3dInstanceIds'] as string[] | undefined, values = node.userData['vibi3dKitPartMatrix'] as number[] | undefined;
    if (!ids || !values || values.length !== 16) return;
    const local = new THREE.Matrix4().fromArray(values);
    ids.forEach((id, index) => {
      const placement = nodes.get(id);
      node.setMatrixAt(index, placement && placementVisible(placement) ? matrix.copy(inverse).multiply(placement.matrixWorld).multiply(local) : hidden);
    });
    node.instanceMatrix.needsUpdate = true; node.computeBoundingBox(); node.computeBoundingSphere();
  });
}
