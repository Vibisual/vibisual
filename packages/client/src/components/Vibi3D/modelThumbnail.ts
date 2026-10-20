import { previewTooLarge } from '@vibisual/shared';

import type { AppThumbnail, AppThumbnailRequest } from '../../apps/registry.js';
import { workspaceMediaSize } from '../../utils/workspaceMedia.js';
import { createLiveView, homeAngles, loadLiveModel, type LiveView } from './modelCanvasLive.js';

/**
 * Bake the same viewport used by the interactive face, then return its WebGL context.
 *
 * §5.1 #2-1 (G) ① — 정지 화면은 **작은 모델만** 굽는다(`PREVIEW_POLICY.maxBytes.model`). 읽기·파싱·GPU 올리기가 메인 스레드라 큰
 * 모델 하나가 캔버스를 멈춘다 — 넘으면 아이콘이다. 사용자가 손을 대는 끌어 돌려 보기는 종전 상한(`APP_THUMB.modelMaxBytes`)이다.
 */
export async function renderModelThumbnail(req: AppThumbnailRequest): Promise<AppThumbnail | null> {
  const bytes = typeof req.bytes === 'number' ? req.bytes : await workspaceMediaSize(req.projectId, req.file);
  // 크기를 모르면 여기서 막지 않는다 — 읽는 쪽(`loadLiveModel`)이 제 상한으로 한 번 더 본다.
  if (previewTooLarge(req.file, bytes)) return null;
  const loaded = await loadLiveModel(req.projectId, req.file);
  if (!loaded.ok) return null;
  let view: LiveView | null = null;
  try {
    view = createLiveView(loaded.model, req.width, req.height, 1, homeAngles());
    const url = await view.snapshot();
    return url ? { kind: 'picture', url, fit: 'contain' } : null;
  } finally {
    view?.dispose();
    loaded.model.dispose();
  }
}
