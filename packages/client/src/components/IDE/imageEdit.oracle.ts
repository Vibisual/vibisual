// Frozen pre-Rust pixel implementation. Test oracle only; production never imports this file.
import type { PixelBuffer, Rgb, Rgba } from './imageEdit.js';
import type { Point, Box } from './imageAnnotate.js';
const ALPHA_FLOOR = 8;
const TRIM_TOLERANCE = 12;
const clampNum = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max);
export function pixelAt(buf: PixelBuffer, point: Point): Rgba {
  const x = clampNum(Math.floor(point.x), 0, Math.max(0, buf.width - 1));
  const y = clampNum(Math.floor(point.y), 0, Math.max(0, buf.height - 1));
  const i = (y * buf.width + x) * 4;
  const d = buf.data;
  return { r: d[i] ?? 0, g: d[i + 1] ?? 0, b: d[i + 2] ?? 0, a: d[i + 3] ?? 0 };
}

/**
 * 색 거리 — RGB 세 채널 차이 중 가장 큰 값(0..255).
 * 오차 10% 가 "채널마다 25 단계 이내"로 곧바로 읽혀, 사용자가 슬라이더 결과를 예측하기 쉽다.
 */
export function rgbDistance(a: Rgb, b: Rgb): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}

/** 모든 픽셀의 `color` 까지 거리. 같은 색으로 오차만 바꿔 여러 번 뺄 때(슬라이더) 한 번만 잰다. */
export function colorDistances(buf: PixelBuffer, color: Rgb): Uint8Array {
  const n = buf.width * buf.height;
  const out = new Uint8Array(n);
  const d = buf.data;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const dr = Math.abs((d[i] ?? 0) - color.r);
    const dg = Math.abs((d[i + 1] ?? 0) - color.g);
    const db = Math.abs((d[i + 2] ?? 0) - color.b);
    out[p] = dr > dg ? (dr > db ? dr : db) : dg > db ? dg : db;
  }
  return out;
}

/** 오차 % → 0..255. */
export function toleranceFromPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return clampNum(Math.round(percent * 2.55), 0, 255);
}

/** 경계 띠 기본 너비 — 오차가 클수록 넓게(오차가 크다는 건 경계가 흐리다는 뜻이다). */
export function defaultFeather(tolerance: number): number {
  return 4 + Math.round(tolerance / 2);
}

export interface ColorKeyOptions {
  color: Rgb;
  /** 0..255 — 이 거리 이내는 완전 투명. */
  tolerance: number;
  /** 오차 바로 바깥 띠의 너비 — 이 안은 거리에 비례해 알파를 줄인다. 기본 `defaultFeather`. */
  feather?: number;
  /** true 면 `seeds` 에서 **이어진** 영역만 뺀다(글자 속 같은 색은 남는다). */
  contiguous: boolean;
  /** 번지는 채우기의 출발점(natural). contiguous 일 때만 쓴다. */
  seeds?: readonly Point[];
  /** `colorDistances(buf, color)` 를 미리 잰 값 — 없으면 여기서 잰다. */
  distances?: Uint8Array;
}

export interface ColorKeyResult {
  buffer: PixelBuffer;
  /** 알파가 줄어든 픽셀 수 — 0 이면 "뺄 색이 없다". */
  changed: number;
}

/** [색 빼기] — 오차 안은 투명, 바로 바깥 한 줄 띠만 거리 비례 반투명(번지면 옅은 그림자 면이 통째로 반투명). 투명 픽셀은 번짐이 지나가는 길이다(원형 자르기 귀퉁이에서도 배경에 닿게). */
export function colorKey(buf: PixelBuffer, opts: ColorKeyOptions): ColorKeyResult {
  const { width, height } = buf;
  const n = width * height;
  const src = buf.data;
  const out = new Uint8ClampedArray(src);
  const tol = clampNum(Math.round(opts.tolerance), 0, 255);
  const feather = Math.max(0, Math.round(opts.feather ?? defaultFeather(tol)));
  const band = tol + feather;
  const dist = opts.distances && opts.distances.length === n ? opts.distances : colorDistances(buf, opts.color);
  // 0 = 그대로 · 1 = 완전 투명(오차 안, 또는 이미 투명한 길) · 2 = 경계 띠(알파 비례 감소)
  const mark = new Uint8Array(n);
  const passable = (p: number): boolean => (src[p * 4 + 3] ?? 0) === 0 || (dist[p] ?? 255) <= tol;
  const inBand = (p: number): boolean => (src[p * 4 + 3] ?? 0) > 0 && (dist[p] ?? 255) <= band;

  if (opts.contiguous) {
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;
    const visit = (q: number): void => {
      if (mark[q] === 1) return;
      if (passable(q)) {
        mark[q] = 1;
        queue[tail++] = q;
      } else if (mark[q] === 0 && inBand(q)) {
        mark[q] = 2;
      }
    };
    for (const seed of opts.seeds ?? []) {
      const x = Math.floor(seed.x);
      const y = Math.floor(seed.y);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      visit(y * width + x);
    }
    while (head < tail) {
      const p = queue[head++] ?? 0;
      const x = p % width;
      if (x > 0) visit(p - 1);
      if (x < width - 1) visit(p + 1);
      if (p >= width) visit(p - width);
      if (p + width < n) visit(p + width);
    }
  } else {
    for (let p = 0; p < n; p++) if (passable(p)) mark[p] = 1;
    for (let p = 0; p < n; p++) {
      if (mark[p] !== 0 || !inBand(p)) continue;
      const x = p % width;
      if (
        (x > 0 && mark[p - 1] === 1) ||
        (x < width - 1 && mark[p + 1] === 1) ||
        (p >= width && mark[p - width] === 1) ||
        (p + width < n && mark[p + width] === 1)
      ) {
        mark[p] = 2;
      }
    }
  }

  let changed = 0;
  for (let p = 0; p < n; p++) {
    const m = mark[p];
    if (!m) continue;
    const ai = p * 4 + 3;
    const a = src[ai] ?? 0;
    if (a === 0) continue;
    const next = m === 1 ? 0 : Math.round((a * ((dist[p] ?? 255) - tol)) / (feather + 1));
    if (next < a) {
      out[ai] = next;
      changed++;
    }
  }
  return { buffer: { width, height, data: out }, changed };
}

