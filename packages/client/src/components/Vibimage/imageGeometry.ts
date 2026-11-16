/**
 * §5.13 (R-9) 레이어 편집기 ③ — 손잡이·회전·붙기의 기하. 문서 좌표(출력 px)만 다루고 DOM 을 모른다.
 * 회전은 상자 가운데 기준 시계 방향(도) — 렌더러 `imageLayerTransform` 과 같은 모형이다.
 */

export interface Point { x: number; y: number }
export interface Box { x: number; y: number; width: number; height: number }
export interface RotatedBox extends Box { rotation?: number }

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const UNIT: Readonly<Record<Handle, readonly [number, number]>> = {
  nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0],
};

const radians = (deg: number): number => (deg * Math.PI) / 180;
export function rotatePoint(p: Point, deg: number): Point {
  if (!deg) return p;
  const c = Math.cos(radians(deg)); const s = Math.sin(radians(deg));
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}
export function boxCenter(b: Box): Point { return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }

/** A point in the box's own (unrotated) frame, origin at its centre → document coordinates. */
export function boxPoint(b: RotatedBox, local: Point): Point {
  const c = boxCenter(b); const p = rotatePoint(local, b.rotation ?? 0);
  return { x: c.x + p.x, y: c.y + p.y };
}
export function handlePoint(b: RotatedBox, handle: Handle): Point {
  const [hx, hy] = UNIT[handle];
  return boxPoint(b, { x: (hx * b.width) / 2, y: (hy * b.height) / 2 });
}
export function boxCorners(b: RotatedBox): Point[] {
  return (['nw', 'ne', 'se', 'sw'] as const).map((h) => handlePoint(b, h));
}
/** The axis-aligned box a rotated layer covers — what alignment, marquee and snapping see. */
export function boxBounds(b: RotatedBox): Box {
  if (!b.rotation) return { x: b.x, y: b.y, width: b.width, height: b.height };
  const corners = boxCorners(b);
  const xs = corners.map((p) => p.x); const ys = corners.map((p) => p.y);
  const x = Math.min(...xs); const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
export function unionBounds(boxes: readonly Box[]): Box | null {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x)); const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width)); const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}
export function boxesIntersect(a: Box, b: Box): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

/**
 * 손잡이 하나를 끈 결과. 맞은편 변(모서리)은 문서 위 제자리에 남고, 회전한 상자도 자기 축으로 늘어난다.
 * `keepAspect` 면 모서리는 더 많이 끈 쪽 배율로, 변 손잡이는 다른 축을 가운데 기준으로 함께 늘린다. 뒤집히지 않고 `min` 에서 멈춘다.
 */
export function resizeBox(start: RotatedBox, handle: Handle, pointer: Point, keepAspect: boolean, min = 1): Box {
  const [hx, hy] = UNIT[handle];
  const rotation = start.rotation ?? 0;
  const c = boxCenter(start);
  const local = rotatePoint({ x: pointer.x - c.x, y: pointer.y - c.y }, -rotation);
  const fx = (-hx * start.width) / 2; const fy = (-hy * start.height) / 2;
  let width = hx ? Math.max(min, hx * (local.x - fx)) : start.width;
  let height = hy ? Math.max(min, hy * (local.y - fy)) : start.height;
  if (keepAspect && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height;
    if (hx && hy) {
      const s = Math.max(width / start.width, height / start.height);
      width = Math.max(min, start.width * s); height = Math.max(min, start.height * s);
    } else if (hx) height = Math.max(min, width / ratio);
    else width = Math.max(min, height * ratio);
  }
  const centre = rotatePoint({ x: hx ? fx + (hx * width) / 2 : 0, y: hy ? fy + (hy * height) / 2 : 0 }, rotation);
  return { x: c.x + centre.x - width / 2, y: c.y + centre.y - height / 2, width, height };
}

