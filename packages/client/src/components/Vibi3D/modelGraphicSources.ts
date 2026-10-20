import type * as THREE from 'three';
import type { Vibi3DMaterial } from '@vibisual/shared';
import { isModelKitInternal } from './modelKitMetadata.js';

export function modelGraphicSourceOwners(root: THREE.Object3D, target: THREE.Object3D): Map<THREE.Object3D, string> {
  const owners = new Map<THREE.Object3D, string>();
  target.traverse(node => {
    if (node.userData['vibi3dDecalRecipe']) { owners.set(node, 'vibi3dDecalRecipe'); return; }
    const key = String(node.userData['vibi3dDecorationKey'] ?? '').startsWith('artwork-') ? 'vibi3dSignRecipe'
      : node.userData['vibi3dMascotPart'] === 'image' ? 'vibi3dMascotRecipe' : null;
    if (!key) return;
    // A frozen prototype has its own recipe; never follow its copied owner ID into the original source assembly.
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (parent.userData[key]) { owners.set(parent, key); return; }
    }
    if (isModelKitInternal(node)) return;
    const id = node.userData[key === 'vibi3dSignRecipe' ? 'vibi3dDecorationOwner' : 'vibi3dMascotOwner'];
    root.traverse(candidate => { if (candidate.userData['vibi3dId'] === id && candidate.userData[key]) owners.set(candidate, key); });
  });
  return owners;
}

/** The existing image hand also updates the recipe used by the next sign/decal/standee regeneration. */
export function syncModelGraphicSource(root: THREE.Object3D, target: THREE.Object3D, change: Vibi3DMaterial,
  assertEditable: (object: THREE.Object3D) => void): void {
  const source = change.maps?.map?.source;
  if (!source || source.kind === 'procedural') return;
  const owners = modelGraphicSourceOwners(root, target);
  for (const owner of owners.keys()) assertEditable(owner);
  for (const [owner, key] of owners) owner.userData[key] = { ...owner.userData[key], source: structuredClone(source) };
}
