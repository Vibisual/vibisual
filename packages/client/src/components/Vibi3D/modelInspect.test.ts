import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { buildModelPickClipboard, modelInspectLevels, storedModelId, type ModelInspectSubject } from './modelInspect.js';

/** §5.4 #15 (C) — 3D 뷰포트를 Alt 로 집으면 클릭 선택과 같은 광선 판정으로 물체 → 부모들 → 모델을 답한다(WebGL 없이 돈다). */

const SIZE = { width: 800, height: 400 };

function box(name: string, id: string, size: [number, number, number], at: [number, number, number] = [0, 0, 0]): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial());
  mesh.name = name;
  mesh.userData['vibi3dId'] = id;
  mesh.position.set(...at);
  return mesh;
}

function stage(): { root: THREE.Group; car: THREE.Group; body: THREE.Mesh; wheel: THREE.Mesh; backdrop: THREE.Mesh; camera: THREE.PerspectiveCamera } {
  const root = new THREE.Group(); root.name = 'Product'; root.userData['vibi3dId'] = 'root';
  const car = new THREE.Group(); car.name = 'Car'; car.userData['vibi3dId'] = 'car'; root.add(car);
  const body = box('Body', 'body', [2, 1, 1]); car.add(body);
  const wheel = box('Wheel', 'wheel', [0.5, 0.5, 0.5], [3, 0, 0]); car.add(wheel);
  const backdrop = box('Backdrop', 'backdrop', [12, 6, 0.1], [0, 0, -3]); root.add(backdrop);
  const camera = new THREE.PerspectiveCamera(45, SIZE.width / SIZE.height, 0.1, 100);
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  root.updateMatrixWorld(true);
  return { root, car, body, wheel, backdrop, camera };
}

const live: ModelInspectSubject = {
  kind: 'scene', projectId: 'My Project', fileName: 'car.glb', revision: 4, liveSessionId: 'sess-1',
  source: { id: 'src-1', revision: 3 }, unsaved: true,
};

function screenOf(point: THREE.Vector3, camera: THREE.Camera): { x: number; y: number } {
  const p = point.clone().project(camera);
  return { x: (p.x + 1) / 2 * SIZE.width, y: (1 - p.y) / 2 * SIZE.height };
}

