import type { MaskCircle } from './edgeMaskGeometry.js';

/**
 * §5.4 #31 (K) — 선을 원 안 구간을 뺀 경로로 잘라 그린다(SVG 마스크 ❌). 마스크면 선마다 오프스크린 두 장으로 GPU 래스터가 포화한다
 * (정지 중에도 초당 12~15 프레임, 초점 전환 때 1초 가까이 끊김) — 되돌리지 마라.
 */

/** 3차 베지어. 직선·2차 곡선도 이 꼴로 올려 같은 계산을 탄다. */
export interface CubicCurve {
  x0: number; y0: number;
  x1: number; y1: number;
  x2: number; y2: number;
  x3: number; y3: number;
}

export interface CurveBox { minX: number; minY: number; maxX: number; maxY: number }

export interface ClippedPath {
  /** 원 밖 구간만 남긴 경로. 가려지는 데가 없으면 받은 경로 문자열 그대로, 전부 가려지면 빈 문자열. */
  path: string;
  /** 시작점이 보이는가 — 아니면 시작 표식(marker-start)도 함께 숨긴다. */
  startVisible: boolean;
  /** 끝점이 보이는가 — 아니면 화살촉(marker-end)도 함께 숨긴다(마스크가 화살촉까지 가리던 것과 같다). */
  endVisible: boolean;
}

/** 표본 간격(월드 px). 버블 반지름(최소 십수 px)보다 충분히 작아 원을 건너뛰지 않는다. */
const SAMPLE_STEP = 4;
const MIN_SAMPLES = 8;
const MAX_SAMPLES = 256;
/** 경계 이분 탐색 횟수 — 표본 한 칸을 2^14 로 나눈다(화면에서 1px 의 수천분의 일). */
const REFINE_STEPS = 14;
/** 이보다 짧게 남는 조각(월드 px)은 그리지 않는다 — 원 둘 사이 틈에 점 하나가 뜨지 않게. */
const MIN_SPAN_LENGTH = 0.5;

export function lineCurve(x0: number, y0: number, x1: number, y1: number): CubicCurve {
  return {
    x0, y0,
    x1: x0 + (x1 - x0) / 3, y1: y0 + (y1 - y0) / 3,
    x2: x0 + ((x1 - x0) * 2) / 3, y2: y0 + ((y1 - y0) * 2) / 3,
    x3: x1, y3: y1,
  };
}

/** 2차 → 3차 승격(같은 곡선): C1 = P0 + ⅔(Q − P0), C2 = P2 + ⅔(Q − P2). */
export function quadraticCurve(x0: number, y0: number, qx: number, qy: number, x2: number, y2: number): CubicCurve {
  return {
    x0, y0,
    x1: x0 + ((qx - x0) * 2) / 3, y1: y0 + ((qy - y0) * 2) / 3,
    x2: x2 + ((qx - x2) * 2) / 3, y2: y2 + ((qy - y2) * 2) / 3,
    x3: x2, y3: y2,
  };
}

function pointAt(c: CubicCurve, t: number): [number, number] {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return [a * c.x0 + b * c.x1 + d * c.x2 + e * c.x3, a * c.y0 + b * c.y1 + d * c.y2 + e * c.y3];
}

/** 조절점 넷을 감싸는 상자 — 베지어는 언제나 조절점의 볼록 껍질 안에 있으므로 곡선을 다 덮는다. */
export function curveBox(c: CubicCurve): CurveBox {
  return {
    minX: Math.min(c.x0, c.x1, c.x2, c.x3),
    minY: Math.min(c.y0, c.y1, c.y2, c.y3),
    maxX: Math.max(c.x0, c.x1, c.x2, c.x3),
    maxY: Math.max(c.y0, c.y1, c.y2, c.y3),
  };
}

/** 출발 버블은 뺀다 — 선이 거기서 뻗어 나와야 한다. 상자가 닿지 않는 원은 곡선과 만날 수 없다. */
export function occludersFor(circles: readonly MaskCircle[], box: CurveBox, excludeId: string): MaskCircle[] {
  const picked: MaskCircle[] = [];
  for (const circle of circles) {
    if (circle.id === excludeId) continue;
    if (circle.cx + circle.r < box.minX || circle.cx - circle.r > box.maxX) continue;
    if (circle.cy + circle.r < box.minY || circle.cy - circle.r > box.maxY) continue;
    picked.push(circle);
  }
  return picked;
}

function insideAny(c: CubicCurve, t: number, circles: readonly MaskCircle[]): boolean {
  const [x, y] = pointAt(c, t);
  for (const circle of circles) {
    const dx = x - circle.cx;
    const dy = y - circle.cy;
    if (dx * dx + dy * dy < circle.r * circle.r) return true;
  }
  return false;
}

