import { APP_THUMB } from '@vibisual/shared';
import type { VideoAsset } from '@vibisual/video';
import { MediabunnyMediaProvider, boundedRangeFetch } from '@vibisual/video/render';

import type { AppThumbnail, AppThumbnailRequest } from '../../apps/registry.js';
import { bakeCoverPicture } from '../../apps/thumbnailBake.js';
import { workspaceMediaUrl } from '../../utils/workspaceMedia.js';

/**
 * §5.4 #36 (F) — Vibistudio 노드 화면의 미리보기: 앞부분 한 프레임 + 길이.
 *
 * 편집 화면과 같은 디코더(Mediabunny 래퍼)를 쓰되 두 가지가 다르다.
 * - **구간을 묶어 읽는다**(`boundedRangeFetch`) — 패키지 앱의 fetch 는 응답을 통째로 싣기 때문에, 끝이 열린 구간 요청이면
 *   대표 프레임 하나에 파일 전체가 건너온다. 묶으면 머리(·꼬리 색인)와 그 프레임 근처만 읽는다.
 * - **첫 프레임이 아니다** — 길이의 10%(최대 1초) 지점. 영상의 첫 프레임은 검은 화면·페이드 인이 흔하다.
 */
const THUMB_ASSET = 'thumb';

function frameSize(frame: CanvasImageSource): { width: number; height: number } | null {
  const f = frame as { width?: unknown; height?: unknown };
  const width = typeof f.width === 'number' ? f.width : 0;
  const height = typeof f.height === 'number' ? f.height : 0;
  return width > 0 && height > 0 ? { width, height } : null;
}

export async function renderVideoThumbnail(req: AppThumbnailRequest): Promise<AppThumbnail | null> {
  const asset: VideoAsset = { id: THUMB_ASSET, kind: 'video', source: { kind: 'file', path: req.file } };
  const media = new MediabunnyMediaProvider({
    assets: { [THUMB_ASSET]: asset },
    loader: { open: async () => workspaceMediaUrl(req.projectId, req.file) },
    maxFrameWidth: req.width,
    fetchFn: boundedRangeFetch(APP_THUMB.videoChunkBytes),
  });
  try {
    const measured = await media.measureDuration(THUMB_ASSET);
    const duration = measured !== null && Number.isFinite(measured) && measured > 0 ? measured : null;
    const at = duration === null ? 0 : Math.min(APP_THUMB.videoSeekMaxSec, duration * APP_THUMB.videoSeekRatio);
    const frame = await media.getFrame(THUMB_ASSET, at);
    if (!frame) return null;
    const size = frameSize(frame);
    if (!size) return null;
    const url = await bakeCoverPicture(frame, size.width, size.height, req);
    if (!url) return null;
    return { kind: 'picture', url, fit: 'cover', ...(duration === null ? {} : { durationSec: duration }) };
  } finally {
    media.dispose();
  }
}
