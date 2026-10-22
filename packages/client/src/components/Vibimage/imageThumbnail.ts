import {
  PREVIEW_POLICY, fileFaceExtOf, imageHeaderOrientation, imageHeaderSize, orientedImageSize, previewTooLarge, previewTooManyPixels,
} from '@vibisual/shared';

import type { AppThumbnail, AppThumbnailRequest } from '../../apps/registry.js';
import { bakeCoverPicture } from '../../apps/thumbnailBake.js';
import { THUMB_SKIPPED_TOO_LARGE, type AppThumbnailSkip } from '../../apps/thumbnailSkip.js';
import { fetchWorkspaceMediaBlob, fetchWorkspaceMediaHead, workspaceMediaSize } from '../../utils/workspaceMedia.js';

/**
 * §5.4 #36 (F) — Vibimage 노드 화면의 미리보기: 담긴 그림을 화면 크기로 줄여 구운 한 장.
 *
 * 바이트는 `fetch` 로 받는다 — 패키지 앱(file://)에서 `<img src="/api/…">` 는 IPC 를 타지 않아 빈다. 그 `fetch` 는 패키지 앱에서
 * 흘려 받는 미디어 갈래다(§5.13 40-1 — IPC 처럼 파일 전체를 메인에 모으지 않는다).
 *
 * §5.1 #2-1 (G) ① — **앱을 무겁게 하는 그림은 굽지 않는다.** 크기 상한(`PREVIEW_POLICY.maxBytes` — SVG 는 더 작다 · 그리는
 * 비용이 메인 스레드다)을 먼저 보고, 래스터는 머리만 읽어 픽셀 상한(`imageMaxPixels`)을 넘으면 아이콘으로 둔다. 넘지 않으면
 * **줄여 푼다**(`createImageBitmap` resize — 원본 해상도 비트맵을 들지 않는다).
 *
 * §5.1 #2-1 (G) ⑧ — 줄여 풀 크기는 **EXIF 회전을 세운 뒤의** 가로×세로로 잡는다(돌아간 사진을 필요보다 크게 풀지 않게). SVG 는
 * 원본을 기억 장소에 쥐지 않고 굽는 크기로 한 번 래스터한다(줌할 때마다 메인 스레드가 벡터를 다시 그리지 않게) — 못 하면 종전대로 원본.
 *
 * 크기·픽셀 상한에 걸리면 `null`(못 구웠다)이 아니라 `THUMB_SKIPPED_TOO_LARGE` 를 돌려준다 — 파일 버블이 "미리보기 생략"
 * 툴팁으로 이유를 말한다(2026-10-21 — 픽셀 상한은 이 함수만 알아 종전에는 이유 없이 아이콘만 남았다).
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
