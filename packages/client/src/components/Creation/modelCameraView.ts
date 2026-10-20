import * as THREE from 'three';
import { validateVibi3DCameraView, validateVibi3DShot, validateVibi3DShots, resolveVibi3DCameraFov, vibi3DCameraAspectRatio, type Vibi3DCameraView, type Vibi3DShot } from '@vibisual/shared';
import { CreationUiError } from './creationErrors.js';

export function readModelCamera(root: THREE.Object3D): Vibi3DCameraView | undefined { return validateVibi3DCameraView(root.userData['vibi3dCamera']) ?? undefined; }
export function readModelShots(root: THREE.Object3D): Vibi3DShot[] {
  const value = root.userData['vibi3dShots']; if (value === undefined) return [];
  const result = validateVibi3DShots(value); if (!result) throw new CreationUiError('invalid-model-source'); return result;
}
export function readActiveModelShot(root: THREE.Object3D): Vibi3DShot | undefined {
  const id = root.userData['vibi3dActiveShotId']; return typeof id === 'string' ? readModelShots(root).find(shot => shot.id === id) : undefined;
}
export function modelCameraAspect(aspect: Vibi3DCameraView['aspect'], fallback = 1): number {
  return vibi3DCameraAspectRatio(aspect, fallback);
}
/** Output dimensions override the saved framing ratio. Lens conversion always uses that final aspect first. */
export function applyModelCameraView(camera: THREE.PerspectiveCamera, input: unknown, options: { aspect?: number; target?: THREE.Vector3 } = {}): boolean {
  const view = validateVibi3DCameraView(input) ?? validateVibi3DShot(input); if (!view) return false;
  camera.aspect = options.aspect ?? modelCameraAspect(view.aspect, camera.aspect);
  camera.fov = resolveVibi3DCameraFov(view, camera.aspect, camera.fov);
  if (view.lens !== undefined || view.fov !== undefined) { camera.zoom = 1; camera.clearViewOffset(); }
  if (view.lens !== undefined) camera.filmGauge = 35;
  camera.position.fromArray(view.position); const target = new THREE.Vector3().fromArray(view.target);
  options.target?.copy(target); camera.lookAt(target); camera.updateProjectionMatrix(); camera.updateMatrix(); camera.updateMatrixWorld(); return true;
}
