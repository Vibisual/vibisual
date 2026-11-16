import {
  buildDrawList,
  opRect,
  resolveTransform,
  safeAreaRect,
  type CompositionPropDecl,
  type DrawOp,
  type HitRect,
  type ResolvedTimeline,
  type VideoDoc,
} from '@vibisual/video';

/**
 * §5.13 (V) 37-21 — 미리보기 끌기의 계산(순수 — 화면·React 없음): 화면 ↔ 문서 좌표, 스냅, 비율 고정·회전 크기 조절,
 * 표시 상자 → 아이템 `transform` 환산, 컴포지션 안쪽 값. 상자·안전 영역은 `@vibisual/video` 의 것만 쓴다(검수·배치 요약과 한 출처).
 */

/** 붙는 문턱(화면 px) — 문서 px 로는 배율로 나눈다(맞춤·100% 어느 쪽이든 손에 같은 거리). */
export const SNAP_SCREEN_PX = 6;
/** 이만큼(화면 px) 움직여야 끌기다 — 그 안은 누르기(고르기). */
export const DRAG_START_SCREEN_PX = 4;
/** 터치·펜의 끌기 문턱(화면 px) — 손가락·펜 탭은 몇 px 미끄러진다(플랫폼 터치 슬롭 8dp 안팎보다 조금 넓게, 37-21 (L)). */
export const DRAG_START_COARSE_SCREEN_PX = 10;
/** 끌어 옮긴 상자가 화면 안에 남겨야 할 몫(화면 px) — 다시 잡을 수 있게. */
export const KEEP_INSIDE_SCREEN_PX = 16;
/** 크기 하한(문서 px). */
export const MIN_BOX_DOC_PX = 8;

export type Corner = 'nw' | 'ne' | 'se' | 'sw';
export const CORNERS: readonly Corner[] = ['nw', 'ne', 'se', 'sw'];

export interface Point { readonly x: number; readonly y: number }
export interface FrameSize { readonly width: number; readonly height: number }

/** 모서리가 상자 가운데에서 어느 쪽인가(+1 = 오른쪽·아래). */
const SIGN: Readonly<Record<Corner, { readonly sx: 1 | -1; readonly sy: 1 | -1 }>> = {
  nw: { sx: -1, sy: -1 }, ne: { sx: 1, sy: -1 }, se: { sx: 1, sy: 1 }, sw: { sx: -1, sy: 1 },
};

const EPS = 1e-6;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** 소수 둘째 자리 — 문서에 `123.4567891` 같은 값이 쌓이지 않게(`-0` 도 0 으로). */
function round2(n: number): number {
  return Math.round(n * 100) / 100 + 0;
}

// ─── 화면 ↔ 문서 ───

/** `scale` = 문서 1px 이 화면에서 몇 px 인가(판의 실제 배율). */
export function screenToDoc(clientX: number, clientY: number, origin: { readonly left: number; readonly top: number }, scale: number): Point {
  const s = scale > 0 ? scale : 1;
  return { x: (clientX - origin.left) / s, y: (clientY - origin.top) / s };
}

/** 화면 길이 → 문서 길이. */
export function screenLength(px: number, scale: number): number {
  return px / (scale > 0 ? scale : 1);
}

/** 누른 자리에서 끌기로 볼 만큼 움직였나(화면 px). `pointerType` 은 포인터 이벤트의 것(없거나 모르면 마우스 문턱). */
export function movedEnough(dx: number, dy: number, pointerType?: string): boolean {
  const limit = pointerType === 'touch' || pointerType === 'pen' ? DRAG_START_COARSE_SCREEN_PX : DRAG_START_SCREEN_PX;
  return Math.hypot(dx, dy) >= limit;
}

// ─── 회전 ───

/** 화면 좌표(y 아래)에서 시계 방향 `deg` 도 — CSS `rotate()` 와 같은 식. */
function turn(x: number, y: number, deg: number): Point {
  if (deg === 0) return { x, y };
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
}

