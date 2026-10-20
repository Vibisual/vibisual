import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ModelScene } from './modelScene.js';
import { STUDIO_LIGHT, applyStudioEnvironment, studioEnvironment, studioLightPlan } from './studioLighting.js';
import { inspectorFields } from '../VideoStudio/videoInspectorFields.js';

/** §5.13 (R-10) item 11 — one studio light and environment wherever a 3D source becomes a picture. */
describe('(11) studio lighting', () => {
  it('a model with its own lights replaces the matching studio light, everywhere by the same rule', () => {
    expect(studioLightPlan(new THREE.Group())).toEqual({ ambient: true, key: true });
    const lit = new THREE.Group(); lit.add(new THREE.PointLight());
    expect(studioLightPlan(lit)).toEqual({ ambient: true, key: false });
    const sky = new THREE.Group(); sky.add(new THREE.HemisphereLight());
    expect(studioLightPlan(sky)).toEqual({ ambient: false, key: true });
  });

  it('the video/still renderer lights each frame with the environment at the model lighting level', () => {
    const object = new THREE.Group();
    object.add(new THREE.Mesh(new THREE.SphereGeometry(), new THREE.MeshStandardMaterial({ color: '#d4af37', metalness: 0.9, roughness: 0.25 })));
    object.userData['vibi3dLighting'] = 1.5;
    const scene = new ModelScene(object, []);
    const render = vi.fn();
    const environment = vi.fn();
    scene.renderTo({ render } as unknown as THREE.WebGLRenderer, 320, 180, 0, {}, environment);
    expect(environment).toHaveBeenCalledWith(scene.scene, expect.anything(), 1.5);
    expect(render).toHaveBeenCalledWith(scene.scene, scene.camera);
    scene.dispose();
  });

  it('a renderer that cannot prefilter shows the direct lights instead of failing the view', () => {
    const broken = {} as THREE.WebGLRenderer;
    expect(studioEnvironment(broken)).toBeNull();
    const scene = new THREE.Scene();
    expect(() => applyStudioEnvironment(scene, broken, 1)).not.toThrow();
    expect(scene.environment).toBeNull();
  });

  it('the Vibi3D view, the candidate preview, video model frames, product stills and node previews all use it', () => {
    const sources = import.meta.glob([
      // §5.13 (Y) 40-4 — 영상의 모델 프레임 그리기는 늦게 싣는 `videoModelFrames.ts` 로 옮겼다(스튜디오 첫 청크에 three.js ❌).
      '../Vibi3D/Vibi3DShell.tsx', '../Vibi3D/Vibi3DCandidatePreview.tsx', '../VideoStudio/videoModelFrames.ts', './modelScene.ts',
      '../Vibi3D/modelCanvasLive.ts',
    ], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(sources)).toHaveLength(5);
    for (const [file, source] of Object.entries(sources)) {
      expect(source, file).toContain('applyStudioEnvironment');
      expect(source, file).toContain('renderStudioView');
      // Environment parity alone misses raw draws that bypass tone mapping and postprocessing.
      expect(source, file).not.toMatch(/renderer(?:Ref\.current)?\.render\(/);
    }
    const thumbnail = import.meta.glob('../Vibi3D/modelThumbnail.ts', { query: '?raw', import: 'default', eager: true });
    expect(thumbnail['../Vibi3D/modelThumbnail.ts']).toContain('createLiveView(');
    const bridges = import.meta.glob(['../Vibi3D/candidatePreview.ts', '../Vibi3D/vibi3dCapture.ts'], {
      query: '?raw', import: 'default', eager: true,
    }) as Record<string, string>;
    expect(Object.keys(bridges)).toHaveLength(2);
    expect(bridges['../Vibi3D/candidatePreview.ts']).toContain('this.options.renderView(this.scene, this.renderer, this.camera, this.shown)');
    expect(bridges['../Vibi3D/vibi3dCapture.ts']).toContain('renderStudioView(scene, renderer, camera, { object: model, quality, mode })');
  });

  it('the video inspector shows the light levels the renderer really uses', () => {
    const fields = inspectorFields({ id: 'm', kind: 'model', at: 0, duration: 1 }, 1080);
    expect(fields.find((field) => field.key === 'ambientLight')?.defaultValue).toBe(STUDIO_LIGHT.ambient);
    expect(fields.find((field) => field.key === 'keyLight')?.defaultValue).toBe(STUDIO_LIGHT.key);
  });
});
