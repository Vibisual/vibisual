import { previewTooLarge } from '@vibisual/shared';

import type { AppThumbnail, AppThumbnailRequest } from '../../apps/registry.js';
import { THUMB_SKIPPED_TOO_LARGE, type AppThumbnailSkip } from '../../apps/thumbnailSkip.js';
import { workspaceMediaSize } from '../../utils/workspaceMedia.js';
import { createLiveView, homeAngles, loadLiveModel, type LiveView } from './modelCanvasLive.js';

/**
 * Bakes the same viewport as the interactive face and returns its WebGL context.
 * §5.1 #2-1 (G) ① — 작은 모델만 굽는다(`PREVIEW_POLICY.maxBytes.model`) — 파싱·GPU 올리기가 메인 스레드라 큰 모델이 캔버스를 멈춘다. 끌어 돌려 보기는 `APP_THUMB.modelMaxBytes`.
 */
export async function renderModelThumbnail(req: AppThumbnailRequest): Promise<AppThumbnail | AppThumbnailSkip | null> {
  const bytes = typeof req.bytes === 'number' ? req.bytes : await workspaceMediaSize(req.projectId, req.file);
  // 크기를 모르면 여기서 막지 않는다 — 읽는 쪽(`loadLiveModel`)이 제 상한으로 한 번 더 본다.
  // 기준보다 커서 일부러 굽지 않으면 그 이유를 돌려준다(파일 버블의 "미리보기 생략" 툴팁).
  if (previewTooLarge(req.file, bytes)) return THUMB_SKIPPED_TOO_LARGE;
  const loaded = await loadLiveModel(req.projectId, req.file);
  if (!loaded.ok) return loaded.reason === 'tooLarge' ? THUMB_SKIPPED_TOO_LARGE : null;
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
