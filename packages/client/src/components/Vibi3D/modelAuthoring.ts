import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  validateVibi3DMotionKeys, type Vibi3DAuthoringCommand, type Vibi3DCameraKey,
  type Vibi3DMotionKey, type Vibi3DVec3,
} from '@vibisual/shared';
import { CreationUiError } from '../Creation/creationErrors.js';
import { applyModelMaterial, createModelMaterial, type ModelMaterialTextures } from './modelMaterials.js';
import { refreshModelMetricUvs } from './modelMetricUvs.js';
import { makeGeometry } from './modelGeometry.js';
import { newIds, splitsRig } from './modelStructure.js';
import { LIGHT_CLASSES, lightKind } from './modelLights.js';
export { lightKind, readLight } from './modelLights.js';
export { splitsRig } from './modelStructure.js';
import { CAMERA_CLIP_PREFIX, viewCamera, applyModelCameraCommand, applyModelCameraMotionStart } from './modelCamera.js';
export { makeGeometry } from './modelGeometry.js';
export { CAMERA_CLIP_PREFIX, viewCamera } from './modelCamera.js';
export function objectMaterials(object: THREE.Object3D): THREE.Material[] {
  const material = (object as THREE.Mesh).material;
  return Array.isArray(material) ? material : material ? [material] : [];
}
export { readModelMaterial as readMaterial } from './modelMaterials.js';

/** Named motions of an object (`vibi3dMotions`), including the single motion older sources stored. */
export function readMotions(object: THREE.Object3D): { name: string; keys: Vibi3DMotionKey[] }[] {
  const stored: unknown = object.userData['vibi3dMotions'];
  const map: Record<string, unknown> = stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...(stored as Record<string, unknown>) } : {};
  const legacy = object.userData['vibi3dMotion'] as { name?: unknown; keys?: unknown } | undefined;
  if (legacy && typeof legacy.name === 'string' && !(legacy.name in map)) map[legacy.name] = legacy.keys;
  return Object.entries(map).flatMap(([name, keys]) => {
    const valid = validateVibi3DMotionKeys(keys);
    return valid ? [{ name, keys: valid }] : [];
  });
}
const motionClipName = (id: string, name: string): string => `Vibi3D:${id}:${name}`;
function removeClip(clips: THREE.AnimationClip[], name: string): void {
  const index = clips.findIndex((clip) => clip.name === name);
  if (index >= 0) clips.splice(index, 1);
}
function motionTracks(object: THREE.Object3D, keys: Vibi3DMotionKey[]): THREE.KeyframeTrack[] {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const property of ['position', 'rotation', 'scale'] as const) {
    const usable = keys.filter((key) => key[property]);
    if (usable.length < 2) continue;
    const times = usable.map((key) => key.time);
    if (property === 'rotation') {
      const values = usable.flatMap((key) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...key.rotation!.map(THREE.MathUtils.degToRad) as Vibi3DVec3, 'XYZ')).toArray());
      tracks.push(new THREE.QuaternionKeyframeTrack(`${object.uuid}.quaternion`, times, values));
    } else tracks.push(new THREE.VectorKeyframeTrack(`${object.uuid}.${property}`, times, usable.flatMap((key) => key[property]!)));
  }
  if (!tracks.length) throw new CreationUiError('motion-needs-keys');
  return tracks;
}
function cameraTracks(camera: THREE.PerspectiveCamera, keys: Vibi3DCameraKey[]): THREE.KeyframeTrack[] {
  // A camera looks down -Z: orient a scratch camera the same way so the stored rotation matches lookAt.
  const probe = new THREE.PerspectiveCamera();
  const rotations = keys.flatMap((key) => {
    probe.position.fromArray(key.position); probe.lookAt(new THREE.Vector3(...key.target));
    return probe.quaternion.toArray();
  });
  const times = keys.map((key) => key.time);
  return [
    new THREE.VectorKeyframeTrack(`${camera.uuid}.position`, times, keys.flatMap((key) => key.position)),
    new THREE.QuaternionKeyframeTrack(`${camera.uuid}.quaternion`, times, rotations),
  ];
}