/** (-180, 180] — what the rotation field shows and stores. */
export function normalizeAngle(deg: number): number {
  const r = ((deg % 360) + 360) % 360;
  const n = r > 180 ? r - 360 : r;
  return Math.abs(n) < 1e-9 ? 0 : Number(n.toFixed(4));
}
export function pointerAngle(center: Point, pointer: Point): number {
  return (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI;
}
/** 회전 손잡이 — 잡은 순간의 각도 차이만큼 돈다(잡은 자리로 튀지 않는다). `snap` 이면 15° 단위. */
export function rotateDrag(startRotation: number, startAngle: number, angle: number, snap: boolean): number {
  const raw = startRotation + angle - startAngle;
  return normalizeAngle(snap ? Math.round(raw / 15) * 15 : raw);
}

/** 그리기 도구의 끌기 상자 — `square` 면 긴 변에 맞춘 정사각형(끈 방향 유지). */
export function boxFromDrag(a: Point, b: Point, square: boolean): Box {
  let dx = b.x - a.x; let dy = b.y - a.y;
  if (square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side; dy = Math.sign(dy || 1) * side;
  }
  return { x: Math.min(a.x, a.x + dx), y: Math.min(a.y, a.y + dy), width: Math.abs(dx), height: Math.abs(dy) };
}

/** 손잡이 커서 — 회전한 만큼 돌려 네 가지 중 가장 가까운 것. */
export function handleCursor(handle: Handle, rotation = 0): 'ew' | 'nesw' | 'ns' | 'nwse' {
  const base = handle === 'e' || handle === 'w' ? 0 : handle === 'ne' || handle === 'sw' ? 135 : handle === 'n' || handle === 's' ? 90 : 45;
  const options = ['ew', 'nwse', 'ns', 'nesw'] as const;
  const angle = (((base + rotation) % 180) + 180) % 180;
  return options[Math.round(angle / 45) % 4]!;
}

export interface SnapGuide { axis: 'x' | 'y'; at: number; from: number; to: number }
export interface SnapResult { dx: number; dy: number; guides: SnapGuide[] }
const lines = (b: Box, axis: 'x' | 'y'): number[] => axis === 'x'
  ? [b.x, b.x + b.width / 2, b.x + b.width] : [b.y, b.y + b.height / 2, b.y + b.height];

/**
 * 끌어 옮기는 상자를 판 가장자리·가운데와 다른 레이어의 변·가운데에 붙인다(`threshold` 는 문서 단위 — 부르는 쪽이 화면 px 를 배율로 나눈다).
 * 붙은 뒤 겹치는 선마다 안내선을 돌려준다 — 정확히 맞춘 자리는 붙지 않아도(이동 0) 선이 보인다.
 */
export function snapMove(moving: Box, targets: readonly Box[], canvas: { width: number; height: number }, threshold: number): SnapResult {
  const refs: Box[] = [{ x: 0, y: 0, width: canvas.width, height: canvas.height }, ...targets];
  const pick = (axis: 'x' | 'y'): number => {
    let best: number | null = null;
    for (const ref of refs) for (const t of lines(ref, axis)) for (const m of lines(moving, axis)) {
      const d = t - m;
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
    return best ?? 0;
  };
  const dx = pick('x'); const dy = pick('y');
  const moved = { ...moving, x: moving.x + dx, y: moving.y + dy };
  const guides = new Map<string, SnapGuide>();
  for (const axis of ['x', 'y'] as const) {
    for (const ref of refs) for (const t of lines(ref, axis)) {
      if (!lines(moved, axis).some((m) => Math.abs(m - t) < 0.5)) continue;
      const from = axis === 'x' ? Math.min(moved.y, ref.y) : Math.min(moved.x, ref.x);
      const to = axis === 'x' ? Math.max(moved.y + moved.height, ref.y + ref.height) : Math.max(moved.x + moved.width, ref.x + ref.width);
      const key = `${axis}:${Math.round(t * 2) / 2}`;
      const seen = guides.get(key);
      guides.set(key, seen ? { ...seen, from: Math.min(seen.from, from), to: Math.max(seen.to, to) } : { axis, at: t, from, to });
    }
  }
  return { dx, dy, guides: [...guides.values()] };
}
