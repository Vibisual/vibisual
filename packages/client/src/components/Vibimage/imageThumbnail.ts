import { PREVIEW_POLICY, fileFaceExtOf, imageHeaderSize, previewTooLarge, previewTooManyPixels } from '@vibisual/shared';

import type { AppThumbnail, AppThumbnailRequest } from '../../apps/registry.js';
import { bakeCoverPicture } from '../../apps/thumbnailBake.js';
import { fetchWorkspaceMediaBlob, fetchWorkspaceMediaHead, workspaceMediaSize } from '../../utils/workspaceMedia.js';

/**
 * §5.4 #36 (F) — Vibimage 노드 화면의 미리보기: 담긴 그림을 화면 크기로 줄여 구운 한 장.
 *
 * 바이트는 `fetch` 로 받는다 — 패키지 앱(file://)에서 `<img src="/api/…">` 는 IPC 를 타지 않아 빈다.
 * 벡터(SVG)는 픽셀 크기가 없어 굽지 않고 그대로 건다(blob 의 타입이 `image/svg+xml` 이라 그려진다).
 *
 * §5.1 #2-1 (G) ① — **앱을 무겁게 하는 그림은 굽지 않는다.** 크기 상한(`PREVIEW_POLICY.maxBytes` — SVG 는 더 작다 · 그리는
 * 비용이 메인 스레드다)을 먼저 보고, 래스터는 머리만 읽어 픽셀 상한(`imageMaxPixels`)을 넘으면 아이콘으로 둔다. 넘지 않으면
 * **줄여 푼다**(`createImageBitmap` resize — 원본 해상도 비트맵을 들지 않는다).
 */
export async function renderImageThumbnail(req: AppThumbnailRequest): Promise<AppThumbnail | null> {
  const bytes = typeof req.bytes === 'number' ? req.bytes : await workspaceMediaSize(req.projectId, req.file);
  if (previewTooLarge(req.file, bytes)) return null;
  const isSvg = fileFaceExtOf(req.file) === '.svg';
  let dims: { width: number; height: number } | null = null;
  if (!isSvg) {
    const head = await fetchWorkspaceMediaHead(req.projectId, req.file, PREVIEW_POLICY.headerBytes);
    dims = head ? imageHeaderSize(head) : null;
    if (previewTooManyPixels(dims)) return null;
  }
  const blob = await fetchWorkspaceMediaBlob(req.projectId, req.file);
  if (!blob || blob.size === 0) return null;
  if (blob.type === 'image/svg+xml') return { kind: 'picture', url: URL.createObjectURL(blob), fit: 'cover' };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, decodeSize(dims, req));
  } catch {
    return null; // 읽지 못하는 형식 — 화면은 아이콘 + 파일 이름으로 대신한다.
  }
  try {
    const url = await bakeCoverPicture(bitmap, bitmap.width, bitmap.height, req);
    return url ? { kind: 'picture', url, fit: 'cover' } : null;
  } finally {
    bitmap.close();
  }
}

/**
 * 줄여 풀 크기 — **짧은 변이 굽는 자리의 긴 변을 덮을 만큼만**, 가로 하나만 준다(세로는 비율대로 — EXIF 회전이 있어도 찌그러지지
 * 않는다). 원본보다 키우지 않고, 크기를 모르면 줄이지 않는다(크기 상한은 이미 봤다).
 */
function decodeSize(
  dims: { width: number; height: number } | null,
  req: Pick<AppThumbnailRequest, 'width' | 'height'>,
): ImageBitmapOptions | undefined {
  if (!dims || req.width <= 0 || req.height <= 0) return undefined;
  const need = Math.max(req.width, req.height);
  const scale = need / Math.min(dims.width, dims.height);
  if (!(scale > 0) || scale >= 1) return undefined;
  return { resizeWidth: Math.max(1, Math.ceil(dims.width * scale)), resizeQuality: 'medium' };
}