export function applyAuthoring(root: THREE.Object3D, clips: THREE.AnimationClip[], command: Vibi3DAuthoringCommand, find: (id: string) => THREE.Object3D, textures: ModelMaterialTextures = {}): void {
  if (command.type === 'create') {
    const material = createModelMaterial(command.material, textures);
    const mesh = new THREE.Mesh(makeGeometry(command.recipe), material);
    mesh.name = command.name; mesh.userData['vibi3dRecipe'] = structuredClone(command.recipe);
    mesh.userData['vibi3dId'] = command.id ?? THREE.MathUtils.generateUUID();
    if (command.position) mesh.position.fromArray(command.position);
    (command.parentId ? find(command.parentId) : root).add(mesh); refreshModelMetricUvs(mesh); return;
  }
  if (command.type === 'camera' || command.type === 'shotRemove') { applyModelCameraCommand(root, command); return; }
  if (command.type === 'cameraMotion') {
    const camera = viewCamera(root, true)!;
    for (const clip of clips.filter((item) => item.name.startsWith(CAMERA_CLIP_PREFIX))) removeClip(clips, clip.name);
    clips.push(new THREE.AnimationClip(`${CAMERA_CLIP_PREFIX}${command.name}`, -1, cameraTracks(camera, command.keys)));
    const first = command.keys[0]!;
    applyModelCameraMotionStart(root, first.position, first.target);
    root.userData['vibi3dCameraMotion'] = structuredClone({ name: command.name, keys: command.keys });
    return;
  }
  if (command.type === 'light') {
    const existing = command.id ? (() => { try { return find(command.id!); } catch { return undefined; } })() : undefined;
    if (existing && !lightKind(existing)) throw new CreationUiError('object-id-exists');
    let light = existing as THREE.Light | undefined;
    if (!light || (command.kind && command.kind !== lightKind(light))) {
      const next = LIGHT_CLASSES[command.kind ?? 'point']();
      next.name = command.name ?? light?.name ?? 'Light';
      next.userData['vibi3dId'] = command.id ?? light?.userData['vibi3dId'] ?? THREE.MathUtils.generateUUID();
      next.userData['vibi3dLight'] = true;
      // A new kind keeps where the light was and how it looked; only what the command names changes.
      if (light) {
        next.position.copy(light.position); next.color.copy(light.color); next.intensity = light.intensity;
        (light.parent ?? root).add(next); light.removeFromParent();
      } else { next.position.set(2, 3, 2); root.add(next); }
      light = next;
    }
    if (command.name) light.name = command.name;
    if (command.position) light.position.fromArray(command.position);
    if (command.intensity !== undefined) light.intensity = command.intensity;
    if (command.color) light.color.set(command.color);
    return;
  }
  if (command.type === 'group') {
    const objects = [...new Set(command.ids)].map(find);
    if (objects.includes(root)) throw new CreationUiError('root-not-groupable');
    if (objects.some((object) => splitsRig(root, object))) throw new CreationUiError('rig-structure-protected');
    const group = new THREE.Group(); group.name = command.name; root.add(group); root.updateMatrixWorld(true);
    // Never group a parent and child twice. Preserve world-space transforms.
    for (const object of objects) {
      let ancestor = object.parent; let nested = false;
      while (ancestor && ancestor !== root) { if (objects.includes(ancestor)) nested = true; ancestor = ancestor.parent; }
      if (!nested) group.attach(object);
    }
    return;
  }
  const object = find(command.id);
  if (command.type === 'protect') { object.userData['vibi3dLocked'] = command.locked; return; }
  if (command.type === 'material') { applyModelMaterial(object, command.material, textures); return; }
  if (command.type === 'geometry') {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh || object.morphTargetInfluences?.length) throw new CreationUiError('rig-geometry-protected');
    // The editor releases the old buffers once the batch succeeds (the undo history keeps the data).
    object.geometry = makeGeometry(command.recipe); object.userData['vibi3dRecipe'] = structuredClone(command.recipe);
    refreshModelMetricUvs(object);
    return;
  }
  if (command.type === 'delete') {
    if (object === root) throw new CreationUiError('root-not-deletable');
    if (splitsRig(root, object)) throw new CreationUiError('rig-structure-protected');
    object.removeFromParent();
    return;
  }
  if (command.type === 'duplicate') {
    if (object === root) throw new CreationUiError('select-child');
    const originals: THREE.Object3D[] = [];
    object.traverse((child) => originals.push(child));
    // Tracks bind by uuid (authored) or by node name (imported files): both point at the copy's own nodes.
    const names = new Map<string, number>();
    originals.forEach((child) => { if (child.name) names.set(child.name, (names.get(child.name) ?? 0) + 1); });
    for (let n = 1; n <= (command.count ?? 1); n++) {
      const copy = clone(object); newIds(copy); copy.name = `${object.name} ${n + 1}`;
      copy.position.add(new THREE.Vector3(...(command.offset ?? [1.2, 0, 0])).multiplyScalar(n)); object.parent!.add(copy);
      const copies: THREE.Object3D[] = [];
      copy.traverse((child) => copies.push(child));
      const mapping = new Map<string, string>();
      originals.forEach((child, i) => {
        mapping.set(child.uuid, copies[i]!.uuid);
        if (child.name && names.get(child.name) === 1) mapping.set(child.name, copies[i]!.uuid);
      });
      for (const clip of [...clips]) {
        const tracks = clip.tracks.flatMap((track) => {
          const dot = track.name.indexOf('.');
          const target = dot < 0 ? track.name : track.name.slice(0, dot);
          const id = mapping.get(target);
          if (!id) return [];
          const next = track.clone(); next.name = id + track.name.slice(target.length); return [next];
        });
        if (tracks.length) clips.push(new THREE.AnimationClip(`${clip.name} ${n + 1}`, clip.duration, tracks));
      }
    }
    return;
  }
  if (command.type === 'motionRemove') {
    removeClip(clips, motionClipName(command.id, command.name));
    const motions = Object.fromEntries(readMotions(object).filter((motion) => motion.name !== command.name).map((motion) => [motion.name, motion.keys]));
    object.userData['vibi3dMotions'] = motions;
    delete object.userData['vibi3dMotion'];
    return;
  }
  if (command.type === 'motion') {
    const clip = new THREE.AnimationClip(motionClipName(command.id, command.name), -1, motionTracks(object, command.keys));
    if (command.previousName && command.previousName !== command.name) removeClip(clips, motionClipName(command.id, command.previousName));
    removeClip(clips, clip.name);
    clips.push(clip);
    const motions = Object.fromEntries(readMotions(object).filter((motion) => motion.name !== command.previousName).map((motion) => [motion.name, motion.keys]));
    motions[command.name] = structuredClone(command.keys);
    object.userData['vibi3dMotions'] = motions;
    delete object.userData['vibi3dMotion'];
  }
}
