/**
 * §5.13 (T-9) — 프레임 띠: 고르게 고른 시각 N 개의 그림을 **시각이 적힌 격자 한 장**으로 붙인다.
 *
 * 스틸 한 장은 순간을 보여 주고, 띠 한 장은 흐름을 보여 준다(움직이지 않음·빈 칸·급한 끊김이 한눈에). 칸의 시각 글자는
 * 격자 위에 따로 쓴다 — 컴포지션 그림 자체는 건드리지 않는다. 숫자뿐이라 번역할 문구가 없다.
 */

/** 칸 수에 맞는 열 수 — 가로가 조금 긴 격자(8칸 → 4×2, 24칸 → 6×4). */
export function stripColumns(count: number): number {
  if (count <= 1) return 1;
  return Math.min(count, Math.ceil(Math.sqrt(count * 1.5)));
}

/** 칸 사이·둘레의 틈(띠 그림 픽셀). */
export const STRIP_GAP = 6;

/**
 * §5.4 #15 (C) — 띠 그림의 (x, y)(그림 픽셀)가 몇 번째 칸인가. 칸 크기는 `composeStripGrid` 가 그린 그대로 그림 크기에서 되짚는다
 * (가로 = 열 × 칸 + 틈 × (열 + 1)). 틈·바깥이면 null.
 */
export function stripCellAt(
  image: { readonly width: number; readonly height: number },
  count: number,
  x: number,
  y: number,
): { index: number; rect: { x: number; y: number; width: number; height: number } } | null {
  const cells = Math.max(1, count);
  const cols = stripColumns(cells);
  const rows = Math.ceil(cells / cols);
  const cellW = (image.width - (cols + 1) * STRIP_GAP) / cols;
  const cellH = (image.height - (rows + 1) * STRIP_GAP) / rows;
  if (cellW <= 0 || cellH <= 0) return null;
  const col = Math.floor((x - STRIP_GAP) / (cellW + STRIP_GAP));
  const row = Math.floor((y - STRIP_GAP) / (cellH + STRIP_GAP));
  if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
  const left = STRIP_GAP + col * (cellW + STRIP_GAP);
  const top = STRIP_GAP + row * (cellH + STRIP_GAP);
  const index = row * cols + col;
  if (index >= cells || x > left + cellW || y > top + cellH) return null;
  return { index, rect: { x: left, y: top, width: cellW, height: cellH } };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('strip frame failed to load'));
    img.src = src;
  });
}

export async function composeStripGrid(images: readonly string[], times: readonly number[], maxEdge: number): Promise<string> {
  const loaded = await Promise.all(images.map((src) => (src ? loadImage(src) : Promise.resolve(null))));
  const first = loaded.find((img): img is HTMLImageElement => img !== null);
  const aspect = first && first.naturalHeight > 0 ? first.naturalWidth / first.naturalHeight : 16 / 9;
  const count = Math.max(1, images.length);
  const cols = stripColumns(count);
  const rows = Math.ceil(count / cols);
  const gap = STRIP_GAP;
  // 큰 변이 maxEdge 안에 들도록 칸 크기를 정한다.
  const cellW0 = 320;
  const cellH0 = cellW0 / aspect;
  const fullW = cols * cellW0 + (cols + 1) * gap;
  const fullH = rows * cellH0 + (rows + 1) * gap;
  const scale = Math.min(1, maxEdge / Math.max(fullW, fullH));
  const cellW = Math.max(16, Math.floor(cellW0 * scale));
  const cellH = Math.max(9, Math.floor(cellH0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cols * cellW + (cols + 1) * gap;
  canvas.height = rows * cellH + (rows + 1) * gap;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.fillStyle = '#0B0E14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const fontPx = Math.max(10, Math.round(cellH * 0.09));
  ctx.font = `600 ${fontPx}px ui-monospace, monospace`;
  ctx.textBaseline = 'middle';
  loaded.forEach((img, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = gap + col * (cellW + gap);
    const y = gap + row * (cellH + gap);
    ctx.fillStyle = '#000000';
    ctx.fillRect(x, y, cellW, cellH);
    if (img) ctx.drawImage(img, x, y, cellW, cellH);
    const label = `${(times[i] ?? 0).toFixed(2)}s`;
    const pad = Math.round(fontPx * 0.4);
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0,0,0,0.66)';
    ctx.fillRect(x + 4, y + 4, tw + pad * 2, fontPx + pad * 2);
    ctx.fillStyle = '#E5E7EB';
    ctx.fillText(label, x + 4 + pad, y + 4 + pad + fontPx / 2);
  });
  return canvas.toDataURL('image/png');
}
