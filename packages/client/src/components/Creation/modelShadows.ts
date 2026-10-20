import * as THREE from 'three';

/** Shared by the look renderer and inspector; reading settings never changes serialized meshes. */
export function modelShadowSettings(object: THREE.Object3D): { cast: boolean; receive: boolean } {
  const mesh = object as THREE.Mesh;
  const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
  const excludes = materials.some((material) => {
    const surface = material as THREE.MeshPhysicalMaterial;
    return material.transparent || material.opacity < 1 || material.polygonOffset
      || surface.transmission > 0
      || (surface.emissive instanceof THREE.Color && surface.emissive.getHex() !== 0 && surface.emissiveIntensity > 0);
  }) || object.userData['vibi3dDecal'] !== undefined;
  const stored: unknown = object.userData['vibi3dShadows'];
  const flags = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored as Record<string, unknown> : {};
  return { cast: typeof flags['cast'] === 'boolean' ? flags['cast'] : !excludes,
    receive: typeof flags['receive'] === 'boolean' ? flags['receive'] : !excludes };
}
