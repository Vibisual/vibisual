import type { AppThumbnail, AppThumbnailRequest } from '../../apps/registry.js';
import { bakeCoverPicture } from '../../apps/thumbnailBake.js';
import { fetchWorkspaceMediaBlob } from '../../utils/workspaceMedia.js';

/**
 * §5.4 #36 (F) — Vibimage 노드 화면의 미리보기: 담긴 그림을 화면 크기로 줄여 구운 한 장.
 *
 * 바이트는 `fetch` 로 받는다 — 패키지 앱(file://)에서 `<img src="/api/…">` 는 IPC 를 타지 않아 빈다.
 * 벡터(SVG)는 픽셀 크기가 없어 굽지 않고 그대로 건다(blob 의 타입이 `image/svg+xml` 이라 그려진다).
 */
export async function renderImageThumbnail(req: AppThumbnailRequest): Promise<AppThumbnail | null> {
  const blob = await fetchWorkspaceMediaBlob(req.projectId, req.file);
  if (!blob || blob.size === 0) return null;
  if (blob.type === 'image/svg+xml') return { kind: 'picture', url: URL.createObjectURL(blob), fit: 'cover' };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
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
