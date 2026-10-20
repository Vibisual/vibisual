import * as THREE from 'three';
import { VIBI3D_LIMITS, type Vibi3DInstance, type Vibi3DNodeShadows } from '@vibisual/shared';
import { creationIntentId } from '../Creation/creationApi.js';
import { CreationUiError } from '../Creation/creationErrors.js';
import { hasKitMotion, kitPlacements, kitPrototype, modelKitId, readModelKitModules } from './modelKitMetadata.js';
import { metricUvGeometry } from './modelMetricUvs.js';

function placementVisible(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}
function assertTransform(object: THREE.Object3D): void {
  if (hasKitMotion(object)) throw new CreationUiError('kit-instance-animation');
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (node.scale.toArray().some(value => !Number.isFinite(value) || value <= 0)) throw new CreationUiError('kit-instance-transform');
  }
}

/** Rebuild GPU buckets once per atomic editor batch. Old buffers are never mutated, so history can restore them. */
export function refreshModelKit(root: THREE.Object3D): void {
  const modules = readModelKitModules(root), placements = kitPlacements(root);
  if (placements.length > VIBI3D_LIMITS.placements) throw new CreationUiError('kit-placement-limit');
  if (!modules.length && !placements.length) return;
  root.updateWorldMatrix(true, true);
  const rootInverse = root.matrixWorld.clone().invert(), next = new THREE.Group();
  next.uuid = creationIntentId('kit-render-buckets', modelKitId(root)); next.name = 'Kit instances';
  next.userData = { vibi3dId: next.uuid, vibi3dKitBucket: true };
  for (const placement of placements) {
    assertTransform(placement);
    const instance = placement.userData['vibi3dInstance'] as Vibi3DInstance;
    if (!modules.some(module => module.id === instance.moduleId)) throw new CreationUiError('kit-module-missing');
    instance.placementId = modelKitId(placement);
    if (instance.cell) {
      let parent = placement.parent; while (parent && !parent.userData['vibi3dArray']) parent = parent.parent;
      if (parent) instance.arrayId = modelKitId(parent);
    }
  }
  for (const module of modules) {
    const prototype = kitPrototype(root, module), all = placements.filter(node => node.userData['vibi3dInstance'].moduleId === module.id);
    root.traverse(node => { if (node.userData['vibi3dArray']?.moduleId === module.id) node.userData['vibi3dArray'].moduleRevision = module.revision; });
    for (const placement of all) (placement.userData['vibi3dInstance'] as Vibi3DInstance).moduleRevision = module.revision;
    const visible = all.filter(placementVisible); module.instances = all.length;
    if (!visible.length) continue;
    // Library coordinates include the prototype root's scale while excluding all scene/root transforms.
    const libraryInverse = prototype.parent!.matrixWorld.clone().invert();
    prototype.traverseVisible(part => {
      if (!(part instanceof THREE.Mesh)) return;
      const local = libraryInverse.clone().multiply(part.matrixWorld);
      // Artwork keeps normalized image UVs even when its physical sign/decal is placed through a kit.
      const metric = part.userData['vibi3dUvMode'] !== 'image'
        && (Array.isArray(part.material) ? part.material : [part.material]).some(material => material.userData['vibi3dMaterial']?.tileSize);
      const groups = new Map<string, { scale: THREE.Vector3; members: THREE.Object3D[]; shadows: Vibi3DNodeShadows }>();
      for (const placement of visible) {
        const scale = new THREE.Vector3().setFromMatrixScale(placement.matrixWorld.clone().multiply(local));
        const shadows = { ...part.userData['vibi3dShadows'], ...placement.userData['vibi3dShadows'] } as Vibi3DNodeShadows;
        const key = `${metric ? scale.toArray().map(value => Number(value.toPrecision(12))).join(',') : 'shared'}:${shadows.cast ?? 'auto'}:${shadows.receive ?? 'auto'}`;
        const group = groups.get(key) ?? { scale, members: [], shadows }; group.members.push(placement); groups.set(key, group);
      }
      for (const [key, group] of groups) {
      const geometry = metric ? metricUvGeometry(part.geometry, group.scale) : part.geometry;
      const bucket = new THREE.InstancedMesh(geometry, part.material, group.members.length);
      bucket.uuid = creationIntentId('kit-bucket', module.id, modelKitId(part), key); bucket.name = part.name;
      bucket.userData = { vibi3dId: bucket.uuid, vibi3dKitBucket: true, vibi3dKitModuleId: module.id, vibi3dKitPartId: modelKitId(part),
        vibi3dInstanceIds: group.members.map(modelKitId), vibi3dKitPartMatrix: local.toArray(), ...(Object.keys(group.shadows).length ? { vibi3dShadows: group.shadows } : {}) };
      group.members.forEach((placement, index) => bucket.setMatrixAt(index, rootInverse.clone().multiply(placement.matrixWorld).multiply(local)));
      bucket.instanceMatrix.needsUpdate = true; bucket.computeBoundingBox(); bucket.computeBoundingSphere(); next.add(bucket);
      }
    });
  }
  // Only publish the complete replacement after every module and transform succeeded.
  for (const prior of root.children.filter(node => node.userData['vibi3dKitBucket'])) root.remove(prior);
  if (next.children.length) root.add(next);
  root.userData['vibi3dKitModules'] = modules;
}

export { updateModelKitMatrices } from '../Creation/modelInstanceMatrices.js';
