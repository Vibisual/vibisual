import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { SceneAmbientOcclusionPass } from './sceneLookAmbientOcclusion.js';

describe('AO respects physical glass and alpha surfaces', () => {
  it.each([false, true])('keeps beauty materials and restores visibility after the AO pass (throws=%s)', fails => {
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshPhysicalMaterial({ transmission: 1 }));
    const sticker = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial({ alphaTest: 0.5 }));
    const sky = new THREE.Mesh(); sky.userData['vibi3dLookHelper'] = true;
    const hidden = glass.clone(); hidden.visible = false; scene.add(wall, glass, sticker, sky, hidden);
    const clay = new THREE.MeshStandardMaterial(); scene.overrideMaterial = clay;
    const source = JSON.stringify(scene.toJSON());
    const draw = vi.spyOn(GTAOPass.prototype, 'render').mockImplementation(() => {
      expect(wall.visible).toBe(true); expect(glass.visible).toBe(false); expect(sticker.visible).toBe(false);
      expect(sky.visible).toBe(false); expect(hidden.visible).toBe(false);
      scene.overrideMaterial = null;
      if (fails) throw new Error('normal-draw-failed');
    });
    const pass = new SceneAmbientOcclusionPass(scene, camera, 16, 16), target = new THREE.WebGLRenderTarget(16, 16);
    try {
      const run = () => pass.render({} as THREE.WebGLRenderer, target, target, 0, false);
      if (fails) expect(run).toThrow('normal-draw-failed'); else run();
      expect(JSON.stringify(scene.toJSON())).toBe(source); expect(scene.overrideMaterial).toBe(clay);
      expect(glass.material.transmission).toBe(1); expect(glass.visible).toBe(true); expect(hidden.visible).toBe(false);
    } finally { draw.mockRestore(); pass.dispose(); target.dispose(); }
  });
});
