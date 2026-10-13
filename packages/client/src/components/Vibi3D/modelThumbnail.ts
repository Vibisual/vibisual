import * as THREE from 'three';
import { APP_THUMB } from '@vibisual/shared';

import type { AppThumbnail, AppThumbnailRequest } from '../../apps/registry.js';
import { canvasObjectUrl } from '../../apps/thumbnailBake.js';
import { workspaceMediaSize } from '../../utils/workspaceMedia.js';
import { disposeModel, loadWorkspaceModel } from './modelIO.js';

/**
 * §5.4 #36 (F) — Vibi3D 노드 화면의 미리보기: 모델을 한 장 찍은 정지 화면.
 *
 * 뷰어와 같은 로더(`loadWorkspaceModel` — 텍스처가 없어도 모델은 연다, (R-5))와 같은 조명·구도(3/4 위에서)로 찍는다.
 * 노드마다 살아 있는 WebGL 문맥을 두지 않는다 — 브라우저는 문맥 수를 한정하고(넘으면 오래된 것부터 잃는다), 캔버스에는
 * 정지 화면이면 충분하다. 찍자마자 렌더러·모델 자원을 버리고 문맥을 돌려준다.
 * 배경은 투명이라 노드의 바탕이 그대로 비친다(그래서 `contain` — 모델을 잘라 내지 않는다).
 */
export async function renderModelThumbnail(req: AppThumbnailRequest): Promise<AppThumbnail | null> {
  const bytes = await workspaceMediaSize(req.projectId, req.file);
  if (bytes === null || bytes <= 0 || bytes > APP_THUMB.modelMaxBytes) return null;
  const model = await loadWorkspaceModel(req.projectId, req.file);
  const canvas = document.createElement('canvas');
  canvas.width = req.width;
  canvas.height = req.height;
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(req.width, req.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(3, 5, 4);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.1), key, model.object);

    const bounds = new THREE.Box3().setFromObject(model.object);
    if (bounds.isEmpty()) return null;
    const center = bounds.getCenter(new THREE.Vector3());
    const extent = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(extent.x, extent.y, extent.z) * 0.5 || 1;
    const camera = new THREE.PerspectiveCamera(40, req.width / req.height, 0.01, 5000);
    const distance = (radius / Math.sin((camera.fov * Math.PI) / 360)) * Math.max(1, 1 / camera.aspect);
    camera.position.copy(center).add(new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(distance * 1.35));
    camera.near = Math.max(0.001, distance / 500);
    camera.far = Math.max(100, distance * 50);
    camera.lookAt(center);
    camera.updateProjectionMatrix();

    renderer.render(scene, camera);
    const url = await canvasObjectUrl(canvas, 'image/png');
    return url ? { kind: 'picture', url, fit: 'contain' } : null;
  } finally {
    disposeModel(model.object);
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
}
