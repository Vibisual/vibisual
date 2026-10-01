// §5.5 #17-25 ⑦ — 라이트박스가 **그림 자체를** 고치는 두 도구(자르기·알파 빼기)의 계산.
//
// 좌표는 imageAnnotate.ts 와 같이 **이미지 natural 픽셀**만 쓴다. 픽셀 연산은 ImageData 와 같은
// 배치(RGBA 8bit · 행 우선)의 `PixelBuffer` 로 받고 **새 버퍼를 돌려준다** — 입력은 건드리지 않는다.
// 되돌리기 스택의 앞 칸이나 미리보기 캐시가 같은 버퍼를 붙들고 있을 수 있어서다.
//
// DOM 없이 단위 테스트로 잠그도록 계산은 전부 위쪽 순수 함수에 두고, 캔버스를 만지는 함수는
// 맨 아래 "브라우저 전용" 절에만 둔다(imageAnnotate.ts 와 같은 규율).

import {
  composeLayers,
  drawAnnotations,
  nextBadgeIndex,
  rasterSize,
  translateAnnotations,
  type Annotation,
  type Box,
  type Point,
  type RasterSource,
  type Size,
} from './imageAnnotate.js';

export interface PixelBuffer {
  width: number;
  height: number;
  /** RGBA 8bit · 행 우선 — ImageData.data 와 같은 배치. */
  data: Uint8ClampedArray<ArrayBuffer>;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Rgba extends Rgb {
  a: number;
}

/** 이 알파 이하는 "투명"으로 본다 — 압축·반올림으로 남은 한두 단계까지 배경으로 친다. */
export const ALPHA_FLOOR = 8;

/** [여백 자동]의 색 허용 오차(0..255). JPEG 잡티 정도는 배경으로 본다. */
export const TRIM_TOLERANCE = 12;

/** [색 빼기] 허용 오차의 기본값(%). */
export const DEFAULT_TOLERANCE_PERCENT = 10;

function clampNum(v: number, min: number, max: number): number {
  // Math.max 가 -0 을 +0 으로 접는다 — 좌표에 -0 이 새면 비교·직렬화가 헷갈린다.
  return Math.min(Math.max(v, min), max);
}

// ─── 자르기 상자 ───

export type CropAspect = 'free' | 'original' | '1:1' | '4:3' | '3:4' | '3:2' | '2:3' | '16:9' | '9:16';

/** 비율 칩 표시 순서 SSOT — 컴포넌트가 이 배열을 그대로 돈다. */
export const CROP_ASPECTS: readonly CropAspect[] = [
  'free',
  'original',
  '1:1',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '16:9',
  '9:16',
];

export type CropShape = 'rect' | 'ellipse';

/** 비율(너비 ÷ 높이). 자유면 null. `original` 은 **지금 바탕**의 비율이다. */
export function aspectRatio(aspect: CropAspect, natural: Size): number | null {
  if (aspect === 'free') return null;
  if (aspect === 'original') return natural.w > 0 && natural.h > 0 ? natural.w / natural.h : null;
  const [a, b] = aspect.split(':').map(Number);
  if (!a || !b) return null;
  return a / b;
}

export function fullBox(natural: Size): Box {
  return { x: 0, y: 0, w: natural.w, h: natural.h };
}

export function isFullBox(box: Box, natural: Size): boolean {
  return box.x === 0 && box.y === 0 && box.w === natural.w && box.h === natural.h;
}

/**
 * 정수 픽셀로 맞추고 그림 안에 가둔다. 너비·높이는 최소 1.
 * 반올림은 **변 단위**로 한다 — 왼쪽 변과 오른쪽 변을 따로 반올림해야, 한쪽 변만 끈 상자의
 * 반대쪽 변이 반올림 때문에 한 칸 밀리지 않는다.
 */
export function clampCropBox(box: Box, natural: Size): Box {
  const W = Math.max(1, Math.round(natural.w));
  const H = Math.max(1, Math.round(natural.h));
  const w = clampNum(Math.round(box.x + box.w) - Math.round(box.x), 1, W);
  const h = clampNum(Math.round(box.y + box.h) - Math.round(box.y), 1, H);
  const x = clampNum(Math.round(box.x), 0, W - w);
  const y = clampNum(Math.round(box.y), 0, H - h);
  return { x, y, w, h };
}

/**
 * 지금 상자 안에서 비율 `ratio` 로 가장 큰 상자 — 가운데를 맞춘다.
 * 비율 칩을 누르는 순간 쓰인다: 상자 밖으로 커지지 않으니 사용자가 잡아 둔 부분을 벗어나지 않는다.
 */
export function fitAspect(box: Box, ratio: number | null, natural: Size): Box {
  if (!ratio || ratio <= 0) return clampCropBox(box, natural);
  let w = box.w;
  let h = w / ratio;
  if (h > box.h) {
    h = box.h;
    w = h * ratio;
  }
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return clampCropBox({ x: cx - w / 2, y: cy - h / 2, w, h }, natural);
}

/** 손잡이 8개 + 안쪽 끌기(`move`) + 상자 밖에서 새로 긋기(`new`). */
export type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move' | 'new';

export type CropEdgeHandle = Exclude<CropHandle, 'move' | 'new'>;

/** 손잡이 그리기 순서 — 시계 방향. */
export const CROP_HANDLES: readonly CropEdgeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export interface CropDrag {
  handle: CropHandle;
  /** 누른 점(natural). */
  start: Point;
  /** 누를 때의 상자. */
  origin: Box;
}

/**
 * 끄는 중의 상자. 손잡이는 누른 점에서 **움직인 만큼만** 변을 옮긴다 — 손잡이 가운데가 아니라
 * 가장자리를 잡아도 변이 포인터로 튀지 않는다. 변은 반대편을 넘어 뒤집히지 않고(최소 1px),
 * 비율이 고정이면 모서리는 맞은편 모서리에, 변은 반대 변과 가로(세로) 가운데에 붙어 자란다.
 */
export function dragCropBox(drag: CropDrag, at: Point, ratio: number | null, natural: Size): Box {
  const W = natural.w;
  const H = natural.h;
  if (W <= 0 || H <= 0) return drag.origin;
  const p = { x: clampNum(at.x, 0, W), y: clampNum(at.y, 0, H) };
  const { handle, start, origin } = drag;
  if (handle === 'move') {
    return clampCropBox({ ...origin, x: origin.x + p.x - start.x, y: origin.y + p.y - start.y }, natural);
  }
  if (handle === 'new') return newCropBox(start, p, ratio, natural);

  const dx = p.x - start.x;
  const dy = p.y - start.y;
  const hasW = handle.includes('w');
  const hasE = handle.includes('e');
  const hasN = handle.includes('n');
  const hasS = handle.includes('s');
  let left = origin.x;
  let top = origin.y;
  let right = origin.x + origin.w;
  let bottom = origin.y + origin.h;

  if (!ratio) {
    if (hasW) left = clampNum(left + dx, 0, right - 1);
    if (hasE) right = clampNum(right + dx, left + 1, W);
    if (hasN) top = clampNum(top + dy, 0, bottom - 1);
    if (hasS) bottom = clampNum(bottom + dy, top + 1, H);
    return clampCropBox({ x: left, y: top, w: right - left, h: bottom - top }, natural);
  }

  if ((hasW || hasE) && (hasN || hasS)) {
    // 모서리 — 맞은편 모서리가 닻이다. 더 많이 바뀐 축이 크기를 정해서, 한 축만 끌어도 줄고 는다.
    const sx = hasE ? 1 : -1;
    const sy = hasS ? 1 : -1;
    const ax = hasE ? left : right;
    const ay = hasS ? top : bottom;
    let w = Math.max(1, sx * ((hasE ? right : left) + dx - ax));
    let h = Math.max(1, sy * ((hasS ? bottom : top) + dy - ay));
    const relW = Math.abs(w / Math.max(1, origin.w) - 1);
    const relH = Math.abs(h / Math.max(1, origin.h) - 1);
    if (relW >= relH) h = w / ratio;
    else w = h * ratio;
    const availW = sx > 0 ? W - ax : ax;
    const availH = sy > 0 ? H - ay : ay;
    if (w > availW) {
      w = availW;
      h = w / ratio;
    }
    if (h > availH) {
      h = availH;
      w = h * ratio;
    }
    w = Math.max(1, w);
    h = Math.max(1, h);
    return clampCropBox({ x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - h, w, h }, natural);
  }

  if (hasW || hasE) {
    // 좌우 변 — 너비를 끌고 높이는 비율로 따라온다. 세로 가운데는 그대로(넘치면 안으로 민다).
    const sx = hasE ? 1 : -1;
    const ax = hasE ? left : right;
    const availW = sx > 0 ? W - ax : ax;
    const w = Math.max(1, Math.min(sx * ((hasE ? right : left) + dx - ax), availW, H * ratio));
    const h = w / ratio;
    const cy = origin.y + origin.h / 2;
    return clampCropBox({ x: sx > 0 ? ax : ax - w, y: cy - h / 2, w, h }, natural);
  }

  // 위아래 변 — 높이를 끌고 너비가 따라온다. 가로 가운데는 그대로.
  const sy = hasS ? 1 : -1;
  const ay = hasS ? top : bottom;
  const availH = sy > 0 ? H - ay : ay;
  const h = Math.max(1, Math.min(sy * ((hasS ? bottom : top) + dy - ay), availH, W / ratio));
  const w = h * ratio;
  const cx = origin.x + origin.w / 2;
  return clampCropBox({ x: cx - w / 2, y: sy > 0 ? ay : ay - h, w, h }, natural);
}

/** 상자 밖에서 새로 긋기 — 누른 점이 닻, 포인터 쪽으로 자란다(비율이면 긴 쪽이 크기를 정한다). */
function newCropBox(start: Point, at: Point, ratio: number | null, natural: Size): Box {
  const dx = at.x - start.x;
  const dy = at.y - start.y;
  const sx = dx < 0 ? -1 : 1;
  const sy = dy < 0 ? -1 : 1;
  let w = Math.abs(dx);
  let h = Math.abs(dy);
  if (ratio) {
    if (w / ratio >= h) h = w / ratio;
    else w = h * ratio;
    const availW = sx > 0 ? natural.w - start.x : start.x;
    const availH = sy > 0 ? natural.h - start.y : start.y;
    if (w > availW) {
      w = availW;
      h = w / ratio;
    }
    if (h > availH) {
      h = availH;
      w = h * ratio;
    }
  }
  return clampCropBox({ x: sx > 0 ? start.x : start.x - w, y: sy > 0 ? start.y : start.y - h, w, h }, natural);
}

/** 화살표 키 — 크기는 두고 위치만 옮긴다. */
export function nudgeCropBox(box: Box, dx: number, dy: number, natural: Size): Box {
  return clampCropBox({ ...box, x: box.x + dx, y: box.y + dy }, natural);
}

export type CropField = 'x' | 'y' | 'w' | 'h';

/**
 * 숫자 칸 하나 → 상자. 너비·높이는 1..그림 크기, 위치는 상자가 그림 밖으로 나가지 않게 가둔다
 * (오른쪽이 넘치면 왼쪽으로 민다). 비율이 고정이면 반대쪽 변이 따라온다.
 */
export function setCropField(
  box: Box,
  field: CropField,
  value: number,
  ratio: number | null,
  natural: Size,
): Box {
  if (!Number.isFinite(value)) return box;
  const v = Math.round(value);
  switch (field) {
    case 'x':
      return clampCropBox({ ...box, x: v }, natural);
    case 'y':
      return clampCropBox({ ...box, y: v }, natural);
    case 'w': {
      let w = clampNum(v, 1, natural.w);
      let h = box.h;
      if (ratio) {
        h = w / ratio;
        if (h > natural.h) {
          h = natural.h;
          w = h * ratio;
        }
      }
      return clampCropBox({ x: box.x, y: box.y, w, h }, natural);
    }
    case 'h': {
      let h = clampNum(v, 1, natural.h);
      let w = box.w;
      if (ratio) {
        w = h * ratio;
        if (w > natural.w) {
          w = natural.w;
          h = w / ratio;
        }
      }
      return clampCropBox({ x: box.x, y: box.y, w, h }, natural);
    }
  }
}

/** 적용할 자르기가 남아 있는가 — 그림 전체를 잡은 사각형은 할 일이 없다. 원형은 전체여도 모서리를 걷는다. */
export function isCropPending(box: Box | null, shape: CropShape, natural: Size): boolean {
  if (!box || natural.w <= 0 || natural.h <= 0) return false;
  return shape === 'ellipse' || !isFullBox(box, natural);
}

// ─── 픽셀 ───

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

/**
 * [색 빼기] — 고른 색을 오차 안에서 투명으로, 오차 바로 바깥 **한 줄 띠**는 거리에 비례해 반투명으로.
 *
 * 띠를 한 줄로 두는 이유: 띠끼리 번지게 두면 배경과 비슷한 넓은 면(옅은 그림자 등)이 통째로
 * 반투명이 된다. 경계의 계단만 누그러뜨리려는 것이지 오차를 넓히려는 것이 아니다.
 * 이미 투명한 픽셀은 번짐이 **지나가는 길**이다 — 원형 자르기 뒤의 귀퉁이에서 시작해도 배경에 닿는다.
 */
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

export function parseHexColor(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return null;
  const int = parseInt(m[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

export function rgbToHex(c: Rgb): string {
  const part = (v: number): string => clampNum(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${part(c.r)}${part(c.g)}${part(c.b)}`;
}

/** 그 형식이 알파를 담는가 — JPEG 는 못 담아 투명이 검게 뭉개진다. */
export function mimeKeepsAlpha(mime: string): boolean {
  const m = mime.trim().toLowerCase();
  return m !== 'image/jpeg' && m !== 'image/jpg';
}

// ─── 편집 한 번(적용 전 미리 계산) ───

export type EditOp =
  | { kind: 'crop'; box: Box; shape: CropShape }
  | { kind: 'key'; color: Rgb; seeds: readonly Point[]; tolerance: number; contiguous: boolean }
  | { kind: 'fill'; color: Rgb };

/** 이 편집이 끝난 그림에 투명을 남기는가 — jpeg 덮어쓰기 판정용. 사각 자르기는 바탕을 따른다. */
export function opLeavesTransparency(op: EditOp | null, baseTransparent: boolean): boolean {
  if (!op) return baseTransparent;
  switch (op.kind) {
    case 'crop':
      return op.shape === 'ellipse' || baseTransparent;
    case 'key':
      return true;
    case 'fill':
      return false;
  }
}

// ─── 브라우저 전용 — 캔버스로 읽고 굽기 ───

/** 세 겹 한 벌을 캔버스 원천으로 — 원본 `<img>`·편집이 만든 캔버스 어느 쪽이든. */
export interface LayerFrame {
  base: RasterSource;
  marks: RasterSource | null;
  items: Annotation[];
  /** 바탕에 투명이 있는가. 원본을 아직 읽지 않았으면 null. */
  transparent: boolean | null;
  /** `marks` 에 구워 넣은 번호 배지 중 가장 큰 번호 — `EditFrame.badgeFloor` 와 같은 값. */
  badgeFloor?: number;
}

export type EditOpOutcome =
  | { ok: true; frame: LayerFrame }
  | { ok: false; reason: 'noMatch' | 'noTransparency' | 'failed' };

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (w <= 0 || h <= 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
}

/** 캔버스로 읽은 RGBA. 다른 출처 그림이라 읽기가 막히면(오염된 캔버스) 던진다. */
export function readPixels(source: RasterSource): PixelBuffer | null {
  const { w, h } = rasterSize(source);
  if (w <= 0 || h <= 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  const image = ctx.getImageData(0, 0, w, h);
  return { width: w, height: h, data: image.data };
}

export function pixelsToCanvas(buf: PixelBuffer): HTMLCanvasElement | null {
  const made = makeCanvas(buf.width, buf.height);
  if (!made) return null;
  made.ctx.putImageData(new ImageData(buf.data, buf.width, buf.height), 0, 0);
  return made.canvas;
}

/** 사각 영역을 새 캔버스로 — 픽셀을 읽지 않고 drawImage 로 옮긴다. */
function cropCanvas(source: RasterSource, box: Box): HTMLCanvasElement | null {
  const made = makeCanvas(box.w, box.h);
  if (!made) return null;
  made.ctx.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  return made.canvas;
}

/** 내접 타원 밖을 투명으로(가장자리는 캔버스의 안티앨리어싱 그대로). 받은 캔버스를 고친다. */
function maskEllipse(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 앞선 표시(구운 겹 + 벡터 주석)만 투명 캔버스 한 장에 — 원형 자르기가 함께 구울 때 쓴다. */
function markLayerCanvas(size: Size, marks: RasterSource | null, items: readonly Annotation[]): HTMLCanvasElement | null {
  if (!marks && items.length === 0) return null;
  const made = makeCanvas(size.w, size.h);
  if (!made) return null;
  if (marks) made.ctx.drawImage(marks, 0, 0, size.w, size.h);
  drawAnnotations(made.ctx, items);
  return made.canvas;
}

/** 원형 자르기가 표시를 구울 때 남길 번호 — 앞서 구운 번호와 지금 목록의 번호 중 큰 것. */
export function bakedBadgeFloor(frame: Pick<LayerFrame, 'items' | 'badgeFloor'>): number {
  return nextBadgeIndex(frame.items, frame.badgeFloor ?? 0) - 1;
}

/**
 * 편집 한 번을 계산한다(커밋하지 않는다). 적용 버튼과 저장 직전의 "적용 안 한 편집 반영"이 **같은
 * 이 함수**를 부른다 — 화면에서 본 것과 저장된 것이 갈리지 않게.
 *
 * - 사각 자르기: 바탕·구운 표시를 잘라 내고 주석은 좌표만 옮긴다.
 * - 원형 자르기: 바탕은 잘라 타원 밖을 걷고, 그때까지의 표시는 한 겹으로 함께 구워 같은 타원으로 걷는다.
 * - 색 빼기·투명 채우기: 바탕에만 닿는다(흰 글자 주석이 "흰색 빼기"에 지워지지 않게).
 *
 * `basePixels` 는 호출부가 캐시해 둔 바탕 픽셀(같은 바탕일 때만) — 없으면 여기서 읽는다.
 */
export function applyEditOp(frame: LayerFrame, op: EditOp, basePixels?: PixelBuffer | null): EditOpOutcome {
  try {
    const size = rasterSize(frame.base);
    if (size.w <= 0 || size.h <= 0) return { ok: false, reason: 'failed' };
    if (op.kind === 'crop') {
      const box = clampCropBox(op.box, size);
      if (op.shape === 'ellipse') {
        const base = cropCanvas(frame.base, box);
        if (!base) return { ok: false, reason: 'failed' };
        maskEllipse(base);
        const layer = markLayerCanvas(size, frame.marks, frame.items);
        const marks = layer ? cropCanvas(layer, box) : null;
        if (marks) maskEllipse(marks);
        // 표시를 구우며 목록을 비운다 — 구운 배지의 번호는 남겨 다음 배지가 그 뒤를 잇게 한다.
        return { ok: true, frame: { base, marks, items: [], transparent: true, badgeFloor: bakedBadgeFloor(frame) } };
      }
      const base = cropCanvas(frame.base, box);
      if (!base) return { ok: false, reason: 'failed' };
      const marks = frame.marks ? cropCanvas(frame.marks, box) : null;
      // 투명이 있던(또는 아직 모르는) 바탕만 다시 잰다 — 잘라 낸 쪽에 투명이 다 몰려 있었을 수 있다.
      // 읽기가 막히면 투명이 있다고 본다 — jpeg 덮어쓰기를 막는 쪽이 안전하다.
      let transparent = frame.transparent !== false;
      if (transparent) {
        try {
          const px = readPixels(base);
          if (px) transparent = hasTransparency(px);
        } catch {
          transparent = true;
        }
      }
      return {
        ok: true,
        frame: {
          base,
          marks,
          items: translateAnnotations(frame.items, -box.x, -box.y),
          transparent,
          ...(frame.badgeFloor ? { badgeFloor: frame.badgeFloor } : {}),
        },
      };
    }
    const px = basePixels ?? readPixels(frame.base);
    if (!px) return { ok: false, reason: 'failed' };
    if (op.kind === 'key') {
      const out = colorKey(px, {
        color: op.color,
        tolerance: op.tolerance,
        contiguous: op.contiguous,
        seeds: op.seeds,
      });
      if (out.changed === 0) return { ok: false, reason: 'noMatch' };
      const base = pixelsToCanvas(out.buffer);
      if (!base) return { ok: false, reason: 'failed' };
      return { ok: true, frame: { ...frame, base, transparent: true } };
    }
    if (!hasTransparency(px)) return { ok: false, reason: 'noTransparency' };
    const base = pixelsToCanvas(flattenAlpha(px, op.color));
    if (!base) return { ok: false, reason: 'failed' };
    return { ok: true, frame: { ...frame, base, transparent: false } };
  } catch {
    // 다른 출처 그림(오염된 캔버스)의 getImageData 등 — 호출부가 "편집할 수 없다"로 알린다.
    return { ok: false, reason: 'failed' };
  }
}

/** [여백 자동]이 볼 합성본의 픽셀 — 화면에 보이는 세 겹 그대로. */
export function readCompositePixels(frame: LayerFrame): PixelBuffer | null {
  const canvas = composeLayers(frame.base, frame.marks, frame.items);
  return canvas ? readPixels(canvas) : null;
}

export async function canvasToBlob(canvas: HTMLCanvasElement, mime: string = 'image/png'): Promise<Blob | null> {
  return await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime);
  });
}
