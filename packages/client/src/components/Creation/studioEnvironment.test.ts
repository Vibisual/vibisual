import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { STUDIO_LIGHT, applyStudioEnvironment, releaseStudioEnvironment, studioEnvironment } from './studioLighting.js';

/**
 * §5.13 (R-10) item 11 — metals reflect the studio room: every view's scene gets the prefiltered RoomEnvironment
 * (without it a 0.9-metalness gold renders as dark brown). PMREM needs WebGL, so it is replaced by a recorder here.
 */
const pmrem = vi.hoisted(() => ({ made: 0, texture: null as unknown, target: null as unknown }));
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class RecordingPMREM {
    constructor(_renderer: unknown) { pmrem.made += 1; }
    fromScene(): InstanceType<typeof actual.WebGLRenderTarget> {
      const target = new actual.WebGLRenderTarget(16, 16); pmrem.target = target; pmrem.texture = target.texture; return target;
    }
    dispose(): void { /* nothing on the GPU */ }
  }
  return { ...actual, PMREMGenerator: RecordingPMREM };
});

describe('(11) gold is lit by the studio room, not only by direct lights', () => {
  it('gives each scene the room environment at the model lighting level, made once per renderer and released with it', () => {
    const renderer = {} as THREE.WebGLRenderer;
    const scene = new THREE.Scene();
    applyStudioEnvironment(scene, renderer, 1.5);
    expect(scene.environment).toBeInstanceOf(THREE.Texture);
    expect(scene.environment).toBe(pmrem.texture);
    expect(scene.environmentIntensity).toBeCloseTo(STUDIO_LIGHT.environment * 1.5);
    // A second view on the same renderer (preview → still) shares the texture instead of prefiltering again.
    const still = new THREE.Scene();
    applyStudioEnvironment(still, renderer, 1);
    expect(still.environment).toBe(scene.environment);
    expect(pmrem.made).toBe(1);
    let disposed = 0;
    (pmrem.target as THREE.WebGLRenderTarget).addEventListener('dispose', () => { disposed += 1; });
    releaseStudioEnvironment(renderer);
    expect(disposed).toBe(1);
    // After a lost context the next draw prefilters again.
    expect(studioEnvironment(renderer)).not.toBe(still.environment);
    expect(pmrem.made).toBe(2);
  });
});
