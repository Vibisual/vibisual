import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { modelShadowSettings } from './modelShadows.js';

describe('model shadow settings', () => {
  it('defaults opaque meshes on, excludes glass, decals and emissive panels, and honors independent overrides', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshPhysicalMaterial());
    expect(modelShadowSettings(mesh)).toEqual({ cast: true, receive: true });
    mesh.material.transmission = 1;
    expect(modelShadowSettings(mesh)).toEqual({ cast: false, receive: false });
    mesh.userData['vibi3dShadows'] = { receive: true };
    expect(modelShadowSettings(mesh)).toEqual({ cast: false, receive: true });
    delete mesh.userData['vibi3dShadows']; mesh.material.transmission = 0; mesh.material.emissive.set('#ff0000');
    expect(modelShadowSettings(mesh).cast).toBe(false);
    mesh.material.emissive.set('#000000'); mesh.material.polygonOffset = true;
    expect(modelShadowSettings(mesh).cast).toBe(false);
    expect(mesh.castShadow).toBe(false); expect(mesh.receiveShadow).toBe(false);
    expect(mesh.userData).toEqual({});
  });
});