describe('3D 뷰포트 — 커서 아래 물체 → 부모들 → 모델 전체', () => {
  it('picks the nearest object under the cursor and climbs to the model root, each with its projected box', () => {
    const s = stage();
    const levels = modelInspectLevels({ camera: s.camera, root: s.root, idOf: storedModelId }, live, { x: 400, y: 200, ...SIZE });
    expect(levels.map((l) => l.label)).toEqual(['Body', 'Car', 'Product']);
    expect(levels[0]!.text).toBe('Mesh · Car');
    const [body, car, root] = levels.map((l) => l.rect);
    // 몸통 상자는 커서를 품고, 차 상자는 몸통과 바퀴를 함께 품는다.
    expect(body!.x).toBeLessThan(400); expect(body!.x + body!.width).toBeGreaterThan(400);
    const wheel = screenOf(new THREE.Vector3(3.25, 0, 0), s.camera);
    expect(car!.x + car!.width).toBeGreaterThanOrEqual(wheel.x - 0.5);
    expect(car!.x).toBeLessThanOrEqual(body!.x);
    expect(root!.width).toBeGreaterThan(car!.width); // 뿌리에는 뒤판도 들어 있다.
  });

  it('picks a small part where it is drawn', () => {
    const s = stage();
    const at = screenOf(new THREE.Vector3(3, 0, 0), s.camera);
    const levels = modelInspectLevels({ camera: s.camera, root: s.root, idOf: storedModelId }, live, { ...at, ...SIZE });
    expect(levels[0]!.label).toBe('Wheel');
    expect(levels[0]!.clipboard).toContain('object "Wheel" id "wheel" (Mesh, path "Product › Car › Wheel", position [3, 0, 0] local, size [0.5, 0.5, 0.5] world)');
  });

  it('looks through hidden objects to what is visible behind them, and answers nothing over empty space', () => {
    const s = stage();
    s.body.visible = false;
    const levels = modelInspectLevels({ camera: s.camera, root: s.root, idOf: storedModelId }, live, { x: 400, y: 200, ...SIZE });
    expect(levels.map((l) => l.label)).toEqual(['Backdrop', 'Product']);
    expect(modelInspectLevels({ camera: s.camera, root: s.root, idOf: storedModelId }, live, { x: 5, y: 5, ...SIZE })).toEqual([]);
  });

  it('skips nodes without a stable id (they cannot be named in a command)', () => {
    const s = stage();
    const idOf = (o: THREE.Object3D): string | null => (o === s.car ? null : storedModelId(o));
    const levels = modelInspectLevels({ camera: s.camera, root: s.root, idOf }, live, { x: 400, y: 200, ...SIZE });
    expect(levels.map((l) => l.label)).toEqual(['Body', 'Product']);
  });

  it('boxes the whole view when the object reaches behind the camera (its projection would flip)', () => {
    const s = stage();
    // 카메라(z=10) 옆을 지나 뒤(z=30)까지 뻗은 막대 — 카메라는 막대 밖에 있다.
    const pole = box('Pole', 'pole', [0.2, 0.2, 28], [0.8, 0, 16]);
    s.root.add(pole); s.root.updateMatrixWorld(true);
    const at = screenOf(new THREE.Vector3(0.75, 0, 5), s.camera);
    const levels = modelInspectLevels({ camera: s.camera, root: s.root, idOf: storedModelId }, live, { ...at, ...SIZE });
    expect(levels[0]!.label).toBe('Pole');
    expect(levels[0]!.rect).toEqual({ x: 0, y: 0, ...SIZE });
  });
});

describe('3D 복사 글 — 무엇을 보고 있나 · 고치는 길', () => {
  it('points an open scene at the live bridge and the saved source', () => {
    const text = buildModelPickClipboard(live, 'object "Body"');
    expect(text).toContain('[3D] scene "car.glb" open in Vibi3D in project "My Project" (revision 4, saved source "src-1" revision 3, unsaved changes in the viewer)');
    expect(text).toContain('GET $VIBISUAL_BASE/api/app/vibi3d/sessions/sess-1');
    expect(text).toContain('POST $VIBISUAL_BASE/api/app/vibi3d/sessions/sess-1/commands');
    expect(text).toContain('GET $VIBISUAL_BASE/api/app/creation/docs/src-1?projectId=My%20Project');
  });

  it('asks for a save when there is neither a live bridge nor a saved source', () => {
    const text = buildModelPickClipboard({ ...live, liveSessionId: null, source: null, unsaved: false }, 'object "Body"');
    expect(text).toContain('(revision 4, no saved source yet)');
    expect(text).toContain('Ask the user to save the source in Vibi3D first.');
    expect(text).not.toContain('/sessions/');
  });

  it('names the proposal (or the before side) in a review preview, and never invites accepting it', () => {
    const after = buildModelPickClipboard({ kind: 'review', projectId: 'p', sourceId: 'src-1', sourceRevision: 3, candidateId: 'cand-1' }, 'object "Body"');
    expect(after).toContain('[3D] proposal "cand-1" for source "src-1" (based on revision 3)');
    expect(after).toContain('GET $VIBISUAL_BASE/api/app/creation/docs/src-1/candidates/cand-1?projectId=p');
    expect(after).toContain('never accept one yourself');
    const before = buildModelPickClipboard({ kind: 'review', projectId: 'p', sourceId: 'src-1', sourceRevision: 3, candidateId: null }, 'object "Body"');
    expect(before).toContain('the "before" side of a proposal review');
  });
});
