import * as THREE from 'three';
import { visibleModelBounds } from './modelBounds.js';

/** Editor and canvas faces share the same stage; only their drawing resolution differs. */
export const MODEL_BACKGROUNDS = { dark: 0x0b0d12, light: 0x9aa3b2 } as const;
export const MODEL_VIEW_FOV = 45;
export const MODEL_FRAME_MARGIN = 1.6;

export function createModelGrid(): THREE.GridHelper {
  return new THREE.GridHelper(10, 20, 0x475569, 0x1f2937);
}

export function modelFrame(object: THREE.Object3D): { center: THREE.Vector3; radius: number; empty: boolean } {
  const bounds = visibleModelBounds(object);
  const extent = bounds.getSize(new THREE.Vector3());
  return { center: bounds.getCenter(new THREE.Vector3()), radius: Math.max(extent.x, extent.y, extent.z) * 0.5 || 1, empty: bounds.isEmpty() };
}

export function frameModelCamera(camera: THREE.PerspectiveCamera, center: THREE.Vector3, radius: number): void {
  const distance = radius / Math.sin(camera.fov * Math.PI / 360) * Math.max(1, 1 / camera.aspect);
  camera.position.copy(center).add(new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(distance * MODEL_FRAME_MARGIN));
  camera.near = Math.max(0.001, distance / 500);
  camera.far = Math.max(100, distance * 50);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}
