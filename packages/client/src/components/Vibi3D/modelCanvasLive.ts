import * as THREE from 'three';
import { APP_CANVAS_FACE, APP_THUMB } from '@vibisual/shared';

import { canvasObjectUrl } from '../../apps/thumbnailBake.js';
import { workspaceMediaSize } from '../../utils/workspaceMedia.js';
import { applyStudioEnvironment, createStudioLights, planStudioLights, releaseStudioEnvironment, renderStudioView } from '../Creation/studioLighting.js';
import { disposeModel, loadWorkspaceModel } from './modelIO.js';
import { loadModelSource } from './modelSource.js';
import { applyModelCameraView, readActiveModelShot, readModelCamera } from './modelCamera.js';
import { MODEL_BACKGROUNDS, MODEL_VIEW_FOV, MODEL_FRAME_MARGIN, createModelGrid, modelFrame } from './modelViewport.js';
import { vibi3dViewSize } from './vibi3dViewSize.js';

/**
 * §5.4 #36 (G) — Vibi3D 노드의 끌어 돌려 보기. 처음 손이 닿을 때만 늦게 불리고, 정지 미리보기와 같은 로더·조명·구도라 그림이 튀지 않는다.
 * WebGL 문맥 수는 브라우저가 한정한다 — 손을 떼면 잠시 뒤 보기(`LiveView`)만 버리고, 모델(`LiveModel`)은 화면에 있는 동안 붙든다.
 */

/** 처음 구도 — 정지 미리보기와 같은 방향 (1, 0.7, 1). */
const HOME_YAW_DEG = 45;
const HOME_PITCH_DEG = (Math.asin(0.7 / Math.hypot(1, 0.7, 1)) * 180) / Math.PI;
/** 정지 미리보기와 같은 여유(모델 둘레 반지름에 곱하는 거리 배율). */
const FRAME_MARGIN = MODEL_FRAME_MARGIN;

export interface OrbitAngles {
  yaw: number;
  pitch: number;
  custom?: boolean;
}

export function homeAngles(): OrbitAngles {
  return { yaw: HOME_YAW_DEG, pitch: HOME_PITCH_DEG };
}

export interface LiveModel {
  readonly object: THREE.Object3D;
  readonly center: THREE.Vector3;
  readonly radius: number;
  readonly empty?: boolean;
  dispose: () => void;
}

export type LiveModelLoad = { readonly ok: true; readonly model: LiveModel } | { readonly ok: false; readonly reason: 'tooLarge' | 'failed' | 'empty' };

function frameModel(object: THREE.Object3D, allowEmpty: boolean): LiveModelLoad {
  const { center, radius, empty } = modelFrame(object);
  if (empty && !allowEmpty) {
    disposeModel(object);
    return { ok: false, reason: 'failed' };
  }
  return { ok: true, model: { object, center, radius, empty, dispose: () => disposeModel(object) } };
}

