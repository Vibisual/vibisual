import * as THREE from 'three';
import { APP_CANVAS_FACE, APP_THUMB } from '@vibisual/shared';

import { canvasObjectUrl } from '../../apps/thumbnailBake.js';
import { workspaceMediaSize } from '../../utils/workspaceMedia.js';
import { disposeModel, loadWorkspaceModel } from './modelIO.js';

/**
 * §5.4 #36 (G) — Vibi3D 노드 화면에서 **끌어 돌려 보는** 살아 있는 장면.
 *
 * 노드 화면의 그림(`ModelCanvasFace`)이 처음 손이 닿을 때만 이 모듈을 늦게 부른다 — three 와 모델 로더는 그때 온다.
 * 정지 미리보기(`modelThumbnail`)와 **같은 로더·같은 조명·같은 처음 구도(3/4 위)** 라, 손을 대는 순간 그림이 튀지 않는다.
 *
 * 노드마다 살아 있는 WebGL 문맥을 오래 두지 않는다 — 브라우저는 문맥 수를 한정한다(넘으면 오래된 것부터 잃는다).
 * 그래서 보기(`LiveView`)와 모델(`LiveModel`)을 갈라 둔다: 손을 떼고 잠시 지나면 보기만 버려 문맥을 돌려주고(그 각도의
 * 한 장은 남긴다), 모델은 노드가 화면에 있는 동안 붙들어 다시 손이 닿으면 곧바로 새 보기에 올린다.
 */

/** 처음 구도 — 정지 미리보기와 같은 방향 (1, 0.7, 1). */
const HOME_YAW_DEG = 45;
const HOME_PITCH_DEG = (Math.asin(0.7 / Math.hypot(1, 0.7, 1)) * 180) / Math.PI;
/** 정지 미리보기와 같은 여유(모델 둘레 반지름에 곱하는 거리 배율). */
const FRAME_MARGIN = 1.35;

export interface OrbitAngles {
  yaw: number;
  pitch: number;
}

export function homeAngles(): OrbitAngles {
  return { yaw: HOME_YAW_DEG, pitch: HOME_PITCH_DEG };
}

export interface LiveModel {
  readonly object: THREE.Object3D;
  readonly center: THREE.Vector3;
  readonly radius: number;
  dispose: () => void;
}

export type LiveModelLoad = { readonly ok: true; readonly model: LiveModel } | { readonly ok: false; readonly reason: 'tooLarge' | 'failed' };

/** 모델을 읽는다. 통째로 받기 전에 크기를 묻는다 — 정지 미리보기와 같은 상한(`APP_THUMB.modelMaxBytes`). */
export async function loadLiveModel(projectId: string, file: string): Promise<LiveModelLoad> {
  const bytes = await workspaceMediaSize(projectId, file);
  if (bytes === null || bytes <= 0) return { ok: false, reason: 'failed' };
  if (bytes > APP_THUMB.modelMaxBytes) return { ok: false, reason: 'tooLarge' };
  try {
    const loaded = await loadWorkspaceModel(projectId, file);
    const bounds = new THREE.Box3().setFromObject(loaded.object);
    if (bounds.isEmpty()) {
      disposeModel(loaded.object);
      return { ok: false, reason: 'failed' };
    }
    const center = bounds.getCenter(new THREE.Vector3());
    const extent = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(extent.x, extent.y, extent.z) * 0.5 || 1;
    return { ok: true, model: { object: loaded.object, center, radius, dispose: () => disposeModel(loaded.object) } };
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

/**
 * 모델 하나를 비추는 보기를 만든다. 각도는 `angles` 를 그대로 고쳐 쓴다 — 보기를 버렸다 다시 만들어도 그 각도에서 이어지게
 * 부르는 쪽이 같은 객체를 넘긴다. 배경은 투명이라 노드 바탕이 비친다(정지 미리보기와 같다).
 */
export function createLiveView(
  model: LiveModel,
  width: number,
  height: number,
  pixelRatio: number,
  angles: OrbitAngles,
): LiveView {
  const canvas = document.createElement('canvas');
  canvas.className = 'pointer-events-none absolute inset-0 h-full w-full';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(Math.max(1, width), Math.max(1, height), false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(3, 5, 4);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.1), key, model.object);

  const camera = new THREE.PerspectiveCamera(40, Math.max(1, width) / Math.max(1, height), 0.01, 5000);
  const limit = APP_CANVAS_FACE.orbitPitchLimitDeg;

  const place = (): void => {
    const distance = (model.radius / Math.sin((camera.fov * Math.PI) / 360)) * Math.max(1, 1 / camera.aspect);
    const yaw = (angles.yaw * Math.PI) / 180;
    const pitch = (angles.pitch * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw));
    camera.position.copy(model.center).add(dir.multiplyScalar(distance * FRAME_MARGIN));
    camera.near = Math.max(0.001, distance / 500);
    camera.far = Math.max(100, distance * 50);
    camera.lookAt(model.center);
    camera.updateProjectionMatrix();
  };
  place();

  return {
    canvas,
    setSize: (w, h) => {
      renderer.setSize(Math.max(1, w), Math.max(1, h), false);
      camera.aspect = Math.max(1, w) / Math.max(1, h);
      place();
    },
    orbit: (dYaw, dPitch) => {
      angles.yaw = (angles.yaw + dYaw) % 360;
      angles.pitch = Math.min(limit, Math.max(-limit, angles.pitch + dPitch));
      place();
    },
    home: () => {
      const h = homeAngles();
      angles.yaw = h.yaw;
      angles.pitch = h.pitch;
      place();
    },
    render: () => renderer.render(scene, camera),
    snapshot: async () => {
      renderer.render(scene, camera);
      return canvasObjectUrl(canvas, 'image/png');
    },
    dispose: () => {
      scene.remove(model.object);
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
