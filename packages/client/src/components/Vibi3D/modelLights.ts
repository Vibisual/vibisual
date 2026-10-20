import * as THREE from 'three';
import type { Vibi3DLight, Vibi3DLightKind } from '@vibisual/shared';

export const LIGHT_CLASSES: Readonly<Record<Vibi3DLightKind, () => THREE.Light>> = {
  directional: () => new THREE.DirectionalLight(0xffffff, 1.5),
  point: () => new THREE.PointLight(0xffffff, 10, 0, 2),
  spot: () => new THREE.SpotLight(0xffffff, 10, 0, Math.PI / 6, 0.3, 2),
  hemisphere: () => new THREE.HemisphereLight(0xffffff, 0x334155, 1),
  ambient: () => new THREE.AmbientLight(0xffffff, 0.5),
};
export function lightKind(object: THREE.Object3D): Vibi3DLightKind | null {
  if (object instanceof THREE.DirectionalLight) return 'directional';
  if (object instanceof THREE.SpotLight) return 'spot';
  if (object instanceof THREE.PointLight) return 'point';
  if (object instanceof THREE.HemisphereLight) return 'hemisphere';
  if (object instanceof THREE.AmbientLight) return 'ambient';
  return null;
}
export function readLight(object: THREE.Object3D): Vibi3DLight | undefined {
  const kind = lightKind(object);
  if (!kind) return undefined;
  const light = object as THREE.Light;
  return { kind, intensity: light.intensity, color: `#${light.color.getHexString()}` };
}
