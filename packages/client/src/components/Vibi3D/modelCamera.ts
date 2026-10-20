import * as THREE from 'three';
import { validateVibi3DCameraView, validateVibi3DShots, type Vibi3DCameraView, type Vibi3DAuthoringCommand } from '@vibisual/shared';
import { readModelCamera, readModelShots, applyModelCameraView } from '../Creation/modelCameraView.js';
export { readModelCamera, readModelShots, readActiveModelShot, modelCameraAspect, applyModelCameraView } from '../Creation/modelCameraView.js';
import { CreationUiError } from '../Creation/creationErrors.js';

export const CAMERA_CLIP_PREFIX = 'Vibi3D:camera:';
export function viewCamera(root: THREE.Object3D, create: boolean): THREE.PerspectiveCamera | undefined {
  let camera: THREE.PerspectiveCamera | undefined;
  root.traverse(child => { if (!camera && child instanceof THREE.PerspectiveCamera && child.userData['vibi3dViewCamera']) camera = child; });
  if (!camera && create) {
    camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000); camera.name = 'Camera'; camera.userData['vibi3dViewCamera'] = true; root.add(camera);
  }
  return camera;
}
function currentView(root: THREE.Object3D): Vibi3DCameraView {
  const saved = readModelCamera(root); if (saved) return saved;
  const camera = viewCamera(root, false);
  if (!camera) return { position: [2.5, 2, 3.5], target: [0, 0, 0] };
  const target = camera.position.clone().add(new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion));
  return { position: camera.position.toArray(), target: target.toArray(), fov: camera.getEffectiveFOV() };
}
export function applyModelCameraCommand(root: THREE.Object3D, command: Extract<Vibi3DAuthoringCommand, { type: 'camera' | 'shotRemove' }>): void {
  const shots = readModelShots(root);
  if (command.type === 'shotRemove') {
    if (!shots.some(shot => shot.id === command.id)) throw new CreationUiError('camera-shot-missing');
    root.userData['vibi3dShots'] = shots.filter(shot => shot.id !== command.id);
    if (root.userData['vibi3dActiveShotId'] === command.id) delete root.userData['vibi3dActiveShotId']; return;
  }
  const shot = command.shot ? shots.find(value => value.id === command.shot!.id) : undefined;
  const { type: _type, shot: _shot, eyeHeight, ...patch } = command;
  const base = shot ? { position: shot.position, target: shot.target, ...(shot.lens !== undefined ? { lens: shot.lens } : {}), ...(shot.fov !== undefined ? { fov: shot.fov } : {}), ...(shot.aspect ? { aspect: shot.aspect } : {}) } : currentView(root);
  const next = { ...base, ...patch };
  if (patch.lens !== undefined) delete next.fov; else if (patch.fov !== undefined) delete next.lens;
  if (eyeHeight !== undefined) next.position = [next.position[0], eyeHeight, next.position[2]];
  const valid = validateVibi3DCameraView(next); if (!valid) throw new CreationUiError('invalid-command');
  if (command.shot) {
    // A named still must retain its lens even if it was saved from a legacy position-only view.
    if (valid.lens === undefined && valid.fov === undefined) valid.fov = viewCamera(root, false)?.getEffectiveFOV() ?? 45;
    const replacement = { ...valid, ...command.shot }, candidates = shot ? shots.map(value => value.id === shot.id ? replacement : value) : [...shots, replacement];
    if (!validateVibi3DShots(candidates)) throw new CreationUiError('camera-shot-conflict');
    root.userData['vibi3dShots'] = candidates; root.userData['vibi3dActiveShotId'] = command.shot.id;
  } else delete root.userData['vibi3dActiveShotId'];
  root.userData['vibi3dCamera'] = valid; applyModelCameraView(viewCamera(root, true)!, valid);
}
/** A motion changes pose only. Explicitly authoring one reactivates motion without deleting saved still shots. */
export function applyModelCameraMotionStart(root: THREE.Object3D, position: Vibi3DCameraView['position'], target: Vibi3DCameraView['target']): void {
  const view = { ...currentView(root), position: [...position], target: [...target] };
  root.userData['vibi3dCamera'] = view; delete root.userData['vibi3dActiveShotId']; applyModelCameraView(viewCamera(root, true)!, view);
}
