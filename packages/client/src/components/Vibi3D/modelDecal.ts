import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { validateVibi3DDecalRecipe, type Vibi3DDecalCommand, type Vibi3DDecalRecipe } from '@vibisual/shared';
import { creationIntentId } from '../Creation/creationApi.js';
import { CreationUiError } from '../Creation/creationErrors.js';
import { bakedGeometry } from './modelAdvancedGeometry.js';
import { createModelMaterial } from './modelMaterials.js';
import { assertGraphicEditable, findGraphicObject } from './modelGraphicObjects.js';

/** MIT Three DecalGeometry clips triangles in target-local coordinates, avoiding world-scale projection drift. */
export function buildDecalGeometry(target: THREE.Mesh, recipe: Vibi3DDecalRecipe): THREE.BufferGeometry {
  const normal = new THREE.Vector3().fromArray(recipe.normal).normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(recipe.rotation ?? 0)));
  const position = new THREE.Vector3().fromArray(recipe.position);
  if (recipe.projection === 'flat') {
    const geometry = new THREE.PlaneGeometry(recipe.size[0], recipe.size[1]);
    geometry.applyQuaternion(quaternion); geometry.translate(position.x, position.y, position.z);
    return bakedGeometry(geometry);
  }
  // The temporary mesh shares only immutable input geometry/material; it never enters a scene or owns resources.
  const local = new THREE.Mesh(target.geometry, target.material); local.updateMatrixWorld(true);
  const geometry = new DecalGeometry(local, position, new THREE.Euler().setFromQuaternion(quaternion),
    new THREE.Vector3(recipe.size[0], recipe.size[1], recipe.size[2] ?? Math.min(recipe.size[0], recipe.size[1]) / 4));
  if (!geometry.getAttribute('position').count) { geometry.dispose(); throw new CreationUiError('decal-misses-surface'); }
  return bakedGeometry(geometry);
}

export function applyModelDecal(root: THREE.Object3D, command: Vibi3DDecalCommand, texture?: THREE.Texture): string {
  const id = command.id ?? crypto.randomUUID(), existing = findGraphicObject(root, id);
  if (existing && (!(existing instanceof THREE.Mesh) || !existing.userData['vibi3dDecalRecipe'])) throw new CreationUiError('object-id-exists');
  if (existing) assertGraphicEditable(existing, true);
  const { type: _type, id: _id, name: _name, ...patch } = command;
  const prior = existing ? validateVibi3DDecalRecipe(existing.userData['vibi3dDecalRecipe']) : null;
  const recipe = validateVibi3DDecalRecipe({ ...prior, ...patch });
  if (!recipe) throw new CreationUiError('invalid-decal-recipe');
  const target = findGraphicObject(root, recipe.target);
  if (!(target instanceof THREE.Mesh) || target instanceof THREE.InstancedMesh || target instanceof THREE.SkinnedMesh || target.morphTargetInfluences?.length) throw new CreationUiError('decal-target-mesh-required');
  assertGraphicEditable(target);
  for (let node: THREE.Object3D | null = target; node; node = node.parent) if (node === existing) throw new CreationUiError('invalid-decal-recipe');
  const oldMap = existing instanceof THREE.Mesh && existing.material instanceof THREE.MeshStandardMaterial ? existing.material.map : null;
  const image = texture ?? (JSON.stringify(prior?.source) === JSON.stringify(recipe.source) ? oldMap : null);
  if (!image) throw new CreationUiError('image-source-unavailable');
  const geometry = buildDecalGeometry(target, recipe);
  const material = createModelMaterial({ color: '#ffffff', roughness: 0.8, maps: { map: { source: recipe.source } },
    transparent: true, alphaTest: 0.01, side: 'double', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, { map: image });
  material.depthWrite = false; material.map!.wrapS = material.map!.wrapT = THREE.ClampToEdgeWrapping;
  const object = existing as THREE.Mesh | undefined ?? new THREE.Mesh(geometry, material);
  if (!existing) { object.uuid = creationIntentId('decal-object', id); object.name = command.name ?? 'Decal'; }
  else { object.geometry = geometry; object.material = material; if (command.name !== undefined) object.name = command.name; }
  object.userData['vibi3dId'] = id; object.userData['vibi3dDecal'] = true; object.userData['vibi3dUvMode'] = 'image';
  object.userData['vibi3dDecalRecipe'] = structuredClone(recipe);
  if (object.parent !== target) target.add(object);
  return id;
}
