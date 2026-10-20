/**
 * 루트 캔버스 배치 상자(`LayoutBoundsBox`)의 조절 손잡이 — 변 넷 + 모서리 넷 (SSOT §5.4 #42).
 *
 * 상자는 늘 캔버스 중심에 대칭이라(반폭 hw · 반높이 hh) 한 변을 끌면 맞은편 변도 같이 움직인다.
 * 모서리는 가로·세로를 함께 바꾼다(대각선 조절). 변 띠는 모서리 칸을 비켜 서서, 테두리 둘레의
 * 어느 점이든 손잡이 하나만 받는다 — 종전에는 두 변 띠가 모서리에서 겹치고 바깥 한 칸이 비어
 * 대각선으로 잡을 자리가 없었다.
 *
 * DOM 없는 순수 함수 — 클라 테스트에는 DOM 이 없어 기하를 여기서 고정한다.
 */

export type BoundsHandle = 'n' | 's' | 'w' | 'e' | 'nw' | 'ne' | 'sw' | 'se';

/** 변 띠 두께(캔버스 좌표) — 변을 가운데 두고 안팎으로 반씩. */
export const BOUNDS_EDGE_HIT = 16;
/** 모서리 칸 한 변(캔버스 좌표) — 꼭짓점을 가운데 둔 정사각형. 변 띠보다 넓어야 대각선을 잡기 쉽다. */
export const BOUNDS_CORNER_HIT = 24;
/** 반폭·반높이 상·하한 — store `setLayoutBoundsSize` 의 클램프와 같은 값. */
export const BOUNDS_MIN_HALF = 300;
export const BOUNDS_MAX_HALF = 8000;

/** 그리는 순서 — 변 다음 모서리. 칸이 서로 겹치지 않아 순서는 판정에 영향이 없다. */
export const BOUNDS_HANDLES: readonly BoundsHandle[] = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'];

type Sign = -1 | 0 | 1;

/** 손잡이가 움직이는 축과 방향 — 동·남 +1, 서·북 -1, 안 건드리는 축 0. */
const AXES: Record<BoundsHandle, { readonly x: Sign; readonly y: Sign }> = {
  n: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
  e: { x: 1, y: 0 },
  nw: { x: -1, y: -1 },
  ne: { x: 1, y: -1 },
  sw: { x: -1, y: 1 },
  se: { x: 1, y: 1 },
};

export interface HandleRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function clampHalf(v: number): number {
  return Math.min(BOUNDS_MAX_HALF, Math.max(BOUNDS_MIN_HALF, v));
}

/**
 * 끈 거리(캔버스 좌표) → 새 반폭·반높이. 중심 대칭이라 끈 만큼 반폭이 는다
 * (동쪽 변을 dx 끌면 hw + dx — 서쪽 변도 dx 만큼 바깥으로). 모서리는 두 축을 함께 바꾼다.
 */
export function resizeBounds(
  handle: BoundsHandle,
  start: { hw: number; hh: number },
  dx: number,
  dy: number,
): { hw: number; hh: number } {
  const a = AXES[handle];
  return {
    hw: clampHalf(start.hw + a.x * dx),
    hh: clampHalf(start.hh + a.y * dy),
  };
}

/** 손잡이 칸 — 상자 왼쪽 위가 원점(캔버스 좌표). `width`·`height` 는 상자 크기. */
export function handleRect(handle: BoundsHandle, width: number, height: number): HandleRect {
  const edge = BOUNDS_EDGE_HIT;
  const corner = BOUNDS_CORNER_HIT;
  const a = AXES[handle];
  const x = a.x < 0 ? 0 : width;
  const y = a.y < 0 ? 0 : height;
  if (a.x !== 0 && a.y !== 0) {
    return { left: x - corner / 2, top: y - corner / 2, width: corner, height: corner };
  }
  // 변 띠는 양 끝의 모서리 칸을 비켜 선다
  if (a.y !== 0) {
    return { left: corner / 2, top: y - edge / 2, width: width - corner, height: edge };
  }
  return { left: x - edge / 2, top: corner / 2, width: edge, height: height - corner };
}

/** 손잡이 커서 — 모서리는 대각선(NW·SE 는 `nwse`, NE·SW 는 `nesw`). */
export function handleCursor(
  handle: BoundsHandle,
): 'ns-resize' | 'ew-resize' | 'nwse-resize' | 'nesw-resize' {
  const a = AXES[handle];
  if (a.x === 0) return 'ns-resize';
  if (a.y === 0) return 'ew-resize';
  return a.x === a.y ? 'nwse-resize' : 'nesw-resize';
}
