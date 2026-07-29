import { CAPTURE_BUBBLE_DEFAULTS, CAPTURE_SNAP } from '@vibisual/shared';

// §5.9 캡처 버블 이어 붙이기(자석 스냅) — 순수 기하 유틸.
//
// 화면 버블을 2~3개 띄워 듀얼/트리플 모니터처럼 쓰려면 "손으로 끌어다 대충 놓아도 변이 딱 붙는"
// 자석이 필요하다. 드래그·리사이즈 중 현재 사각형과 이웃 캡처 버블들을 받아 **보정된 좌표 + 가이드선**
// 을 돌려준다. React·React Flow·store 를 모르는 순수 함수라 단위 테스트로 굳힌다
// (captureWindowManager 와 같은 패턴 — 좌표 계산을 컴포넌트에 두면 회귀를 못 잡는다).
//
// 후보는 두 종류다.
//  · **맞대기(butt)** — 내 변과 상대 변을 0px 간격으로 붙인다(이어 붙이기 본체). 수직/수평으로
//    최소 겹침(MIN_OVERLAP) 이 있을 때만 — 옆을 스치듯 지나가는 먼 버블에 빨려가는 착시 방지.
//  · **정렬(align)** — 왼변/오른변/가운데를 맞춘다(붙지는 않음). 위아래로 쌓을 때 줄을 세워 준다.
// 같은 거리에서 둘이 경합하면 BUTT_BONUS_PX 만큼 맞대기가 이긴다.

export interface SnapRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 스냅이 걸린 축을 사용자에게 보여 주는 가이드선 1개(캔버스 좌표계). */
export interface SnapGuide {
  /** 'x' = 세로선(x 고정, y 구간으로 그림) / 'y' = 가로선(y 고정, x 구간). */
  axis: 'x' | 'y';
  /** 선의 위치 — axis='x' 면 x 좌표, 'y' 면 y 좌표. */
  position: number;
  /** 선을 그릴 구간 시작(axis='x' 면 y). */
  from: number;
  /** 선을 그릴 구간 끝. */
  to: number;
  /** 변이 맞닿는 이어 붙이기면 true, 단순 정렬이면 false(색으로 구분). */
  butt: boolean;
}

export interface SnapResult {
  x: number;
  y: number;
  width: number;
  height: number;
  guides: SnapGuide[];
}

interface Candidate {
  /** 이 후보를 채택했을 때의 값(위치 또는 변 좌표). */
  value: number;
  /** 가이드선을 그릴 좌표. */
  guide: number;
  butt: boolean;
  other: SnapRect;
}

function overlap(a1: number, a2: number, b1: number, b2: number): number {
  return Math.min(a2, b2) - Math.max(a1, b1);
}