/** The document is data, using the same blob resolution and safe parser as the full editor. */
export async function loadLiveModelSource(projectId: string, payload: unknown, title: string): Promise<LiveModelLoad> {
  try {
    const loaded = await loadModelSource(payload, title, projectId);
    return frameModel(loaded.object, true);
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** 모델을 읽는다. 통째로 받기 전에 크기를 묻는다 — 정지 미리보기와 같은 상한(`APP_THUMB.modelMaxBytes`). */
export async function loadLiveModel(projectId: string, file: string): Promise<LiveModelLoad> {
  const bytes = await workspaceMediaSize(projectId, file);
  if (bytes === null || bytes <= 0) return { ok: false, reason: 'failed' };
  if (bytes > APP_THUMB.modelMaxBytes) return { ok: false, reason: 'tooLarge' };
  try {
    const loaded = await loadWorkspaceModel(projectId, file);
    return frameModel(loaded.object, false);
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

export interface LiveView {
  /** three 가 그리는 캔버스 — 부르는 쪽이 자기 자리에 붙인다. */
  readonly canvas: HTMLCanvasElement;
  setSize: (width: number, height: number) => void;
  /** 각도를 더한다(도). 위아래는 `APP_CANVAS_FACE.orbitPitchLimitDeg` 에서 멈춘다(넘으면 뒤집혀 보인다). */
  orbit: (dYawDeg: number, dPitchDeg: number) => void;
  /** 처음 구도로. */
  home: () => void;
  render: () => void;
  /** 지금 장면 한 장(blob URL). 못 찍으면 `null`. 만든 URL 은 부르는 쪽이 되돌린다. */
  snapshot: () => Promise<string | null>;
  /** 보기만 버린다 — 문맥을 돌려주고 모델은 장면에서 떼어 남긴다(다음 보기가 다시 올린다). */
  dispose: () => void;
}

/** 각도는 `angles` 를 그대로 고쳐 쓴다 — 보기를 다시 만들어도 이어지게 부르는 쪽이 같은 객체를 넘긴다. 편집기와 같은 격자·배경·카메라 비율, 작은 해상도. */
export function createLiveView(
  model: LiveModel,
  width: number,
  height: number,
  pixelRatio: number,
  angles: OrbitAngles,
): LiveView {
  const canvas = document.createElement('canvas');
  canvas.className = 'pointer-events-none absolute';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // §5.13 (R-10) — the same studio light and environment as the Vibi3D view and every output.
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(MODEL_BACKGROUNDS.dark);
  const grid = createModelGrid();
  const lights = createStudioLights();
  scene.add(lights.ambient, lights.key, grid, model.object);
  const lighting: unknown = model.object.userData['vibi3dLighting'];
  const level = typeof lighting === 'number' && Number.isFinite(lighting) && lighting >= 0 ? lighting : 1;
  planStudioLights(lights, model.object, level);
  applyStudioEnvironment(scene, renderer, level);

  const camera = new THREE.PerspectiveCamera(MODEL_VIEW_FOV, 1, 0.01, 5000);
  const limit = APP_CANVAS_FACE.orbitPitchLimitDeg;
  const saved = readActiveModelShot(model.object) ?? readModelCamera(model.object);
  const target = saved ? new THREE.Vector3().fromArray(saved.target) : model.center;
  const savedDistance = saved ? new THREE.Vector3().fromArray(saved.position).distanceTo(target) : null;

  const place = (): void => {
    if (saved && applyModelCameraView(camera, saved, { aspect: camera.aspect }) && !angles.custom) return;
    const distance = (model.radius / Math.sin((camera.fov * Math.PI) / 360)) * Math.max(1, 1 / camera.aspect);
    const yaw = (angles.yaw * Math.PI) / 180;
    const pitch = (angles.pitch * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw));
    camera.position.copy(target).add(dir.multiplyScalar(savedDistance ?? distance * FRAME_MARGIN));
    camera.near = Math.max(0.001, distance / 500);
    camera.far = Math.max(100, distance * 50);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  };
  const resize = (w: number, h: number): void => {
    const size = vibi3dViewSize(Math.max(1, w), Math.max(1, h), saved?.aspect);
    renderer.setSize(size.width, size.height, true);
    Object.assign(canvas.style, { left: `${size.left}px`, top: `${size.top}px` });
    camera.aspect = size.width / size.height;
    place();
  };
  resize(width, height);

  return {
    canvas,
    setSize: resize,
    orbit: (dYaw, dPitch) => {
      if (saved && !angles.custom) {
        const direction = camera.position.clone().sub(target).normalize();
        angles.yaw = Math.atan2(direction.x, direction.z) * 180 / Math.PI; angles.pitch = Math.asin(direction.y) * 180 / Math.PI;
      }
      angles.custom = true;
      angles.yaw = (angles.yaw + dYaw) % 360;
      angles.pitch = Math.min(limit, Math.max(-limit, angles.pitch + dPitch));
      place();
    },
    home: () => {
      delete angles.custom;
      const h = homeAngles();
      angles.yaw = h.yaw;
      angles.pitch = h.pitch;
      place();
    },
    render: () => renderStudioView(scene, renderer, camera, { object: model.object }),
    snapshot: async () => {
      renderStudioView(scene, renderer, camera, { object: model.object });
      return canvasObjectUrl(canvas, 'image/png');
    },
    dispose: () => {
      scene.remove(model.object);
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      releaseStudioEnvironment(renderer);
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
