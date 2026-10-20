import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { buildDrawList, createEmptyDoc, resolveTimeline } from '@vibisual/video';
import { resolveVibi3DCameraFov, type CreationValue, type Vibi3DShot } from '@vibisual/shared';
import { ModelScene, renderModelSourceStill } from './modelScene.js';
import { loadVideoModel, VideoModelScene } from '../VideoStudio/videoModelScene.js';
import { ModelFrameRenderer } from '../VideoStudio/videoModelFrames.js';
import { captureVibi3DViews } from '../Vibi3D/vibi3dCapture.js';
import { CandidatePreviewStage, PreviewModelCache } from '../Vibi3D/candidatePreview.js';
import { createLiveView, homeAngles } from '../Vibi3D/modelCanvasLive.js';

const log = vi.hoisted(() => ({ frames: [] as { width: number; height: number; position: number[]; fov: number; aspect: number; look: unknown; options: unknown }[] }));
vi.mock('three', async importOriginal => {
  const actual = await importOriginal<typeof import('three')>();
  class Renderer {
    width = 640; height = 360; ratio = 1;
    domElement = { toDataURL: () => 'data:image/png;base64,cGl4ZWxz', toBlob: (done: (blob: Blob) => void) => done(new Blob(['png'], { type: 'image/png' })), addEventListener: () => undefined };
    getSize(size: THREE.Vector2) { return size.set(this.width, this.height); }
    setSize(width: number, height: number) { this.width = width; this.height = height; }
    setPixelRatio(ratio: number) { this.ratio = ratio; }
    getPixelRatio() { return this.ratio; }
    setClearColor() {} dispose() {} forceContextLoss() {}
  }
  return { ...actual, WebGLRenderer: Renderer };
});
vi.mock('./studioLighting.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./studioLighting.js')>();
  return { ...actual, applyStudioEnvironment: vi.fn(), releaseStudioEnvironment: vi.fn(),
    renderStudioView: (_scene: THREE.Scene, renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, options: { object: THREE.Object3D }) => {
      const size = renderer.getSize(new THREE.Vector2());
      log.frames.push({ width: size.x, height: size.y, position: camera.position.toArray(), fov: camera.fov, aspect: camera.aspect,
        look: structuredClone(options.object.userData['vibi3dLook']), options: { ...options, object: undefined } });
    } };
});