/** 후보 중 임계값 안에서 가장 가까운 것(맞대기 가중치 반영). 없으면 null. */
function pick(current: number, candidates: readonly Candidate[], threshold: number): Candidate | null {
  let best: Candidate | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const dist = Math.abs(c.value - current);
    if (dist > threshold) continue;
    const score = dist - (c.butt ? CAPTURE_SNAP.BUTT_BONUS_PX : 0);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** x 축(좌우) 후보 — 맞대기 2 + 정렬 3. */
function xCandidates(r: SnapRect, o: SnapRect): Candidate[] {
  const list: Candidate[] = [];
  const oRight = o.x + o.width;
  if (overlap(r.y, r.y + r.height, o.y, o.y + o.height) >= CAPTURE_SNAP.MIN_OVERLAP) {
    // 내 왼변 ↔ 상대 오른변 / 내 오른변 ↔ 상대 왼변
    list.push({ value: oRight, guide: oRight, butt: true, other: o });
    list.push({ value: o.x - r.width, guide: o.x, butt: true, other: o });
  }
  list.push({ value: o.x, guide: o.x, butt: false, other: o });
  list.push({ value: oRight - r.width, guide: oRight, butt: false, other: o });
  list.push({ value: o.x + o.width / 2 - r.width / 2, guide: o.x + o.width / 2, butt: false, other: o });
  return list;
}

/** y 축(위아래) 후보 — x 축과 대칭. */
function yCandidates(r: SnapRect, o: SnapRect): Candidate[] {
  const list: Candidate[] = [];
  const oBottom = o.y + o.height;
  if (overlap(r.x, r.x + r.width, o.x, o.x + o.width) >= CAPTURE_SNAP.MIN_OVERLAP) {
    list.push({ value: oBottom, guide: oBottom, butt: true, other: o });
    list.push({ value: o.y - r.height, guide: o.y, butt: true, other: o });
  }
  list.push({ value: o.y, guide: o.y, butt: false, other: o });
  list.push({ value: oBottom - r.height, guide: oBottom, butt: false, other: o });
  list.push({ value: o.y + o.height / 2 - r.height / 2, guide: o.y + o.height / 2, butt: false, other: o });
  return list;
}

/** 세로 가이드선 — 두 사각형의 y 범위를 아우른다(어디에 붙었는지 눈으로 잇게). */
function vGuide(position: number, r: SnapRect, o: SnapRect, butt: boolean): SnapGuide {
  return {
    axis: 'x',
    position,
    from: Math.min(r.y, o.y),
    to: Math.max(r.y + r.height, o.y + o.height),
    butt,
  };
}

function hGuide(position: number, r: SnapRect, o: SnapRect, butt: boolean): SnapGuide {
  return {
    axis: 'y',
    position,
    from: Math.min(r.x, o.x),
    to: Math.max(r.x + r.width, o.x + o.width),
    butt,
  };
}

/**
 * 드래그 중 위치 스냅 — 크기는 그대로 두고 x/y 만 보정한다.
 *
 * @param dragged   지금 끌고 있는 사각형(현재 손 위치 기준)
 * @param others    이웃 캡처 버블들(자기 자신 제외)
 * @param threshold 붙는 거리(**캔버스 단위** — 호출부가 화면 px 를 줌으로 나눠 넘긴다)
 */
export function computeCaptureDragSnap(
  dragged: SnapRect,
  others: readonly SnapRect[],
  threshold: number,
): SnapResult {
  if (others.length === 0 || threshold <= 0) {
    return { x: dragged.x, y: dragged.y, width: dragged.width, height: dragged.height, guides: [] };
  }

  const xs: Candidate[] = [];
  const ys: Candidate[] = [];
  for (const o of others) {
    if (o.id === dragged.id) continue;
    xs.push(...xCandidates(dragged, o));
    ys.push(...yCandidates(dragged, o));
  }

  const bestX = pick(dragged.x, xs, threshold);
  const bestY = pick(dragged.y, ys, threshold);
  const snapped: SnapRect = {
    ...dragged,
    x: bestX ? bestX.value : dragged.x,
    y: bestY ? bestY.value : dragged.y,
  };

  const guides: SnapGuide[] = [];
  // 가이드선은 **보정이 끝난** 사각형으로 그린다(선이 실제 이음선과 어긋나지 않게).
  if (bestX) guides.push(vGuide(bestX.guide, snapped, bestX.other, bestX.butt));
  if (bestY) guides.push(hGuide(bestY.guide, snapped, bestY.other, bestY.butt));

  return { x: snapped.x, y: snapped.y, width: snapped.width, height: snapped.height, guides };
}

/** 리사이즈 스냅에서 변 하나를 다룰 때 쓰는 후보 묶음. */
interface EdgeSnap {
  /** 채택된 변 좌표. */
  value: number;
  butt: boolean;
  other: SnapRect;
}

function pickEdge(
  current: number,
  others: readonly SnapRect[],
  threshold: number,
  buttOf: (o: SnapRect) => number,
  alignOf: (o: SnapRect) => number,
  overlapOf: (o: SnapRect) => number,
): EdgeSnap | null {
  const candidates: Candidate[] = [];
  for (const o of others) {
    if (overlapOf(o) >= CAPTURE_SNAP.MIN_OVERLAP) {
      candidates.push({ value: buttOf(o), guide: buttOf(o), butt: true, other: o });
    }
    candidates.push({ value: alignOf(o), guide: alignOf(o), butt: false, other: o });
  }
  const best = pick(current, candidates, threshold);
  return best ? { value: best.value, butt: best.butt, other: best.other } : null;
}

/**
 * 리사이즈 중 변 스냅 — 네 변을 각각 이웃 변에 붙인다(이미 맞아 있으면 값이 그대로라 no-op).
 * NodeResizer 는 어느 핸들을 잡았는지 알려주지 않으므로 네 변을 모두 검사하고, 최소 크기를
 * 깨는 후보는 버린다.
 */
export function computeCaptureResizeSnap(
  rect: SnapRect,
  others: readonly SnapRect[],
  threshold: number,
): SnapResult {
  if (others.length === 0 || threshold <= 0) {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, guides: [] };
  }
  const neighbors = others.filter((o) => o.id !== rect.id);
  const guides: SnapGuide[] = [];
  let { x, y, width, height } = rect;

  const vOverlap = (o: SnapRect): number => overlap(rect.y, rect.y + rect.height, o.y, o.y + o.height);
  const hOverlap = (o: SnapRect): number => overlap(rect.x, rect.x + rect.width, o.x, o.x + o.width);

  // 왼변 — 붙이기: 상대 오른변 / 정렬: 상대 왼변. 오른변은 고정이므로 width 를 반대로 보정.
  const left = pickEdge(x, neighbors, threshold, (o) => o.x + o.width, (o) => o.x, vOverlap);
  if (left) {
    const nextWidth = width + (x - left.value);
    if (nextWidth >= CAPTURE_BUBBLE_DEFAULTS.MIN_WIDTH) {
      x = left.value;
      width = nextWidth;
      guides.push(vGuide(left.value, { ...rect, x, width }, left.other, left.butt));
    }
  }
  // 오른변 — 붙이기: 상대 왼변 / 정렬: 상대 오른변.
  const right = pickEdge(x + width, neighbors, threshold, (o) => o.x, (o) => o.x + o.width, vOverlap);
  if (right) {
    const nextWidth = right.value - x;
    if (nextWidth >= CAPTURE_BUBBLE_DEFAULTS.MIN_WIDTH) {
      width = nextWidth;
      guides.push(vGuide(right.value, { ...rect, x, width }, right.other, right.butt));
    }
  }
  // 위변 / 아래변 — 좌우와 대칭.
  const top = pickEdge(y, neighbors, threshold, (o) => o.y + o.height, (o) => o.y, hOverlap);
  if (top) {
    const nextHeight = height + (y - top.value);
    if (nextHeight >= CAPTURE_BUBBLE_DEFAULTS.MIN_HEIGHT) {
      y = top.value;
      height = nextHeight;
      guides.push(hGuide(top.value, { ...rect, y, height }, top.other, top.butt));
    }
  }
  const bottom = pickEdge(y + height, neighbors, threshold, (o) => o.y, (o) => o.y + o.height, hOverlap);
  if (bottom) {
    const nextHeight = bottom.value - y;
    if (nextHeight >= CAPTURE_BUBBLE_DEFAULTS.MIN_HEIGHT) {
      height = nextHeight;
      guides.push(hGuide(bottom.value, { ...rect, y, height }, bottom.other, bottom.butt));
    }
  }

  return { x, y, width, height, guides };
}
