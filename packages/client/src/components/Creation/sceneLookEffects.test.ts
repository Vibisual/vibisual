import * as THREE from 'three';
import type { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { describe, expect, it, vi } from 'vitest';
import { resolveVibi3DLook } from '@vibisual/shared';
import { releaseSceneEffects, renderSceneEffects } from './sceneLookEffects.js';
import { readStudioViewRaster } from './sceneLookRaster.js';

const mocks = vi.hoisted(() => ({ render: vi.fn(), passes: [] as Pass[] }));
vi.mock('three/examples/jsm/postprocessing/EffectComposer.js', () => ({ EffectComposer: class {
  renderTarget1: THREE.WebGLRenderTarget; renderTarget2: THREE.WebGLRenderTarget;
  constructor(_renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) {
    this.renderTarget1 = target; this.renderTarget2 = target.clone(); mocks.passes = [];
  }
  addPass(pass: Pass): void { mocks.passes.push(pass); }
  setPixelRatio(): void { /* Stub the WebGL host only; use the real pass instances below. */ }
  setSize(): void { /* No GPU allocation in node tests. */ }
  render(): void { mocks.render(); }
  dispose(): void { this.renderTarget1.dispose(); this.renderTarget2.dispose(); }
} }));

describe('scene effect failure boundary', () => {
  it('renders inspection finals at exact pixel size and keeps explicit draft scaling visible in metadata', () => {
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
    const renderer = { capabilities: { maxTextureSize: 8192, maxSamples: 4 },
      getDrawingBufferSize: (size: THREE.Vector2) => size.set(1080, 1920), getRenderTarget: () => null,
      getClearColor: (value: THREE.Color) => value, getClearAlpha: () => 0,
      setRenderTarget: vi.fn(), setClearColor: vi.fn(), autoClear: true,
      toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1,
    } as unknown as THREE.WebGLRenderer;
    mocks.render.mockImplementation(() => undefined);
    const look = resolveVibi3DLook({ preset: 'daylight' });
    renderSceneEffects(scene, renderer, camera, look, 'final', 'lit');
    expect(readStudioViewRaster(renderer)).toEqual({ width: 1080, height: 1920, samples: 4 });
    renderSceneEffects(scene, renderer, camera, look, 'draft', 'lit');
    expect(readStudioViewRaster(renderer)).toEqual({ width: 540, height: 960, samples: 0 });
    releaseSceneEffects(renderer);
  });
  it('restores geometry visibility, diagnostics and renderer state after a failed normal pass', () => {
    const scene = new THREE.Scene(), line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial()); scene.add(line);
    const override = new THREE.MeshStandardMaterial({ color: '#ffffff' }); scene.overrideMaterial = override;
    const originalTarget = new THREE.WebGLRenderTarget(2, 2), color = new THREE.Color('#334455');
    const renderer = { capabilities: { maxTextureSize: 8192, maxSamples: 4 },
      getDrawingBufferSize: (size: THREE.Vector2) => size.set(320, 180), getRenderTarget: () => originalTarget,
      getClearColor: (value: THREE.Color) => value.copy(color), getClearAlpha: () => 0,
      setRenderTarget: vi.fn(), setClearColor: vi.fn(), autoClear: true,
      toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.2,
    } as unknown as THREE.WebGLRenderer;
    mocks.render.mockImplementation(() => {
      // GTAOPass can throw between its visibility/override changes and its own cleanup.
      line.visible = false; scene.overrideMaterial = null; renderer.autoClear = false;
      throw new Error('normal-pass-failed');
    });
    expect(() => renderSceneEffects(scene, renderer, new THREE.PerspectiveCamera(), resolveVibi3DLook({ preset: 'daylight' }), 'final', 'ao'))
      .toThrow('normal-pass-failed');
    expect(line.visible).toBe(true); expect(scene.overrideMaterial).toBe(override); expect(renderer.autoClear).toBe(true);
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping); expect(renderer.toneMappingExposure).toBe(1.2);
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(originalTarget);
    expect(renderer.setClearColor).toHaveBeenLastCalledWith(color, 0);
    const bloom = mocks.passes.find(pass => pass instanceof UnrealBloomPass) as UnrealBloomPass;
    expect(bloom.blendMaterial.blendSrcAlpha).toBe(THREE.ZeroFactor);
    expect(bloom.blendMaterial.blendDstAlpha).toBe(THREE.OneFactor);
    releaseSceneEffects(renderer); originalTarget.dispose(); override.dispose(); line.geometry.dispose();
  });
});
