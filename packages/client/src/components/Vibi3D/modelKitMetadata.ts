import * as THREE from 'three';
import { validateVibi3DKitModules, validateVibi3DInstance, type Vibi3DKitModule } from '@vibisual/shared';
import { creationIntentId } from '../Creation/creationApi.js';
import { CreationUiError } from '../Creation/creationErrors.js';

export const modelKitId = (object: THREE.Object3D): string => String(object.userData['vibi3dId'] ?? object.uuid);
export function readModelKitModules(root: THREE.Object3D): Vibi3DKitModule[] {
  const value = root.userData['vibi3dKitModules']; if (value === undefined) return [];
  const modules = validateVibi3DKitModules(value); if (!modules) throw new CreationUiError('invalid-model-source'); return modules;
}
export function hasKitMotion(object: THREE.Object3D): boolean {
  return Object.keys(object.userData['vibi3dMotions'] ?? {}).length > 0 || !!object.userData['vibi3dMotion'];
}
export function isModelKitInternal(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (node.userData['vibi3dKitLibrary'] || node.userData['vibi3dKitBucket']) return true;
  return false;
}
export function findKitObject(root: THREE.Object3D, id: string): THREE.Object3D | undefined {
  let result: THREE.Object3D | undefined; root.traverse(node => { if (!result && modelKitId(node) === id) result = node; }); return result;
}
export function assertKitUnlocked(object: THREE.Object3D): void {
  let locked = false; object.traverse(node => { if (node.userData['vibi3dLocked']) locked = true; });
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (node.userData['vibi3dLocked']) locked = true;
  if (locked) throw new CreationUiError('object-protected');
}
export function kitLibrary(root: THREE.Object3D): THREE.Group {
  const existing = root.children.find(node => node.userData['vibi3dKitLibrary']); if (existing) return existing as THREE.Group;
  const group = new THREE.Group(); group.name = 'Kit prototypes'; group.visible = false;
  group.uuid = creationIntentId('kit-library', modelKitId(root)); group.userData = { vibi3dId: group.uuid, vibi3dKitLibrary: true };
  root.add(group); return group;
}
export function kitPrototype(root: THREE.Object3D, module: Vibi3DKitModule): THREE.Object3D {
  const object = root.children.find(node => node.userData['vibi3dKitLibrary'])?.children.find(node => modelKitId(node) === module.prototypeId);
  if (!object?.userData['vibi3dKitPrototype']) throw new CreationUiError('kit-module-missing'); return object;
}
export function kitPlacements(root: THREE.Object3D, moduleId?: string): THREE.Object3D[] {
  const result: THREE.Object3D[] = [];
  root.traverse(node => { const instance = validateVibi3DInstance(node.userData['vibi3dInstance']); if (instance && !isModelKitInternal(node) && (!moduleId || instance.moduleId === moduleId)) result.push(node); });
  return result;
}
