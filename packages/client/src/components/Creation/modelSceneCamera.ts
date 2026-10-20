import * as THREE from 'three';
import { resolveVibi3DCameraFov } from '@vibisual/shared';
import { CreationUiError } from './creationErrors.js';
import { readActiveModelShot, readModelCamera, readModelShots } from './modelCameraView.js';

export const MODEL_SCENE_DEFAULTS = { fov: 35, near: 0.001, far: 10000, distance: 2.4, yaw: 0.55, elevation: 0.28 } as const;
export interface ModelOutputOptions { cameraShot?: string; cameraMotion?: boolean; modelBackground?: 'preserve' | 'sky' }
const number = (value: unknown, fallback: number): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const vector = (value: unknown): THREE.Vector3 | null => Array.isArray(value) && value.length === 3 && value.every(v => typeof v === 'number' && Number.isFinite(v))
  ? new THREE.Vector3(value[0], value[1], value[2]) : null;

/** Still, timeline preview and final video use one shot-selection and optical contract. */
export function applyModelOutputCamera(
  camera: THREE.PerspectiveCamera, object: THREE.Object3D, source: THREE.PerspectiveCamera | undefined,
  center: THREE.Vector3, size: number, width: number, height: number, time: number, props: Readonly<Record<string, unknown>>,
): void {
  const explicit = typeof props['cameraShot'] === 'string' && props['cameraShot'].length > 0;
  const active = readActiveModelShot(object);
  const shot = explicit ? readModelShots(object).find(value => value.id === props['cameraShot']) : active;
  if (explicit && !shot) throw new CreationUiError('camera-shot-missing');
  const saved = shot ?? readModelCamera(object);
  const p = explicit ? {} : props;
  camera.aspect = width / Math.max(1, height);
  camera.fov = number(p['cameraFov'], resolveVibi3DCameraFov(saved ?? {}, camera.aspect, MODEL_SCENE_DEFAULTS.fov));
  camera.filmGauge = 35;
  camera.near = MODEL_SCENE_DEFAULTS.near; camera.far = MODEL_SCENE_DEFAULTS.far;
  const target = vector(p['cameraTarget']) ?? vector(saved?.target) ?? center;
  const position = vector(p['cameraPosition']) ?? vector(saved?.position);
  const orbit = ['cameraYaw', 'cameraOrbit', 'cameraDistance', 'cameraElevation'].some(key => p[key] !== undefined);
  if (position && !orbit) camera.position.copy(position);
  else {
    const yaw = number(p['cameraYaw'], MODEL_SCENE_DEFAULTS.yaw) + number(p['cameraOrbit'], 0) * time * Math.PI / 180;
    const elevation = number(p['cameraElevation'], MODEL_SCENE_DEFAULTS.elevation);
    const distance = size * number(p['cameraDistance'], MODEL_SCENE_DEFAULTS.distance) / Math.min(1, camera.aspect);
    camera.position.set(target.x + Math.sin(yaw) * distance, target.y + elevation * distance, target.z + Math.cos(yaw) * distance);
  }
  camera.lookAt(target);
  const manual = ['cameraFov', 'cameraPosition', 'cameraTarget', 'cameraYaw', 'cameraOrbit', 'cameraDistance', 'cameraElevation'].some(key => props[key] !== undefined);
  const animate = !explicit && (props['cameraMotion'] === true || (!active && !manual && props['cameraMotion'] !== false));
  if (source && animate) {
    object.updateWorldMatrix(true, true);
    source.getWorldPosition(camera.position); source.getWorldQuaternion(camera.quaternion);
    // A motion clip supplies the pose. Saved lens/FOV still belongs to the selected shot.
    if (saved?.lens === undefined && saved?.fov === undefined && p['cameraFov'] === undefined) camera.fov = source.fov;
    camera.near = source.near; camera.far = source.far;
  }
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
}
