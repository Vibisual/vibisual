/**
 * §5.4 #36 (F) — 그림 한 장을 위성 화면 크기로 구운 blob URL(덮는 크기까지만 줄이고 키우지 않는다 — 원본이면 노드마다 원본 해상도로 디코딩돼 남는다).
 * URL 은 기억 장소가 밀어낼 때 되돌린다(`appThumbnails.ts`). (G) ⑧ — SVG 는 `upscale` 로 굽는 크기까지 키운다(벡터라 흐려지지 않는다).
 */
export async function bakeCoverPicture(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  target: { readonly width: number; readonly height: number },
  opts: { readonly upscale?: boolean } = {},
): Promise<string | null> {
  if (!(sourceWidth > 0) || !(sourceHeight > 0) || !(target.width > 0) || !(target.height > 0)) return null;
  const cover = Math.max(target.width / sourceWidth, target.height / sourceHeight);
  const scale = opts.upscale === true ? cover : Math.min(1, cover);
  const w = Math.max(1, Math.round(sourceWidth * scale));
  const h = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, w, h);
  return canvasObjectUrl(canvas, 'image/webp', 0.86);
}

/** 캔버스 → blob URL. 못 만들면 `null`(빈 캔버스·문맥 상실·더럽혀진 캔버스 — `toBlob` 이 던진다). */
export async function canvasObjectUrl(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<string | null> {
  let blob: Blob | null;
  try {
    blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, type, quality);
    });
  } catch {
    return null;
  }
  return blob ? URL.createObjectURL(blob) : null;
}