export interface CornerSample {
  color: Rgb;
  alpha: number;
  /** 그 귀퉁이가 투명(알파 ≤ ALPHA_FLOOR)인가. */
  transparent: boolean;
  /** 같은 색으로 묶인 귀퉁이 좌표 — 번지는 채우기의 출발점. */
  seeds: Point[];
}

/**
 * 네 귀퉁이 중 **가장 많이 겹치는** 색 — 배경 추정. 동률이면 앞 귀퉁이(왼쪽 위 → 오른쪽 위 →
 * 왼쪽 아래 → 오른쪽 아래)가 이긴다. `skipTransparent` 면 투명한 귀퉁이는 후보에서 뺀다
 * ([배경 자동]은 뺄 **색**이 필요하다). 후보가 없으면 null.
 */
export function dominantCorner(
  buf: PixelBuffer,
  tolerance: number,
  opts: { skipTransparent?: boolean } = {},
): CornerSample | null {
  const { width: w, height: h } = buf;
  if (w <= 0 || h <= 0) return null;
  const corners: Point[] = [
    { x: 0, y: 0 },
    { x: w - 1, y: 0 },
    { x: 0, y: h - 1 },
    { x: w - 1, y: h - 1 },
  ];
  const samples = corners.map((pt) => ({ pt, px: pixelAt(buf, pt) }));
  const same = (a: Rgba, b: Rgba): boolean => {
    const ta = a.a <= ALPHA_FLOOR;
    const tb = b.a <= ALPHA_FLOOR;
    if (ta || tb) return ta && tb;
    return Math.abs(a.a - b.a) <= tolerance && rgbDistance(a, b) <= tolerance;
  };
  let best: CornerSample | null = null;
  let bestCount = 0;
  for (const s of samples) {
    const transparent = s.px.a <= ALPHA_FLOOR;
    if (transparent && opts.skipTransparent) continue;
    const group = samples.filter((o) => same(s.px, o.px));
    if (group.length > bestCount) {
      bestCount = group.length;
      best = {
        color: { r: s.px.r, g: s.px.g, b: s.px.b },
        alpha: s.px.a,
        transparent,
        seeds: group.map((g) => g.pt),
      };
    }
  }
  return best;
}

/**
 * [여백 자동] — 귀퉁이 배경색(투명이면 투명)과 다른 픽셀을 모두 감싸는 가장 작은 상자.
 * 그림 전체가 배경이면 null.
 */
export function trimBounds(buf: PixelBuffer, tolerance: number = TRIM_TOLERANCE): Box | null {
  const ref = dominantCorner(buf, tolerance);
  if (!ref) return null;
  const { width: w, height: h, data } = buf;
  const isBg = (x: number, y: number): boolean => {
    const i = (y * w + x) * 4;
    const a = data[i + 3] ?? 0;
    if (ref.transparent) return a <= ALPHA_FLOOR;
    if (Math.abs(a - ref.alpha) > tolerance) return false;
    return (
      Math.abs((data[i] ?? 0) - ref.color.r) <= tolerance &&
      Math.abs((data[i + 1] ?? 0) - ref.color.g) <= tolerance &&
      Math.abs((data[i + 2] ?? 0) - ref.color.b) <= tolerance
    );
  };
  const rowIsBg = (y: number): boolean => {
    for (let x = 0; x < w; x++) if (!isBg(x, y)) return false;
    return true;
  };
  const colIsBg = (x: number, y0: number, y1: number): boolean => {
    for (let y = y0; y <= y1; y++) if (!isBg(x, y)) return false;
    return true;
  };
  let top = 0;
  while (top < h && rowIsBg(top)) top++;
  if (top === h) return null;
  let bottom = h - 1;
  while (bottom > top && rowIsBg(bottom)) bottom--;
  let left = 0;
  while (left < w - 1 && colIsBg(left, top, bottom)) left++;
  let right = w - 1;
  while (right > left && colIsBg(right, top, bottom)) right--;
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

/** [투명 채우기] — 반투명·투명 픽셀을 `bg` 위에 얹은 색으로 메워 알파를 없앤다(알파 합성). */
export function flattenAlpha(buf: PixelBuffer, bg: Rgb): PixelBuffer {
  const out = new Uint8ClampedArray(buf.data);
  for (let i = 0; i < out.length; i += 4) {
    const alpha = out[i + 3] ?? 255;
    if (alpha === 255) continue;
    const a = alpha / 255;
    out[i] = Math.round((out[i] ?? 0) * a + bg.r * (1 - a));
    out[i + 1] = Math.round((out[i + 1] ?? 0) * a + bg.g * (1 - a));
    out[i + 2] = Math.round((out[i + 2] ?? 0) * a + bg.b * (1 - a));
    out[i + 3] = 255;
  }
  return { width: buf.width, height: buf.height, data: out };
}

export function hasTransparency(buf: PixelBuffer): boolean {
  const d = buf.data;
  for (let i = 3; i < d.length; i += 4) if ((d[i] ?? 255) < 255) return true;
  return false;
}