const shots: Vibi3DShot[] = [
  { id: 'street', name: 'Street', position: [8, 1.6, 10], target: [0, 4, 0], lens: 24, aspect: '9:16' },
  { id: 'store', name: 'Storefront', position: [1, 1.6, 6], target: [1, 1.6, 0], fov: 52, aspect: '16:9' },
];
function fixture() {
  const object = new THREE.Group(); object.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
  object.userData['vibi3dShots'] = structuredClone(shots); object.userData['vibi3dActiveShotId'] = 'street';
  object.userData['vibi3dCamera'] = { position: [0, 2, 6], target: [0, 1, 0], lens: 35, aspect: '9:16' };
  object.userData['vibi3dLook'] = { preset: 'daylight', exposure: 0.85 };
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 500); camera.userData['vibi3dViewCamera'] = true; object.add(camera);
  const clips = [new THREE.AnimationClip('Vibi3D:camera:path', 4, [new THREE.VectorKeyframeTrack(`${camera.uuid}.position`, [0, 4], [0, 2, 6, 4, 2, 6])])];
  return { object, clips };
}
function op(props: Record<string, unknown>) {
  const doc = { ...createEmptyDoc('video', 'Shots'), size: { width: 1080, height: 1920 }, tracks: [{ id: 'visual', kind: 'visual' as const,
    items: [{ id: 'scene', kind: 'model' as const, at: 0, duration: 4, assetId: 'model', props }] }],
    assets: { model: { id: 'model', kind: 'model' as const, source: { kind: 'file' as const, path: 'scene.vibi3d' } } } };
  return buildDrawList(doc, resolveTimeline(doc), 2)[0]!;
}
beforeEach(() => { log.frames.length = 0; });
describe('saved camera output contract', () => {
  it('keeps an explicit shot above camera animation and item camera overrides', () => {
    const f = fixture(), model = new ModelScene(f.object, f.clips);
    for (const time of [0, 2, 4]) {
      model.seekFrame(1080, 1920, time, { cameraShot: 'street', cameraMotion: true, cameraFov: 100, cameraPosition: [9, 9, 9], cameraOrbit: 30 });
      expect(model.camera.position.toArray()).toEqual(shots[0]!.position); expect(model.camera.getFocalLength()).toBeCloseTo(24);
    }
    model.dispose();
  });
  it('uses the active shot by default, and changes only pose for an explicit camera motion', () => {
    const f = fixture(), model = new ModelScene(f.object, f.clips);
    model.seekFrame(1080, 1920, 2); expect(model.camera.position.toArray()).toEqual(shots[0]!.position);
    model.seekFrame(1080, 1920, 2, { cameraMotion: true });
    expect(model.camera.position.toArray()).toEqual([2, 2, 6]); expect(model.camera.getFocalLength()).toBeCloseTo(24);
    delete f.object.userData['vibi3dActiveShotId']; model.seekFrame(1080, 1920, 2);
    expect(model.camera.position.toArray()).toEqual([2, 2, 6]); expect(model.camera.getFocalLength()).toBeCloseTo(35);
    model.dispose();
  });
  it('uses a saved vertical FOV and fails clearly for a missing stable shot id', () => {
    const f = fixture(), model = new ModelScene(f.object, f.clips);
    model.seekFrame(1920, 1080, 2, { cameraShot: 'store' }); expect(model.camera.fov).toBe(52);
    expect(() => model.seekFrame(1920, 1080, 2, { cameraShot: 'missing' })).toThrow('camera-shot-missing'); model.dispose();
  });
  it('keeps legacy animated camera optics when the source has no new shot or lens values', () => {
    const f = fixture(); delete f.object.userData['vibi3dActiveShotId']; delete f.object.userData['vibi3dShots']; delete f.object.userData['vibi3dCamera'];
    const model = new ModelScene(f.object, f.clips); model.seekFrame(320, 180, 2);
    expect(model.camera.position.toArray()).toEqual([2, 2, 6]); expect(model.camera.fov).toBe(48); model.dispose();
  });
  it('round-trips shots and renders an actual still and video draw op with identical optics, dimensions and look', async () => {
    const f = fixture(), payload = { format: 'vibi3d', version: 1, scene: f.object.toJSON(), clips: f.clips.map(THREE.AnimationClip.toJSON) };
    const props = { cameraShot: 'street', modelBackground: 'sky' as const };
    const still = await renderModelSourceStill('/project', payload as unknown as CreationValue, 1080, 1920, 2, props);
    expect(still.type).toBe('image/png');
    const model = await loadVideoModel(new TextEncoder().encode(JSON.stringify(payload)).buffer, 'source.vibi3d');
    expect(model.object.userData['vibi3dShots']).toEqual(shots);
    const frames = new ModelFrameRenderer(undefined, (width, height) => ({ width, height, getContext: () => ({ drawImage: () => undefined }) }) as unknown as HTMLCanvasElement);
    const canvas = frames.draw(model, op(props)); expect([canvas.width, canvas.height]).toEqual([1080, 1920]);
    expect(log.frames).toHaveLength(2); expect(log.frames[1]).toEqual(log.frames[0]);
    expect(log.frames[0]).toMatchObject({ position: shots[0]!.position, aspect: 9 / 16, fov: resolveVibi3DCameraFov(shots[0]!, 9 / 16),
      look: { preset: 'daylight', exposure: 0.85 }, options: { quality: 'final', background: 'sky' } });
    frames.dispose(); model.dispose();
  });
  it('captures named shot dimensions and optics, with explicit aspect and pixel size taking priority', () => {
    const f = fixture(), camera = new THREE.PerspectiveCamera(45, 1), scene = new THREE.Scene(); scene.add(f.object);
    const stage = { renderer: new THREE.WebGLRenderer(), scene, camera, model: f.object,
      snapshot: { sessionId: 's', projectId: '/p', fileName: 'm', revision: 0, selectedId: null, nodes: [] } };
    const captures = captureVibi3DViews(stage, { type: 'capture', views: ['Street', 'store'], quality: 'final' });
    expect(captures.map(c => [c.width, c.height])).toEqual([[1080, 1920], [1920, 1080]]);
    expect(log.frames.slice(0, 2).map(frame => frame.fov)).toEqual([resolveVibi3DCameraFov(shots[0]!, 9 / 16), 52]);
    log.frames.length = 0;
    const square = captureVibi3DViews(stage, { type: 'capture', aspect: '1:1', quality: 'final' });
    expect(square[0]).toMatchObject({ view: 'street', width: 1080, height: 1080 });
    const explicit = captureVibi3DViews(stage, { type: 'capture', views: ['street'], aspect: '1:1', size: [1920, 1080], quality: 'final' });
    expect(explicit[0]).toMatchObject({ width: 1920, height: 1080 });
    expect(() => captureVibi3DViews(stage, { type: 'capture', size: [540, 960], quality: 'final' })).toThrow('invalid-command');
  });
  it('uses saved optics in a candidate, and resets the camera when the next source has no view', async () => {
    const f = fixture(), old = new THREE.Group();
    const cache = new PreviewModelCache(async value => ({ object: value === 'new' ? f.object : old, clips: [], fileName: 'scene' }), () => undefined);
    const stage = new CandidatePreviewStage({ cache, width: 1920, height: 1080, createRenderer: () => ({ render: () => undefined, dispose: () => undefined }) });
    await stage.show('new', () => 'new'); expect(stage.camera.position.toArray()).toEqual(shots[0]!.position);
    expect(stage.camera.getFocalLength()).toBeCloseTo(24); expect(stage.camera.aspect).toBe(16 / 9);
    await stage.show('legacy', () => 'legacy'); expect(stage.camera.fov).toBe(45); stage.dispose();
  });
  it('starts the canvas at the active shot and preserves lens when resized, orbited and reset', () => {
    vi.stubGlobal('document', { createElement: () => ({ className: '', style: {} }) });
    try {
      const f = fixture(), angles = homeAngles();
      const view = createLiveView({ object: f.object, center: new THREE.Vector3(), radius: 1, dispose: () => undefined }, 1080, 1920, 1, angles);
      view.render(); expect(log.frames.at(-1)?.position).toEqual(shots[0]!.position);
      view.setSize(1920, 1080); view.render();
      expect(log.frames.at(-1)).toMatchObject({ width: 608, height: 1080, aspect: 608 / 1080 });
      expect(log.frames.at(-1)?.fov).toBeCloseTo(resolveVibi3DCameraFov(shots[0]!, 608 / 1080));
      expect(log.frames.at(-1)?.options).not.toHaveProperty('background', 'preserve');
      view.orbit(15, 0); view.render(); expect(log.frames.at(-1)?.position).not.toEqual(shots[0]!.position);
      expect(log.frames.at(-1)?.fov).toBeCloseTo(resolveVibi3DCameraFov(shots[0]!, 608 / 1080));
      view.home(); view.render(); expect(log.frames.at(-1)?.position).toEqual(shots[0]!.position); view.dispose();
    } finally { vi.unstubAllGlobals(); }
  });
});