/** 조절점 다각형과 현의 평균 — 길이의 위·아래 경계 사이라 표본 수를 정하기에 충분하다. */
function approxLength(c: CubicCurve): number {
  const chord = Math.hypot(c.x3 - c.x0, c.y3 - c.y0);
  const polygon = Math.hypot(c.x1 - c.x0, c.y1 - c.y0) + Math.hypot(c.x2 - c.x1, c.y2 - c.y1) + Math.hypot(c.x3 - c.x2, c.y3 - c.y2);
  return (chord + polygon) / 2;
}

/** a(바깥/안) 에서 b(반대) 사이의 경계 t — 원 합집합의 안팎이 바뀌는 자리. */
function boundary(c: CubicCurve, circles: readonly MaskCircle[], a: number, b: number, insideAtA: boolean): number {
  let lo = a;
  let hi = b;
  for (let i = 0; i < REFINE_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (insideAny(c, mid, circles) === insideAtA) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** 곡선이 모든 원 **밖**에 있는 매개변수 구간들(0~1, 차례대로). 원이 없으면 `[[0, 1]]`. */
export function visibleSpans(c: CubicCurve, circles: readonly MaskCircle[]): Array<[number, number]> {
  if (circles.length === 0) return [[0, 1]];
  const length = approxLength(c);
  const samples = Math.min(MAX_SAMPLES, Math.max(MIN_SAMPLES, Math.ceil(length / SAMPLE_STEP)));
  const spans: Array<[number, number]> = [];
  let prevT = 0;
  let prevInside = insideAny(c, 0, circles);
  let spanStart: number | null = prevInside ? null : 0;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const inside = insideAny(c, t, circles);
    if (inside !== prevInside) {
      const edge = boundary(c, circles, prevT, t, prevInside);
      if (inside) {
        if (spanStart !== null) spans.push([spanStart, edge]);
        spanStart = null;
      } else {
        spanStart = edge;
      }
    }
    prevT = t;
    prevInside = inside;
  }
  if (spanStart !== null) spans.push([spanStart, 1]);
  const minT = length > 0 ? MIN_SPAN_LENGTH / length : 0;
  return spans.filter(([a, b]) => b - a > minT);
}

/** de Casteljau — t0~t1 사이의 부분 곡선(같은 모양, 끝점 접선도 그대로). */
export function subCurve(c: CubicCurve, t0: number, t1: number): CubicCurve {
  const split = (k: CubicCurve, t: number): { left: CubicCurve; right: CubicCurve } => {
    const lerp = (a: number, b: number): number => a + (b - a) * t;
    const ax = lerp(k.x0, k.x1); const ay = lerp(k.y0, k.y1);
    const bx = lerp(k.x1, k.x2); const by = lerp(k.y1, k.y2);
    const cx = lerp(k.x2, k.x3); const cy = lerp(k.y2, k.y3);
    const dx = lerp(ax, bx); const dy = lerp(ay, by);
    const ex = lerp(bx, cx); const ey = lerp(by, cy);
    const fx = lerp(dx, ex); const fy = lerp(dy, ey);
    return {
      left: { x0: k.x0, y0: k.y0, x1: ax, y1: ay, x2: dx, y2: dy, x3: fx, y3: fy },
      right: { x0: fx, y0: fy, x1: ex, y1: ey, x2: cx, y2: cy, x3: k.x3, y3: k.y3 },
    };
  };
  const tail = t0 > 0 ? split(c, t0).right : c;
  if (t1 >= 1) return tail;
  // 뒤쪽을 자를 때는 남은 곡선 안에서의 비율로 다시 잰다.
  return split(tail, t0 > 0 ? (t1 - t0) / (1 - t0) : t1).left;
}

const fmt = (v: number): number => Math.round(v * 100) / 100;

function cubicPath(c: CubicCurve): string {
  return `M ${fmt(c.x0)},${fmt(c.y0)} C ${fmt(c.x1)},${fmt(c.y1)} ${fmt(c.x2)},${fmt(c.y2)} ${fmt(c.x3)},${fmt(c.y3)}`;
}

/** 가리는 데가 없으면 `fullPath` 를 그대로 — 대부분의 선은 렌더 결과가 같다. */
export function clipCurvePath(c: CubicCurve, circles: readonly MaskCircle[], fullPath: string): ClippedPath {
  if (circles.length === 0) return { path: fullPath, startVisible: true, endVisible: true };
  const spans = visibleSpans(c, circles);
  if (spans.length === 1 && spans[0]![0] === 0 && spans[0]![1] === 1) {
    return { path: fullPath, startVisible: true, endVisible: true };
  }
  return {
    path: spans.map(([a, b]) => cubicPath(subCurve(c, a, b))).join(' '),
    startVisible: spans.length > 0 && spans[0]![0] === 0,
    endVisible: spans.length > 0 && spans[spans.length - 1]![1] === 1,
  };
}
