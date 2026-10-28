import {
  PREVIEW_POLICY, fileFaceExtOf, imageHeaderOrientation, imageHeaderSize, orientedImageSize, previewTooLarge, previewTooManyPixels,
} from '@vibisual/shared';

import type { AppThumbnail, AppThumbnailRequest } from '../../apps/registry.js';
import { bakeCoverPicture } from '../../apps/thumbnailBake.js';
import { THUMB_SKIPPED_TOO_LARGE, type AppThumbnailSkip } from '../../apps/thumbnailSkip.js';
import { fetchWorkspaceMediaBlob, fetchWorkspaceMediaHead, workspaceMediaSize } from '../../utils/workspaceMedia.js';

/**
 * §5.4 #36 (F) — Vibimage 노드 미리보기(줄여 구운 한 장). 바이트는 `fetch`(패키지 앱에서 `<img src="/api/…">` 는 빈다 — 미디어 갈래, §5.13 40-1).
 * §5.1 #2-1 (G) ① 크기 상한(SVG 는 더 작다) → 래스터는 머리만 읽어 `imageMaxPixels` → 넘지 않으면 `createImageBitmap` resize. ⑧ 크기는 EXIF 회전 뒤 기준.
 * 상한에 걸리면 `null` 이 아니라 `THUMB_SKIPPED_TOO_LARGE` — 파일 버블 툴팁이 이유를 말한다(픽셀 상한은 이 함수만 안다).
 */
export async function renderImageThumbnail(req: AppThumbnailRequest): Promise<AppThumbnail | AppThumbnailSkip | null> {
  const bytes = typeof req.bytes === 'number' ? req.bytes : await workspaceMediaSize(req.projectId, req.file);
  if (previewTooLarge(req.file, bytes)) return THUMB_SKIPPED_TOO_LARGE;
  const isSvg = fileFaceExtOf(req.file) === '.svg';
  let dims: { width: number; height: number } | null = null;
  if (!isSvg) {
    const head = await fetchWorkspaceMediaHead(req.projectId, req.file, PREVIEW_POLICY.headerBytes);
    const raw = head ? imageHeaderSize(head) : null;
    if (previewTooManyPixels(raw)) return THUMB_SKIPPED_TOO_LARGE;
    dims = raw && head ? orientedImageSize(raw, imageHeaderOrientation(head)) : null;
  }
  const blob = await fetchWorkspaceMediaBlob(req.projectId, req.file);
  if (!blob || blob.size === 0) return null;
  if (blob.type === 'image/svg+xml') {
    const baked = await rasterizeVector(blob, req);
    return { kind: 'picture', url: baked ?? URL.createObjectURL(blob), fit: 'cover' };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, thumbnailDecodeSize(dims, req));
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
 * 줄여 풀 크기 — **짧은 변이 굽는 자리의 긴 변을 덮을 만큼만**, 가로 하나만 준다(세로는 비율대로). `dims` 는 EXIF 회전을 세운 뒤의
 * 크기다(브라우저가 세워 푼다). 원본보다 키우지 않고, 크기를 모르면 줄이지 않는다(크기 상한은 이미 봤다).
 */
export function thumbnailDecodeSize(
  dims: { readonly width: number; readonly height: number } | null,
  req: Pick<AppThumbnailRequest, 'width' | 'height'>,
): ImageBitmapOptions | undefined {
  if (!dims || req.width <= 0 || req.height <= 0) return undefined;
  const need = Math.max(req.width, req.height);
  const scale = need / Math.min(dims.width, dims.height);
  if (!(scale > 0) || scale >= 1) return undefined;
  return { resizeWidth: Math.max(1, Math.ceil(dims.width * scale)), resizeQuality: 'medium' };
}

/** SVG 를 굽는 크기로 한 번 래스터한 blob URL — 크기를 모르거나(내재 크기 없음) 그리지 못하면 null. */
async function rasterizeVector(blob: Blob, req: Pick<AppThumbnailRequest, 'width' | 'height'>): Promise<string | null> {
  if (typeof Image === 'undefined') return null;
  const src = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    await img.decode();
    return await bakeCoverPicture(img, img.naturalWidth, img.naturalHeight, req, { upscale: true });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(src);
  }
}