/** 가운데를 축으로 돌린 상자의 네 모서리(문서 px). */
export function boxCorners(box: HitRect, rotation: number): Record<Corner, Point> {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const at = (corner: Corner): Point => {
    const p = turn((SIGN[corner].sx * box.width) / 2, (SIGN[corner].sy * box.height) / 2, rotation);
    return { x: cx + p.x, y: cy + p.y };
  };
  return { nw: at('nw'), ne: at('ne'), se: at('se'), sw: at('sw') };
}

/** 돌린 상자를 감싸는 축 정렬 상자. */
export function rotatedBounds(box: HitRect, rotation: number): HitRect {
  if (rotation === 0) return box;
  const pts = Object.values(boxCorners(box, rotation));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** (x, y) 가 돌린 상자 안인가. */
export function insideBox(box: HitRect, rotation: number, x: number, y: number): boolean {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const p = turn(x - cx, y - cy, -rotation);
  return Math.abs(p.x) <= box.width / 2 + EPS && Math.abs(p.y) <= box.height / 2 + EPS;
}

/** 손잡이를 그릴 자리 — 화면 밖 모서리는 화면 가장자리로 당긴다(잡을 수 있게. 크기는 끈 만큼만 바뀐다). */
export function handlePoints(box: HitRect, rotation: number, frame: FrameSize): Record<Corner, Point> {
  const pts = boxCorners(box, rotation);
  const pull = (p: Point): Point => ({ x: clamp(p.x, 0, frame.width), y: clamp(p.y, 0, frame.height) });
  return { nw: pull(pts.nw), ne: pull(pts.ne), se: pull(pts.se), sw: pull(pts.sw) };
}

// ─── 스냅 ───

export type SnapKind = 'center' | 'safe' | 'frame' | 'item';
export interface SnapLine { readonly axis: 'x' | 'y'; readonly at: number; readonly kind: SnapKind }
export interface Snap { readonly dx: number; readonly dy: number; readonly guides: readonly SnapLine[] }
export const NO_SNAP: Snap = { dx: 0, dy: 0, guides: [] };

/**
 * 붙는 선들 — 화면 가운데 · 안전 영역 네 변 · 화면 가장자리 · 지금 시각에 그려지는 다른 아이템의 변과 가운데.
 * 앞에 선 것이 먼저다(같은 자리의 선은 하나만 남는다). `exclude` = 끄는 아이템.
 */
export function snapLines(doc: VideoDoc, timeline: ResolvedTimeline, t: number, exclude: string | null): SnapLine[] {
  const W = doc.size.width;
  const H = doc.size.height;
  const safe = safeAreaRect(doc.size);
  const lines: SnapLine[] = [
    { axis: 'x', at: W / 2, kind: 'center' }, { axis: 'y', at: H / 2, kind: 'center' },
    { axis: 'x', at: safe.x, kind: 'safe' }, { axis: 'x', at: safe.x + safe.width, kind: 'safe' },
    { axis: 'y', at: safe.y, kind: 'safe' }, { axis: 'y', at: safe.y + safe.height, kind: 'safe' },
    { axis: 'x', at: 0, kind: 'frame' }, { axis: 'x', at: W, kind: 'frame' },
    { axis: 'y', at: 0, kind: 'frame' }, { axis: 'y', at: H, kind: 'frame' },
  ];
  for (const op of buildDrawList(doc, timeline, t)) {
    if (op.synthetic || op.kind === 'caption' || op.itemId === exclude) continue;
    const r = opRect(op);
    if (r.width <= 0 || r.height <= 0) continue;
    for (const at of [r.x, r.x + r.width / 2, r.x + r.width]) lines.push({ axis: 'x', at, kind: 'item' });
    for (const at of [r.y, r.y + r.height / 2, r.y + r.height]) lines.push({ axis: 'y', at, kind: 'item' });
  }
  const seen = new Set<string>();
  return lines.filter((line) => {
    const key = `${line.axis}:${Math.round(line.at * 100)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 그 축에서 문턱 안의 가장 가까운 선까지의 거리(없으면 null). 같은 거리면 앞에 선 선. */
function nearest(sources: readonly number[], lines: readonly SnapLine[], axis: 'x' | 'y', threshold: number): number | null {
  let best: number | null = null;
  for (const line of lines) {
    if (line.axis !== axis) continue;
    for (const source of sources) {
      const d = line.at - source;
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best) - EPS)) best = d;
    }
  }
  return best;
}

function touching(sources: readonly number[], lines: readonly SnapLine[], axis: 'x' | 'y'): SnapLine[] {
  return lines.filter((line) => line.axis === axis && sources.some((s) => Math.abs(s - line.at) < 0.01));
}

function snapSources(xs: readonly number[], ys: readonly number[], lines: readonly SnapLine[], threshold: number): Snap {
  if (!(threshold > 0)) return NO_SNAP;
  const dx = nearest(xs, lines, 'x', threshold);
  const dy = nearest(ys, lines, 'y', threshold);
  return {
    dx: dx ?? 0,
    dy: dy ?? 0,
    guides: [
      ...(dx === null ? [] : touching(xs.map((x) => x + dx), lines, 'x')),
      ...(dy === null ? [] : touching(ys.map((y) => y + dy), lines, 'y')),
    ],
  };
}

/** 옮긴 상자의 변·가운데를 선에 붙인다 — 더할 거리와 붙은 선. `threshold` 는 문서 px(0 이면 붙지 않는다). */
export function snapMove(box: HitRect, lines: readonly SnapLine[], threshold: number): Snap {
  return snapSources(
    [box.x, box.x + box.width / 2, box.x + box.width],
    [box.y, box.y + box.height / 2, box.y + box.height],
    lines, threshold,
  );
}

/** 그 상자의 변·가운데가 닿아 있는 선만(문서 px `tolerance` 안) — 값의 눈금 때문에 덜 붙은 선은 그리지 않는다. */
export function guidesTouching(box: HitRect, lines: readonly SnapLine[], tolerance: number): SnapLine[] {
  const xs = [box.x, box.x + box.width / 2, box.x + box.width];
  const ys = [box.y, box.y + box.height / 2, box.y + box.height];
  return lines.filter((line) => (line.axis === 'x' ? xs : ys).some((s) => Math.abs(s - line.at) <= tolerance));
}

/**
 * 옮긴 상자가 화면에 `margin`(문서 px)만큼은 걸치게 거리를 줄인다. 이미 그 밖에 있던 상자는 더 멀어지지만 않게 한다.
 */
export function keepReachable(box: HitRect, dx: number, dy: number, frame: FrameSize, margin: number): Point {
  const mx = Math.min(margin, box.width, frame.width);
  const my = Math.min(margin, box.height, frame.height);
  const minDx = mx - (box.x + box.width);
  const maxDx = frame.width - mx - box.x;
  const minDy = my - (box.y + box.height);
  const maxDy = frame.height - my - box.y;
  return {
    x: clamp(dx, Math.min(minDx, 0), Math.max(maxDx, 0)),
    y: clamp(dy, Math.min(minDy, 0), Math.max(maxDy, 0)),
  };
}

// ─── 크기 조절 ───

export interface ResizeOptions {
  /** `Shift` — 처음 비율을 지킨다. */
  readonly keepAspect: boolean;
  /** 크기 하한(문서 px). */
  readonly minSize: number;
}

/** 맞은편 모서리를 붙든 채 크기가 (width, height) 인 상자(회전 전 좌표). */
export function anchoredBox(start: HitRect, rotation: number, corner: Corner, width: number, height: number): HitRect {
  const { sx, sy } = SIGN[corner];
  const cx = start.x + start.width / 2;
  const cy = start.y + start.height / 2;
  const anchor = turn((-sx * start.width) / 2, (-sy * start.height) / 2, rotation);
  const half = turn((sx * width) / 2, (sy * height) / 2, rotation);
  return { x: cx + anchor.x + half.x - width / 2, y: cy + anchor.y + half.y - height / 2, width, height };
}

/** 모서리를 문서 거리 (dx, dy) 만큼 끌었을 때의 상자 — 돌린 아이템은 그 축을 따라 바뀐다. */
export function resizeBox(start: HitRect, rotation: number, corner: Corner, dx: number, dy: number, o: ResizeOptions): HitRect {
  const { sx, sy } = SIGN[corner];
  const local = turn(dx, dy, -rotation);
  let width = start.width + sx * local.x;
  let height = start.height + sy * local.y;
  if (o.keepAspect && start.width > 0 && start.height > 0) {
    const f = Math.max(width / start.width, height / start.height, o.minSize / Math.min(start.width, start.height));
    width = start.width * f;
    height = start.height * f;
  } else {
    width = Math.max(o.minSize, width);
    height = Math.max(o.minSize, height);
  }
  return anchoredBox(start, rotation, corner, width, height);
}

/**
 * 돌리지 않은 상자의 크기 조절 + 스냅 — 움직이는 모서리의 두 변이 선에 붙는다. 비율 고정이면 더 가까운 한 변에 맞추고 비율을 지킨다.
 */
export function resizeBoxSnapped(
  start: HitRect, corner: Corner, dx: number, dy: number, o: ResizeOptions, lines: readonly SnapLine[], threshold: number,
): { readonly box: HitRect; readonly guides: readonly SnapLine[] } {
  const free = resizeBox(start, 0, corner, dx, dy, o);
  if (!(threshold > 0)) return { box: free, guides: [] };
  const { sx, sy } = SIGN[corner];
  const edgeX = sx > 0 ? free.x + free.width : free.x;
  const edgeY = sy > 0 ? free.y + free.height : free.y;
  const anchorX = sx > 0 ? start.x : start.x + start.width;
  const anchorY = sy > 0 ? start.y : start.y + start.height;
  const nx = nearest([edgeX], lines, 'x', threshold);
  const ny = nearest([edgeY], lines, 'y', threshold);
  // 붙인 변이 맞은편을 넘어가면(크기 하한 아래) 그 스냅은 버린다.
  const snappedW = nx === null ? null : (edgeX + nx - anchorX) * sx;
  const snappedH = ny === null ? null : (edgeY + ny - anchorY) * sy;
  const okW = snappedW !== null && snappedW >= o.minSize;
  const okH = snappedH !== null && snappedH >= o.minSize;
  let width = free.width;
  let height = free.height;
  let onX = false;
  let onY = false;
  if (o.keepAspect && start.width > 0 && start.height > 0) {
    const useX = okW && (!okH || Math.abs(nx ?? 0) <= Math.abs(ny ?? 0));
    if (useX) { width = snappedW ?? width; height = (start.height * width) / start.width; onX = true; }
    else if (okH) { height = snappedH ?? height; width = (start.width * height) / start.height; onY = true; }
  } else {
    if (okW) { width = snappedW ?? width; onX = true; }
    if (okH) { height = snappedH ?? height; onY = true; }
  }
  const box = anchoredBox(start, 0, corner, width, height);
  const movedX = sx > 0 ? box.x + box.width : box.x;
  const movedY = sy > 0 ? box.y + box.height : box.y;
  return { box, guides: [...(onX ? touching([movedX], lines, 'x') : []), ...(onY ? touching([movedY], lines, 'y') : [])] };
}

// ─── 표시 상자 → 아이템 transform ───

export interface MovePatch { readonly x: number; readonly y: number }
export interface BoxPatch extends MovePatch { readonly width: number; readonly height: number }

/** 옮기기 — 적힌 배치에 거리를 더한다(키프레임·전환은 얹는 값이라 그대로 따라온다). */
export function movedTransform(op: DrawOp, size: FrameSize, dx: number, dy: number): MovePatch {
  const base = resolveTransform(size, op.resolved.item.transform);
  return { x: round2(base.x + dx), y: round2(base.y + dy) };
}

/**
 * 그 시각의 표시 상자(회전 전 · 배율 반영)를 적을 배치 칸으로 — 키프레임·전환이 얹은 이동과 배율을 도로 뺀다. 배율이 0 이면 null.
 */
export function boxTransform(op: DrawOp, size: FrameSize, box: HitRect): BoxPatch | null {
  const scale = op.transform.scale;
  if (!(scale > 0)) return null;
  const base = resolveTransform(size, op.resolved.item.transform);
  const width = box.width / scale;
  const height = box.height / scale;
  return {
    x: round2(box.x - (width - box.width) / 2 - (op.transform.x - base.x)),
    y: round2(box.y - (height - box.height) / 2 - (op.transform.y - base.y)),
    width: round2(width),
    height: round2(height),
  };
}

// ─── 컴포지션 안쪽 요소 — 위치·크기를 값으로 선언한 것 ───

export type BoxAxis = 'x' | 'y' | 'w' | 'h';
export type BoxNames = Readonly<Partial<Record<BoxAxis, string>>>;

/** 값 한 칸의 지금 값과 선언(범위·눈금). */
export interface BoxValue {
  readonly name: string;
  readonly value: number;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly step: number;
}

export interface InnerBoxValues {
  readonly values: Readonly<Partial<Record<BoxAxis, BoxValue>>>;
  /** `x`·`y` 가운데 하나라도 값이면 옮길 수 있다. */
  readonly move: boolean;
  /** 띄울 모서리 손잡이 — 넷이 다 값이면 네 모서리, `w`·`h` 만이면 오른쪽 아래. */
  readonly corners: readonly Corner[];
}

function boxValue(name: string | undefined, decls: readonly CompositionPropDecl[], props: Readonly<Record<string, unknown>>): BoxValue | undefined {
  if (!name) return undefined;
  const decl = decls.find((d) => d.name === name);
  if (!decl || decl.type !== 'number') return undefined;
  const raw = props[name];
  const fallback = typeof decl.default === 'number' && Number.isFinite(decl.default) ? decl.default : 0;
  return {
    name,
    value: typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback,
    min: decl.min,
    max: decl.max,
    step: decl.step !== undefined && decl.step > 0 ? decl.step : 1,
  };
}

/**
 * 요소가 가리킨 값 이름 가운데 그 컴포지션이 `number` 로 **선언한** 것만 남긴다(값은 값 손잡이와 같은 자리 — `props[이름]`, 없으면 선언 기본값).
 * 하나도 없으면 null(손잡이 없음).
 */
export function innerBoxValues(doc: VideoDoc, itemId: string, names: BoxNames): InnerBoxValues | null {
  const item = doc.tracks.flatMap((track) => track.items).find((i) => i.id === itemId);
  if (!item || item.kind !== 'composition') return null;
  const decls = (item.assetId ? doc.assets[item.assetId]?.propsDecl : undefined) ?? [];
  const props = item.props ?? {};
  const x = boxValue(names.x, decls, props);
  const y = boxValue(names.y, decls, props);
  const w = boxValue(names.w, decls, props);
  const h = boxValue(names.h, decls, props);
  if (!x && !y && !w && !h) return null;
  const corners: readonly Corner[] = x && y && w && h ? CORNERS : w || h ? ['se'] : [];
  return { values: { ...(x ? { x } : {}), ...(y ? { y } : {}), ...(w ? { w } : {}), ...(h ? { h } : {}) }, move: !!(x || y), corners };
}

function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : Math.min(4, text.length - dot - 1);
}

/** 값 한 칸을 문서 거리만큼 — `unit` = 값 1 이 문서에서 몇 px 인가. 선언의 눈금·범위를 지킨다. */
export function movedValue(v: BoxValue, docDelta: number, unit: number): number {
  const raw = v.value + (unit > 0 ? docDelta / unit : 0);
  const stepped = Math.round(raw / v.step) * v.step;
  return Number(clamp(stepped, v.min ?? -Infinity, v.max ?? Infinity).toFixed(decimalsOf(v.step))) + 0;
}
