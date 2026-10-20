import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderStudioView, releaseSceneLook } from './sceneLook.js';
import { sceneLookQuality } from './sceneLookQuality.js';

const mocks = vi.hoisted(() => ({ effects: vi.fn(), sky: vi.fn(), hide: vi.fn() }));
vi.mock('./sceneLookEffects.js', () => ({ renderSceneEffects: mocks.effects, releaseSceneEffects: vi.fn() }));
vi.mock('./sceneLookEnvironment.js', () => ({
  applySceneSky: mocks.sky, hideSceneSky: mocks.hide, releaseSceneSky: vi.fn(),
  sceneSunDirection: () => new THREE.Vector3(1, 2, 1).normalize(),
}));
vi.mock('./studioLighting.js', () => ({
  STUDIO_LIGHT: { ambient: 1.1, key: 1.4, environment: 1, keyPosition: [3, 5, 4] }, studioEnvironment: () => null,
}));

function fixture() {
  const scene = new THREE.Scene(), object = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 15, 10), new THREE.MeshStandardMaterial()); object.add(mesh);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshPhysicalMaterial({ transmission: 1 })); object.add(glass);
  const ambient = new THREE.HemisphereLight(0xffffff, 0x334155, 1.1), key = new THREE.DirectionalLight(0xffffff, 1.4);
  ambient.userData['vibi3dStudioLight'] = 'ambient'; key.userData['vibi3dStudioLight'] = 'key';
  scene.add(object, ambient, key);
  const renderer = { isWebGLRenderer: true, toneMapping: THREE.NoToneMapping, toneMappingExposure: 1,
    shadowMap: { enabled: false, type: THREE.BasicShadowMap }, render: vi.fn(), outputColorSpace: THREE.SRGBColorSpace,
    capabilities: { maxTextureSize: 4096, maxSamples: 4 },
  } as unknown as THREE.WebGLRenderer;
  return { scene, object, mesh, glass, ambient, key, renderer, camera: new THREE.PerspectiveCamera() };
}
beforeEach(() => { vi.clearAllMocks(); mocks.effects.mockReset(); });

describe('common scene look draw boundary', () => {
  it('leaves legacy serialized objects and preconfigured video light levels unchanged', () => {
    const f = fixture(); f.ambient.intensity = 2.7; f.key.intensity = 4.1;
    const source = JSON.stringify(f.object.toJSON());
    renderStudioView(f.scene, f.renderer, f.camera, { object: f.object });
    expect(JSON.stringify(f.object.toJSON())).toBe(source);
    expect(f.ambient.intensity).toBe(2.7); expect(f.key.intensity).toBe(4.1);
    expect(f.renderer.render).toHaveBeenCalledWith(f.scene, f.camera); expect(mocks.effects).not.toHaveBeenCalled();
  });

  it('uses shared daylight values and transient material-aware shadows without changing source JSON', () => {
    const f = fixture(); f.object.userData['vibi3dLook'] = { preset: 'daylight' };
    const source = JSON.stringify(f.object.toJSON());
    mocks.effects.mockImplementation(() => {
      expect(f.mesh.castShadow).toBe(true); expect(f.mesh.receiveShadow).toBe(true);
      expect(f.glass.castShadow).toBe(false); expect(f.key.shadow.camera.far).toBeGreaterThan(15);
    });
    renderStudioView(f.scene, f.renderer, f.camera, { object: f.object });
    expect(f.renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(f.key.intensity).toBe(3); expect(f.scene.fog).toBeInstanceOf(THREE.FogExp2);
    expect(JSON.stringify(f.object.toJSON())).toBe(source);
    expect(mocks.sky).toHaveBeenCalledWith(f.scene, f.renderer, expect.objectContaining({ preset: 'daylight' }), true);
    releaseSceneLook(f.renderer);
  });

  it('restores the original rendering policy but preserves a newly selected background after returning to legacy', () => {
    const f = fixture(); f.object.userData['vibi3dLook'] = { preset: 'daylight', exposure: 2 };
    renderStudioView(f.scene, f.renderer, f.camera, { object: f.object });
    delete f.object.userData['vibi3dLook']; f.ambient.intensity = 3; f.key.intensity = 4;
    const background = new THREE.Color('#335577'); f.scene.background = background;
    renderStudioView(f.scene, f.renderer, f.camera, { object: f.object });
    expect(f.scene.background).toBe(background); expect(f.scene.fog).toBeNull();
    expect(f.renderer.toneMapping).toBe(THREE.NoToneMapping); expect(f.renderer.toneMappingExposure).toBe(1);
    expect(f.renderer.shadowMap).toMatchObject({ enabled: false, type: THREE.BasicShadowMap });
    expect(f.ambient.intensity).toBe(3); expect(f.key.intensity).toBe(4);
    releaseSceneLook(f.renderer);
  });

  it('restores node shadow flags even if a render pass fails', () => {
    const f = fixture(); f.object.userData['vibi3dLook'] = { preset: 'daylight' };
    mocks.effects.mockImplementation(() => { throw new Error('lost-context'); });
    expect(() => renderStudioView(f.scene, f.renderer, f.camera, { object: f.object })).toThrow('lost-context');
    expect(f.mesh.castShadow).toBe(false); expect(f.mesh.receiveShadow).toBe(false);
    releaseSceneLook(f.renderer);
  });

  it('uses one sky fill instead of adding a second unshadowed hemisphere, with a fallback when PMREM fails', () => {
    const f = fixture(); f.object.userData['vibi3dLook'] = { preset: 'daylight', intensity: 0.8, sun: { intensity: 1.5 }, exposure: 0.65 };
    f.scene.environment = new THREE.Texture();
    renderStudioView(f.scene, f.renderer, f.camera, { object: f.object });
    expect(f.ambient.intensity).toBe(0); expect(f.key.intensity).toBeCloseTo(1.2); expect(f.renderer.toneMappingExposure).toBe(0.65);
    f.scene.environment = null;
    renderStudioView(f.scene, f.renderer, f.camera, { object: f.object });
    expect(f.ambient.intensity).toBeCloseTo(0.144); releaseSceneLook(f.renderer);
  });

  it('changes only raster scale/samples for weaker GPUs and preserves final output resolution', () => {
    expect(sceneLookQuality('auto', { maxTextureSize: 2048, maxSamples: 1 })).toEqual({ scale: 0.5, samples: 1 });
    expect(sceneLookQuality('auto', { maxTextureSize: 4096, maxSamples: 4 })).toEqual({ scale: 0.75, samples: 2 });
    expect(sceneLookQuality('final', { maxTextureSize: 4096, maxSamples: 4 })).toEqual({ scale: 1, samples: 4 });
  });
});
