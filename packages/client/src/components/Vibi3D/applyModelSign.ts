import * as THREE from 'three';
import { validateVibi3DSignRecipe, type Vibi3DSignCommand } from '@vibisual/shared';
import { CreationUiError } from '../Creation/creationErrors.js';

const idOf = (object: THREE.Object3D): string => String(object.userData['vibi3dId'] ?? object.uuid);
const keyOf = (object: THREE.Object3D): string | undefined => object.userData['vibi3dDecorationKey'] as string | undefined;
function unlocked(object: THREE.Object3D, descendants: boolean): void {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (node.userData['vibi3dLocked']) throw new CreationUiError('object-protected');
  if (descendants) object.traverse(node => { if (node.userData['vibi3dLocked']) throw new CreationUiError('object-protected'); });
}

/** Install prepared geometry while retaining real objects, stable selections, transforms and manually attached children. */
export function applyModelSign(root: THREE.Object3D, command: Vibi3DSignCommand, prepared: THREE.Group): string {
  const id = command.id ?? idOf(prepared), objects = new Map<string, THREE.Object3D>(); root.traverse(node => objects.set(idOf(node), node));
  if (idOf(prepared) !== id || !validateVibi3DSignRecipe(prepared.userData['vibi3dSignRecipe'])) throw new CreationUiError('invalid-command');
  const existing = objects.get(id), parent = command.parentId ? objects.get(command.parentId) : existing?.parent ?? root;
  if (existing && (existing === root || !validateVibi3DSignRecipe(existing.userData['vibi3dSignRecipe']))) throw new CreationUiError('object-id-exists');
  if (!parent) throw new CreationUiError('object-missing'); unlocked(parent, false); if (existing) unlocked(existing, true);
  for (let node: THREE.Object3D | null = parent; node; node = node.parent) if (node === existing) throw new CreationUiError('root-not-groupable');
  const formerOwner = existing?.userData['vibi3dDecorationOwner'] ?? id, owned = new Set<THREE.Object3D>();
  existing?.traverse(node => { if (node === existing || node.userData['vibi3dDecorationOwner'] === formerOwner) owned.add(node); });
  const seen = new Set<string>(); prepared.traverse(node => {
    const childId = idOf(node), conflict = objects.get(childId);
    if (seen.has(childId) || (conflict && !owned.has(conflict))) throw new CreationUiError('object-id-exists'); seen.add(childId);
  });
  root.updateWorldMatrix(true, true);
  const manual: { object: THREE.Object3D; parent: THREE.Object3D; world: THREE.Matrix4 }[] = [];
  for (const node of owned) for (const child of node.children) if (!owned.has(child)) manual.push({ object: child, parent: node, world: child.matrixWorld.clone() });
  const byKey = new Map([...owned].map(node => [keyOf(node), node])), replacements = new Map<THREE.Object3D, THREE.Object3D>();
  if (existing) { prepared.position.copy(existing.position); prepared.quaternion.copy(existing.quaternion); prepared.scale.copy(existing.scale); prepared.name = command.name ?? existing.name; }
  else if (command.name) prepared.name = command.name;
  const install = (fresh: THREE.Object3D, isRoot = false): THREE.Object3D => {
    const candidate = isRoot ? existing : objects.get(idOf(fresh)) ?? byKey.get(keyOf(fresh));
    const old = candidate && owned.has(candidate) ? candidate : undefined, object = old?.constructor === fresh.constructor ? old : fresh, children = [...fresh.children];
    if (old) replacements.set(old, object);
    if (object !== fresh) {
      const stableId = idOf(object); object.position.copy(fresh.position); object.quaternion.copy(fresh.quaternion); object.scale.copy(fresh.scale); object.name = fresh.name;
      object.userData = { ...object.userData, ...structuredClone(fresh.userData), vibi3dId: stableId, vibi3dDecorationOwner: id };
      if (object instanceof THREE.Mesh && fresh instanceof THREE.Mesh) { object.geometry = fresh.geometry; object.material = fresh.material; }
    }
    object.clear(); children.forEach(child => object.add(install(child))); object.updateMatrix(); return object;
  };
  const result = install(prepared, true);
  if (existing && result.parent !== parent) parent.attach(result); else parent.add(result);
  if (command.position) result.position.fromArray(command.position);
  if (command.rotation) result.rotation.set(...command.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]);
  result.updateWorldMatrix(true, true);
  for (const child of manual) {
    const preservedParent = replacements.get(child.parent);
    if (preservedParent) preservedParent.add(child.object);
    else { result.add(child.object); child.object.matrix.copy(result.matrixWorld).invert().multiply(child.world); child.object.matrix.decompose(child.object.position, child.object.quaternion, child.object.scale); }
  }
  result.updateWorldMatrix(true, true); return id;
}
