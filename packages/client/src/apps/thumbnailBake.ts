/**
 * §5.4 #36 (F) — 그림 한 장을 앱 위성 화면 크기에 맞춰 **구운 blob URL** 로. 앱들의 미리보기 로더가 함께 쓴다.
 *
 * 꽉 채워 보일 크기(짧은 변이 화면을 덮는 크기)까지만 줄이고 키우지는 않는다. 원본을 그대로 걸면 큰 사진·4K 프레임이
 * 노드마다 원본 해상도로 디코딩되어 메모리에 남는다 — 화면에는 그 몇십 분의 일만 보인다.
 * 만든 URL 은 미리보기 기억 장소가 밀어낼 때 되돌린다(`appThumbnails.ts`).
 */
export async function bakeCoverPicture(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  target: { readonly width: number; readonly height: number },
): Promise<string | null> {
  if (!(sourceWidth > 0) || !(sourceHeight > 0) || !(target.width > 0) || !(target.height > 0)) return null;
  const scale = Math.min(1, Math.max(target.width / sourceWidth, target.height / sourceHeight));
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

/** 캔버스 → blob URL. 못 만들면 `null`(빈 캔버스·문맥 상실). */
export async function canvasObjectUrl(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<string | null> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
  return blob ? URL.createObjectURL(blob) : null;
}
