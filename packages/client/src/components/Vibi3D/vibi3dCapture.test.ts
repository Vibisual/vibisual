import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { captureVibi3DViews } from './vibi3dCapture.js';
import * as studioLighting from '../Creation/studioLighting.js';
import { recordSceneRaster } from '../Creation/sceneLookRaster.js';

function fixture() {
  const scene = new THREE.Scene(); const model = new THREE.Group(); const helper = new THREE.Object3D(); scene.add(model, helper);
  const camera = new THREE.PerspectiveCamera(45, 1.5); camera.position.set(4, 3, 2);
  const render = vi.fn();
  const renderer = { getSize: (size: THREE.Vector2) => size.set(800, 600), getPixelRatio: () => 2,
    setPixelRatio: vi.fn(), setSize: vi.fn(), render, domElement: { toDataURL: vi.fn(() => 'data:image/png;base64,cGl4ZWxz') } };
  return { model, scene, camera, helper, renderer, render };
}
describe('native capture', () => {
  it('defaults inspection to full final resolution and reports the actual draft raster independently of PNG size', () => {
    const f = fixture(), raster = { width: 360, height: 640, samples: 0 };
    const common = vi.spyOn(studioLighting, 'renderStudioView').mockImplementation((_scene, renderer, _camera, options) => {
      recordSceneRaster(renderer, options.quality === 'draft' ? raster : { width: 1080, height: 1920, samples: 4 });
    });
    const stage = { ...f, renderer: f.renderer as unknown as THREE.WebGLRenderer,
      snapshot: { sessionId: 's', projectId: '/p', fileName: 'Model', revision: 0, selectedId: null, nodes: [] } };
    try {
      expect(captureVibi3DViews(stage, { type: 'capture' })[0]).toMatchObject({ quality: 'final', width: 1080, height: 1920,
        raster: { width: 1080, height: 1920, samples: 4 } });
      expect(captureVibi3DViews(stage, { type: 'capture', quality: 'draft' })[0]).toMatchObject({ quality: 'draft', width: 720, height: 1280, raster });
      expect(() => captureVibi3DViews(stage, { type: 'capture', size: [540, 960] })).toThrow('invalid-command');
    } finally { common.mockRestore(); }
  });
  it('uses neutral diagnostic clay without changing document material or look', () => {
    const f = fixture(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: '#edcfa9' }));
    f.model.add(mesh); f.model.userData['vibi3dLook'] = { preset: 'daylight', exposure: 0.65 };
    const source = JSON.stringify(f.model.toJSON());
    const common = vi.spyOn(studioLighting, 'renderStudioView').mockImplementation(scene => {
      if (scene.overrideMaterial) expect((scene.overrideMaterial as THREE.MeshStandardMaterial).color.getHex()).toBe(0xb8b8b8);
    });
    try {
      captureVibi3DViews({ ...f, renderer: f.renderer as unknown as THREE.WebGLRenderer,
        snapshot: { sessionId: 's', projectId: '/p', fileName: 'Model', revision: 0, selectedId: null, nodes: [] } }, { type: 'capture', mode: 'clay' });
      expect(JSON.stringify(f.model.toJSON())).toBe(source);
    } finally { common.mockRestore(); }
  });
  it('passes AO and final quality to the common renderer without hiding its sky helpers', () => {
    const f = fixture(); const sky = new THREE.Object3D(); sky.userData['vibi3dLookHelper'] = true; f.scene.add(sky);
    const visible: boolean[][] = [];
    const common = vi.spyOn(studioLighting, 'renderStudioView').mockImplementation((scene, renderer, camera) => {
      visible.push([f.helper.visible, sky.visible]); renderer.render(scene, camera);
    });
    try {
      const result = captureVibi3DViews({ ...f, renderer: f.renderer as unknown as THREE.WebGLRenderer,
        snapshot: { sessionId: 's', projectId: '/p', fileName: 'Model', revision: 0, selectedId: null, nodes: [] } },
      { type: 'capture', mode: 'ao', quality: 'final' });
      expect(result[0]).toMatchObject({ mode: 'ao', quality: 'final', width: 1080, height: 1920 });
      expect(common).toHaveBeenNthCalledWith(1, f.scene, f.renderer, f.camera, { object: f.model, mode: 'ao', quality: 'final' });
      expect(visible).toEqual([[false, true], [true, true]]);
    } finally { common.mockRestore(); }
  });
  it('computes a portrait lens using the capture aspect instead of the landscape editor aspect', () => {
    const f = fixture(); const focalLengths: number[] = [];
    f.render.mockImplementation(() => { focalLengths.push(f.camera.getFocalLength()); });
    captureVibi3DViews({ ...f, renderer: f.renderer as unknown as THREE.WebGLRenderer,
      snapshot: { sessionId: 's', projectId: '/p', fileName: 'Model', revision: 0, selectedId: null, nodes: [] } },
    { type: 'capture', views: [{ position: [0, 2, 10], target: [0, 2, 0], lens: 35 }], size: [1080, 1920] });
    expect(focalLengths[0]).toBeCloseTo(35);
  });
  it('captures multiple exact-size PNGs synchronously and restores camera, renderer and helpers', () => {
    const f = fixture(); const original = f.camera.clone();
    const result = captureVibi3DViews({ ...f, renderer: f.renderer as unknown as THREE.WebGLRenderer,
      snapshot: { sessionId: 's', projectId: '/p', fileName: 'Model', revision: 0, selectedId: null, nodes: [] } },
    { type: 'capture', views: [{ name: 'front', position: [0, 2, 10], target: [0, 2, 0], lens: 24 }, 'current'], size: [1080, 1920], quality: 'final', mode: 'clay' });
    expect(result.map(({ view, width, height }) => [view, width, height])).toEqual([['front', 1080, 1920], ['current', 1080, 1920]]);
    expect(f.renderer.domElement.toDataURL).toHaveBeenCalledWith('image/png');
    expect(f.camera.position).toEqual(original.position); expect(f.camera.aspect).toBe(original.aspect);
    expect(f.helper.visible).toBe(true); expect(f.scene.overrideMaterial).toBeNull();
    expect(f.renderer.setPixelRatio).toHaveBeenLastCalledWith(2);
    expect(f.renderer.setSize).toHaveBeenLastCalledWith(800, 600, false);
    expect(f.render).toHaveBeenCalledTimes(3);
  });
  it('restores the stage after an unknown named shot instead of capturing another view silently', () => {
    const f = fixture();
    expect(() => captureVibi3DViews({ ...f, renderer: f.renderer as unknown as THREE.WebGLRenderer,
      snapshot: { sessionId: 's', projectId: '/p', fileName: 'Model', revision: 0, selectedId: null, nodes: [] } },
    { type: 'capture', views: ['missing'] })).toThrow('capture-shot-not-found');
    expect(f.helper.visible).toBe(true); expect(f.scene.overrideMaterial).toBeNull();
    expect(f.renderer.setSize).toHaveBeenLastCalledWith(800, 600, false);
  });
});
