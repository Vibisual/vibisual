import * as THREE from 'three';
import { CreationUiError } from '../Creation/creationErrors.js';
import { isModelKitInternal } from './modelKitMetadata.js';

export function findGraphicObject(root: THREE.Object3D, id: string): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  root.traverse(node => { if (node.userData['vibi3dId'] === id) found = node; });
  return found;
}
export function assertGraphicEditable(object: THREE.Object3D, descendants = false): void {
  if (isModelKitInternal(object)) throw new CreationUiError('kit-nested-module');
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (node.userData['vibi3dLocked']) throw new CreationUiError('object-protected');
  }
  if (descendants) object.traverse(node => { if (node.userData['vibi3dLocked']) throw new CreationUiError('object-protected'); });
}
export function graphicParent(root: THREE.Object3D, existing?: THREE.Object3D, parentId?: string): THREE.Object3D {
  const parent = parentId ? findGraphicObject(root, parentId) : existing?.parent ?? root;
  if (!parent) throw new CreationUiError('object-missing');
  for (let node: THREE.Object3D | null = parent; node; node = node.parent) if (node === existing) throw new CreationUiError('invalid-mascot-recipe');
  assertGraphicEditable(parent); return parent;
}

/** Keep logical part objects and user-added children; regenerated meshes replace only their authored resources. */
export function reconcileGraphicParts(group: THREE.Group, replacement: THREE.Group, owner: string, root: THREE.Object3D): void {
  const old = new Map<unknown, THREE.Object3D>();
  root.traverse(node => { if (node.userData['vibi3dMascotOwner'] === owner) old.set(node.userData['vibi3dMascotPart'], node); });
  // A user may have regrouped a generated part outside its original assembly. Reuse that ID, never duplicate it.
  for (const part of old.values()) assertGraphicEditable(part, true);
  for (const next of [...replacement.children]) {
    const prior = old.get(next.userData['vibi3dMascotPart']);
    const conflict = findGraphicObject(root, next.userData['vibi3dId']);
    if (conflict && ![...old.values()].includes(conflict)) throw new CreationUiError('object-id-exists');
    if (prior instanceof THREE.Mesh && next instanceof THREE.Mesh) {
      prior.geometry = next.geometry; prior.material = next.material;
      prior.position.copy(next.position); prior.quaternion.copy(next.quaternion); prior.scale.copy(next.scale);
      prior.userData = { ...prior.userData, ...next.userData, vibi3dId: prior.userData['vibi3dId'] }; old.delete(next.userData['vibi3dMascotPart']);
      if (prior.parent !== group) group.add(prior);
    } else group.add(next);
  }
  group.updateWorldMatrix(true, true);
  for (const obsolete of old.values()) {
    for (const child of [...obsolete.children]) if (child.userData['vibi3dMascotOwner'] !== owner) group.attach(child);
    obsolete.removeFromParent();
  }
}
