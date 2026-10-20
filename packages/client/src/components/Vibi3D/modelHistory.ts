import * as THREE from 'three';
import { objectMaterials } from './modelAuthoring.js';

interface ObjectState {
  object: THREE.Object3D; parent: THREE.Object3D | null; children: THREE.Object3D[];
  position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3;
  userData: Record<string, unknown>; geometry?: THREE.BufferGeometry;
  materials: Array<{ target: THREE.Material; state: THREE.Material }>;
  materialSlots?: THREE.Material | THREE.Material[];
  visible: boolean;
  name: string;
  light?: { color: THREE.Color; intensity: number };
  instances?: { count: number; matrix: THREE.InstancedBufferAttribute; color: THREE.InstancedBufferAttribute | null };
  camera?: Pick<THREE.PerspectiveCamera, 'fov' | 'aspect' | 'zoom' | 'near' | 'far' | 'focus' | 'filmGauge' | 'filmOffset' | 'view'>;
}
export interface ModelState { objects: ObjectState[]; clips: THREE.AnimationClip[]; }
function cloneInstances(attribute: THREE.InstancedBufferAttribute): THREE.InstancedBufferAttribute {
  return new THREE.InstancedBufferAttribute(attribute.array.slice(), attribute.itemSize, attribute.normalized, attribute.meshPerAttribute)
    .copy(attribute).setUsage(attribute.usage);
}
function restoreInstances(current: THREE.InstancedBufferAttribute | null, saved: THREE.InstancedBufferAttribute): THREE.InstancedBufferAttribute {
  // Reuse the live GPU attribute when capacity matches; undo must not allocate another WebGL buffer every time.
  if (!current || current.array.constructor !== saved.array.constructor || current.array.length !== saved.array.length) return cloneInstances(saved);
  current.array.set(saved.array); current.itemSize = saved.itemSize; current.normalized = saved.normalized;
  current.meshPerAttribute = saved.meshPerAttribute; current.setUsage(saved.usage);
  return current;
}
/** Retain the real objects/rig bindings; a transform undo must not replace an imported skeleton. */
export function captureModel(root: THREE.Object3D, clips: THREE.AnimationClip[]): ModelState {
  const objects: ObjectState[] = [];
  root.traverse((object) => objects.push({ object, parent: object.parent, children: [...object.children],
    position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone(),
    userData: structuredClone(object.userData), geometry: (object as THREE.Mesh).geometry,
    visible: object.visible, name: object.name,
    ...(object instanceof THREE.Light ? { light: { color: object.color.clone(), intensity: object.intensity } } : {}),
    ...(object instanceof THREE.PerspectiveCamera ? { camera: { fov: object.fov, aspect: object.aspect, zoom: object.zoom, near: object.near, far: object.far,
      focus: object.focus, filmGauge: object.filmGauge, filmOffset: object.filmOffset, view: object.view ? { ...object.view } : null } } : {}),
    ...(object instanceof THREE.InstancedMesh ? { instances: { count: object.count, matrix: cloneInstances(object.instanceMatrix), color: object.instanceColor ? cloneInstances(object.instanceColor) : null } } : {}),
    materials: objectMaterials(object).map((target) => ({ target, state: target.clone() })),
    ...((object as THREE.Mesh).material ? { materialSlots: Array.isArray((object as THREE.Mesh).material) ? [...(object as THREE.Mesh).material as THREE.Material[]] : (object as THREE.Mesh).material } : {}),
  }));
  return { objects, clips: [...clips] };
}
export function restoreModel(state: ModelState, clips: THREE.AnimationClip[]): void {
  for (const entry of state.objects) {
    entry.object.clear(); entry.object.position.copy(entry.position); entry.object.quaternion.copy(entry.quaternion); entry.object.scale.copy(entry.scale);
    entry.object.userData = structuredClone(entry.userData);
    entry.object.visible = entry.visible;
    entry.object.name = entry.name;
    if (entry.light && entry.object instanceof THREE.Light) { entry.object.color.copy(entry.light.color); entry.object.intensity = entry.light.intensity; }
    if (entry.camera && entry.object instanceof THREE.PerspectiveCamera) { Object.assign(entry.object, structuredClone(entry.camera)); entry.object.updateProjectionMatrix(); }
    if (entry.geometry) (entry.object as THREE.Mesh).geometry = entry.geometry;
    if (entry.materialSlots) (entry.object as THREE.Mesh).material = Array.isArray(entry.materialSlots) ? [...entry.materialSlots] : entry.materialSlots;
    for (const material of entry.materials) material.target.copy(material.state);
    if (entry.instances && entry.object instanceof THREE.InstancedMesh) {
      entry.object.count = entry.instances.count;
      entry.object.instanceMatrix = restoreInstances(entry.object.instanceMatrix, entry.instances.matrix); entry.object.instanceMatrix.needsUpdate = true;
      entry.object.instanceColor = entry.instances.color ? restoreInstances(entry.object.instanceColor, entry.instances.color) : null;
      if (entry.object.instanceColor) entry.object.instanceColor.needsUpdate = true;
      entry.object.computeBoundingBox(); entry.object.computeBoundingSphere();
    }
    entry.object.updateMatrix();
  }
  for (const entry of state.objects) for (const child of entry.children) entry.object.add(child);
  clips.splice(0, clips.length, ...state.clips);
  state.objects[0]?.object.updateMatrixWorld(true);
}
