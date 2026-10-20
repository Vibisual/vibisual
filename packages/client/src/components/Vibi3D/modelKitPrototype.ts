import * as THREE from 'three';
import { VIBI3D_LIMITS } from '@vibisual/shared';
import { creationIntentId } from '../Creation/creationApi.js';
import { CreationUiError } from '../Creation/creationErrors.js';
import { hasKitMotion, isModelKitInternal, modelKitId } from './modelKitMetadata.js';

/** Freeze native meshes into an independent prototype. Texture pixel sources remain immutable shared data. */
export function cloneKitPrototype(source: THREE.Object3D, moduleId: string): { object: THREE.Object3D; partCount: number } {
  let parts = 0;
  source.traverse(node => {
    if (isModelKitInternal(node) || node.userData['vibi3dInstance'] || node.userData['vibi3dArray']) throw new CreationUiError('kit-nested-module');
    if (!(node instanceof THREE.Mesh || node instanceof THREE.Group || node.type === 'Object3D' || node instanceof THREE.Scene)
      || node instanceof THREE.SkinnedMesh || node instanceof THREE.InstancedMesh || (node as THREE.Mesh).morphTargetInfluences?.length) throw new CreationUiError('kit-source-unsupported');
    if (node instanceof THREE.Mesh) parts++;
    if (node.scale.toArray().some(value => !Number.isFinite(value) || value <= 0)) throw new CreationUiError('kit-instance-transform');
    if (hasKitMotion(node)) throw new CreationUiError('kit-instance-animation');
  });
  if (!parts) throw new CreationUiError('kit-module-empty');
  if (parts > VIBI3D_LIMITS.moduleParts) throw new CreationUiError('kit-placement-limit');
  const object = source.clone(true), geometries = new Map<THREE.BufferGeometry, THREE.BufferGeometry>(), textures = new Map<THREE.Texture, THREE.Texture>();
  object.position.set(0, 0, 0); object.quaternion.identity(); object.visible = true;
  object.traverse(node => {
    const key = modelKitId(node); node.uuid = creationIntentId('kit-prototype-node', moduleId, key);
    node.userData = structuredClone(node.userData); node.userData['vibi3dId'] = node.uuid;
    delete node.userData['vibi3dLocked']; delete node.userData['vibi3dMotions']; delete node.userData['vibi3dMotion'];
    if (!(node instanceof THREE.Mesh)) return;
    const original: THREE.BufferGeometry = node.geometry; let geometry = geometries.get(original);
    if (!geometry) { const copy: THREE.BufferGeometry = original.clone(); copy.uuid = creationIntentId('kit-geometry', moduleId, original.uuid); geometries.set(original, copy); geometry = copy; }
    node.geometry = geometry;
    const cloneMaterial = (old: THREE.Material): THREE.Material => {
      const material = old.clone(); Object.assign(material, { uuid: creationIntentId('kit-material', moduleId, key, old.uuid) });
      for (const [slot, value] of Object.entries(material)) if (value instanceof THREE.Texture) {
        let texture = textures.get(value);
        if (!texture) { texture = value.clone(); texture.uuid = creationIntentId('kit-texture', moduleId, value.uuid); textures.set(value, texture); }
        Object.assign(material, { [slot]: texture });
      }
      return material;
    };
    node.material = Array.isArray(node.material) ? node.material.map(cloneMaterial) : cloneMaterial(node.material);
  });
  object.uuid = creationIntentId('kit-prototype', moduleId); object.userData['vibi3dId'] = object.uuid;
  object.userData['vibi3dKitPrototype'] = true; object.userData['vibi3dKitModuleId'] = moduleId;
  return { object, partCount: parts };
}
