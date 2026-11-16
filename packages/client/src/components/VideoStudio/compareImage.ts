/**
 * §5.13 (G) 전후 비교 — 이미 찍은 두 스틸을 나란히 한 장으로(왼쪽 = 전, 오른쪽 = 후). 칸 위 띠의 글자는 서버가 지은 라벨 그대로라
 * 번역할 문구가 없다. 합치기는 캔버스 `drawImage` 두 번(엔진 합성·네이티브 코덱)이라 JS 픽셀 반복이 없다 — rust-compute 대상이 아니다.
 */

/** 칸 사이·둘레의 틈과 라벨 띠 높이(그림 픽셀) — 칸 너비에 비례하되 너무 작아지지 않게. */
export const COMPARE_GAP = 8;

export interface CompareLayout {
  readonly width: number;
  readonly height: number;
  readonly band: number;
  readonly fontPx: number;
  /** 두 칸의 그림 자리(라벨 띠 아래). */
  readonly cells: readonly [{ x: number; y: number; width: number; height: number }, { x: number; y: number; width: number; height: number }];
}

/** 두 그림 크기에서 한 장의 배치를 정한다(높이는 큰 쪽에 맞추고 각자 가로세로비를 지킨다). */
export function compareLayout(a: { width: number; height: number }, b: { width: number; height: number }): CompareLayout {
  const h = Math.max(1, Math.round(Math.max(a.height, b.height)));
  const wa = Math.max(1, Math.round(a.height > 0 ? (a.width * h) / a.height : h));
  const wb = Math.max(1, Math.round(b.height > 0 ? (b.width * h) / b.height : h));
  const fontPx = Math.max(12, Math.round(Math.min(wa, wb) * 0.03));
  const band = Math.round(fontPx * 2);
  const gap = COMPARE_GAP;
  const top = gap + band;
  return {
    width: wa + wb + gap * 3,
    height: top + h + gap,
    band,
    fontPx,
    cells: [
      { x: gap, y: top, width: wa, height: h },
      { x: gap * 2 + wa, y: top, width: wb, height: h },
    ],
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('compare frame failed to load'));
    img.src = src;
  });
}

/** 두 그림 → PNG data URL 한 장. 라벨은 칸 위 띠에(그림을 가리지 않게), 넘치면 칸 폭에서 자른다. */
export async function composeCompare(images: readonly string[], labels: readonly string[]): Promise<string> {
  if (images.length !== 2 || !images[0] || !images[1]) throw new Error('compare needs two images');
  const [a, b] = await Promise.all([loadImage(images[0]), loadImage(images[1])]);
  const layout = compareLayout({ width: a.naturalWidth, height: a.naturalHeight }, { width: b.naturalWidth, height: b.naturalHeight });
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.fillStyle = '#0B0E14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = `600 ${layout.fontPx}px ui-monospace, monospace`;
  ctx.textBaseline = 'middle';
  [a, b].forEach((img, i) => {
    const cell = layout.cells[i]!;
    ctx.fillStyle = '#000000';
    ctx.fillRect(cell.x, cell.y, cell.width, cell.height);
    ctx.drawImage(img, cell.x, cell.y, cell.width, cell.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(cell.x, cell.y - layout.band, cell.width, layout.band);
    ctx.clip();
    // 전은 회색, 후는 밝은 글자 — 색이 없어도 BEFORE/AFTER 글자로 읽힌다.
    ctx.fillStyle = i === 0 ? '#9CA3AF' : '#F9FAFB';
    ctx.fillText(labels[i] ?? (i === 0 ? 'BEFORE' : 'AFTER'), cell.x + 4, cell.y - layout.band / 2);
    ctx.restore();
  });
  return canvas.toDataURL('image/png');
}
