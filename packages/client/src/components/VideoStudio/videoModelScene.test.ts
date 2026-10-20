import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildDrawList, createEmptyDoc, resolveTimeline } from '@vibisual/video';
import { validateVibi3DLook } from '@vibisual/shared';
import { loadVideoModel, VideoModelScene } from './videoModelScene.js';

function fixture(): { object: THREE.Group; mesh: THREE.Mesh; clips: THREE.AnimationClip[] } {
  const object = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: '#d1a441' }));
  mesh.name = 'Lid'; mesh.userData['vibi3dId'] = 'lid'; object.add(mesh);
  return { object, mesh, clips: [new THREE.AnimationClip('Move', 4, [new THREE.VectorKeyframeTrack(`${mesh.uuid}.position`, [0, 4], [0, 0, 0, 4, 0, 0])])] };
}
describe('shared product renderer', () => {
  it.each(['daylight', 'studio'])('preserves the saved %s look instead of applying old item light overrides', (preset) => {
    const { object } = fixture(); const light = new THREE.DirectionalLight(0xffffff, 1.6); object.add(light);
    object.userData['vibi3dLook'] = { preset };
    expect(validateVibi3DLook(object.userData['vibi3dLook'])).not.toBeNull();
    const model = new VideoModelScene(object, []);
    model.seekFrame(320, 180, 0, { ambientLight: 0.3, keyLight: 4 });
    expect(light.intensity).toBe(1.6);
    model.dispose();
  });
  it('keeps legacy per-item light overrides for documents without a valid saved look', () => {
    const { object } = fixture(); const light = new THREE.DirectionalLight(0xffffff, 1.6); object.add(light);
    const model = new VideoModelScene(object, []);
    for (const look of [undefined, { preset: 'not-a-preset' }]) {
      object.userData['vibi3dLook'] = look;
      model.seekFrame(320, 180, 0, { ambientLight: 0.3, keyLight: 4 });
      expect(light.intensity).toBe(4);
      const fill = model.scene.children.find(child => child instanceof THREE.HemisphereLight) as THREE.HemisphereLight;
      expect(fill.intensity).toBe(0.3);
    }
    model.dispose();
  });
  it('loads editable scene and animations, and repeats exactly after seeking backwards', async () => {
    const { object, clips } = fixture();
    object.userData['vibi3dCamera'] = { position: [3, 2, 5], target: [0, 0, 0] };
    const bytes = new TextEncoder().encode(JSON.stringify({ format: 'vibi3d', scene: object.toJSON(), clips: clips.map(THREE.AnimationClip.toJSON) })).buffer;
    const model = await loadVideoModel(bytes, 'product.vibi3d');
    const mesh = model.object.getObjectByName('Lid')!;
    model.seekFrame(640, 360, 2, { turntable: 30 });
    const first = mesh.matrixWorld.toArray(); const camera = model.camera.matrixWorld.toArray();
    model.seekFrame(640, 360, 0, { turntable: 30 });
    expect(mesh.matrixWorld.toArray()).not.toEqual(first);
    model.seekFrame(640, 360, 2, { turntable: 30 });
    expect(mesh.matrixWorld.toArray()).toEqual(first);
    expect(model.camera.matrixWorld.toArray()).toEqual(camera);
    expect(mesh.userData['vibi3dId']).toBe('lid'); expect(model.duration).toBe(4);
    model.dispose();
  });
  it('uses animated authored camera and preserves authored light intensity', () => {
    const { object } = fixture();
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 500); camera.name = 'Camera'; camera.position.z = 6; camera.userData['vibi3dViewCamera'] = true;
    const light = new THREE.DirectionalLight(0xffffff, 1.6); object.add(camera, light);
    const model = new VideoModelScene(object, [new THREE.AnimationClip('Camera move', 4, [new THREE.VectorKeyframeTrack(`${camera.uuid}.position`, [0, 4], [0, 0, 6, 4, 2, 6])])]);
    model.seekFrame(320, 180, 2);
    expect(model.camera.position.toArray()).toEqual([2, 1, 6]); expect(model.camera.fov).toBe(48); expect(light.intensity).toBe(1.6);
    model.dispose();
  });
  it('raycasts a stable internal object id at the preview time', () => {
    const { object } = fixture(); const model = new VideoModelScene(object, []);
    const doc = { ...createEmptyDoc('d', ''), size: { width: 320, height: 180 }, tracks: [{ id: 'v', kind: 'visual' as const, items: [{ id: 'p', kind: 'model' as const, at: 0, duration: 5, assetId: 'm' }] }], assets: { m: { id: 'm', kind: 'model' as const, source: { kind: 'file' as const, path: 'p.glb' } } } };
    const op = buildDrawList(doc, resolveTimeline(doc), 0)[0]!; model.seek(op);
    expect(model.pick(op, 160, 90)?.objectId).toBe('lid'); model.dispose();
  });
});
