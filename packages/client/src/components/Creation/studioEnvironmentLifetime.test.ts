import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { releaseStudioEnvironment, studioEnvironment } from './studioLighting.js';
import { applySceneSky, releaseSceneSky } from './sceneLookEnvironment.js';
import { resolveVibi3DLook } from '@vibisual/shared';

const mocks = vi.hoisted(() => ({ fromScene: vi.fn(), dispose: vi.fn() }));
vi.mock('three', async importOriginal => ({ ...await importOriginal<typeof import('three')>(),
  PMREMGenerator: class { fromScene = mocks.fromScene; dispose = mocks.dispose; },
}));
beforeEach(() => { mocks.fromScene.mockReset(); mocks.dispose.mockClear(); });

describe('studio environment ownership', () => {
  it('uses the same calibrated sky for reflection and background, excluding horizon light below the ground', () => {
    const renderer = {} as THREE.WebGLRenderer, scene = new THREE.Scene(), target = new THREE.WebGLRenderTarget(16, 16);
    let baked: THREE.Object3D | undefined;
    mocks.fromScene.mockImplementationOnce((environment: THREE.Scene) => {
      baked = environment.children[0];
      const material = (baked as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>).material;
      expect(material.uniforms['showSunDisc']!.value).toBe(false);
      expect(material.uniforms['vibi3dSkyRadiance']!.value).toBe(0.2);
      expect(material.uniforms['vibi3dGroundRadiance']!.value).toBe(0.035);
      expect(material.uniforms['cloudCoverage']!.value).toBe(0);
      expect(material.fragmentShader).toContain('smoothstep(-0.08, 0.02, direction.y)');
      return target;
    });
    applySceneSky(scene, renderer, resolveVibi3DLook({ preset: 'daylight', intensity: 0.8 }), true);
    expect(scene.children).toContain(baked); expect(scene.environment).toBe(target.texture); expect(scene.environmentIntensity).toBe(0.8);
    releaseSceneSky(renderer);
  });
  it('releases the PMREM framebuffer target when a preview closes and creates a new target after context recovery', () => {
    const renderer = {} as THREE.WebGLRenderer;
    const first = new THREE.WebGLRenderTarget(16, 16), second = new THREE.WebGLRenderTarget(16, 16);
    const released = vi.fn(), nextReleased = vi.fn(); first.addEventListener('dispose', released); second.addEventListener('dispose', nextReleased);
    mocks.fromScene.mockReturnValueOnce(first).mockReturnValueOnce(second);
    expect(studioEnvironment(renderer)).toBe(first.texture); expect(studioEnvironment(renderer)).toBe(first.texture);
    expect(mocks.fromScene).toHaveBeenCalledTimes(1);
    releaseStudioEnvironment(renderer); releaseStudioEnvironment(renderer); expect(released).toHaveBeenCalledTimes(1);
    expect(studioEnvironment(renderer)).toBe(second.texture); releaseStudioEnvironment(renderer);
    expect(nextReleased).toHaveBeenCalledTimes(1); expect(mocks.dispose).toHaveBeenCalledTimes(2);
  });
  it.each(['studio', 'sky'])('restores the %s renderer after a failed environment render before falling back to direct light', kind => {
    const original = new THREE.WebGLRenderTarget(8, 8), interrupted = new THREE.WebGLRenderTarget(16, 16);
    let current = original;
    const renderer = { getRenderTarget: () => current, getActiveCubeFace: () => 2, getActiveMipmapLevel: () => 1,
      setRenderTarget: vi.fn((target: THREE.WebGLRenderTarget) => { current = target; }), xr: { enabled: true },
      toneMapping: THREE.ACESFilmicToneMapping, autoClear: true } as unknown as THREE.WebGLRenderer;
    mocks.fromScene.mockImplementationOnce(() => {
      current = interrupted; renderer.xr.enabled = false; renderer.toneMapping = THREE.NoToneMapping; renderer.autoClear = false;
      throw new Error('lost-context');
    });
    if (kind === 'studio') expect(studioEnvironment(renderer)).toBeNull();
    else {
      const scene = new THREE.Scene(); applySceneSky(scene, renderer, resolveVibi3DLook({ preset: 'daylight' }), true);
      expect(scene.environment).toBeNull();
      const sky = scene.children.find(child => child.userData['vibi3dLookHelper']) as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
      expect(sky.material.uniforms['showSunDisc']!.value).toBe(1);
    }
    expect(current).toBe(original); expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(original, 2, 1);
    expect(renderer.xr.enabled).toBe(true); expect(renderer.autoClear).toBe(true); expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    releaseSceneSky(renderer); releaseStudioEnvironment(renderer); original.dispose(); interrupted.dispose();
  });
});
