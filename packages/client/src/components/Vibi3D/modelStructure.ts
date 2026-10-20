import * as THREE from 'three';

export function newIds(object: THREE.Object3D): void {
  const mapping = new Map<string, string>();
  object.traverse((child) => {
    const id = THREE.MathUtils.generateUUID();
    mapping.set(String(child.userData['vibi3dId'] ?? child.uuid), id); child.userData['vibi3dId'] = id;
    const mesh = child as THREE.Mesh;
    if (mesh.material) mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone();
  });
  // A clone owns its recipes and parts. Leaving internal references on the source lets regeneration consume the copy.
  object.traverse(child => {
    for (const key of ['vibi3dArchitectureOwner', 'vibi3dDecorationOwner', 'vibi3dMascotOwner']) {
      const replacement = mapping.get(child.userData[key]);
      if (replacement) child.userData[key] = replacement;
      else delete child.userData[key]; // A separately copied part is a manual attachment, not another part owned by the source.
    }
    const instance = child.userData['vibi3dInstance'];
    if (instance) {
      instance.placementId = child.userData['vibi3dId'];
      if (mapping.has(instance.arrayId)) instance.arrayId = mapping.get(instance.arrayId);
    }
    const decal = child.userData['vibi3dDecalRecipe'];
    if (decal && mapping.has(decal.target)) decal.target = mapping.get(decal.target);
  });
}
/**
 * True when the subtree holds part of a rig but not all of it: deleting or regrouping a bone or a skinned mesh on its
 * own would tear the skeleton (animation keys are local to each bone's parent). A whole character moves as one.
 */
export function splitsRig(root: THREE.Object3D, subtree: THREE.Object3D): boolean {
  const inside = new Set<THREE.Object3D>();
  subtree.traverse((node) => inside.add(node));
  let torn = false;
  root.traverse((node) => {
    if (torn || !(node instanceof THREE.SkinnedMesh)) return;
    const parts = [node, ...node.skeleton.bones];
    const within = parts.filter((part) => inside.has(part)).length;
    if (within > 0 && within < parts.length) torn = true;
  });
  return torn;
}
