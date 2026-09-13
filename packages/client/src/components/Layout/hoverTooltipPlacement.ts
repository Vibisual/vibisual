/**
 * 호버 툴팁 박스를 뷰포트 안으로 당기는 순수 계산.
 *
 * `HoverTooltip` 은 `createPortal` 로 body 에 그리므로 좌표가 뷰포트 기준이다 —
 * 좁은 사이드바(w-52) 라벨을 가운데 정렬만 하면 박스 절반이 화면 밖으로 나가고,
 * 목록 맨 아래 행은 아래로 넘친다. 렌더 없이 시험할 수 있게 기하만 여기 둔다.
 */

/** 툴팁 박스와 뷰포트 가장자리 사이에 남길 여백(px). */
export const TOOLTIP_EDGE_MARGIN = 8;
/** 라벨과 툴팁 박스 사이 간격(px). */
export const TOOLTIP_GAP = 4;

export interface TooltipAnchor {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
}

export interface TooltipBoxSize {
  width: number;
  height: number;
}

export interface TooltipViewport {
  width: number;
  height: number;
}

export interface TooltipPlacement {
  left: number;
  top: number;
  /** 아래 자리가 모자라 라벨 위로 뒤집혔는지. */
  flipped: boolean;
}

/**
 * 라벨 아래 가운데를 기본으로, 넘치면 가장자리로 당기고(가로) 위로 뒤집는다(세로).
 * 박스가 뷰포트보다 넓거나 높으면 여백 위치에 붙인다(잘려도 왼쪽/위가 보이는 쪽).
 */
export function placeHoverTooltip(
  anchor: TooltipAnchor,
  box: TooltipBoxSize,
  viewport: TooltipViewport,
): TooltipPlacement {
  const centered = anchor.left + anchor.width / 2 - box.width / 2;
  const maxLeft = viewport.width - box.width - TOOLTIP_EDGE_MARGIN;
  // 박스가 화면보다 넓으면 maxLeft < EDGE_MARGIN 이라 min/max 순서가 뒤집힌다 — 왼쪽 여백 우선.
  const left = Math.max(TOOLTIP_EDGE_MARGIN, Math.min(centered, Math.max(TOOLTIP_EDGE_MARGIN, maxLeft)));

  const below = anchor.bottom + TOOLTIP_GAP;
  const overflowsBelow = below + box.height + TOOLTIP_EDGE_MARGIN > viewport.height;
  const above = anchor.top - TOOLTIP_GAP - box.height;
  // 위로 뒤집어도 안 들어가면(박스가 화면보다 높음) 아래 자리를 그대로 쓴다 — 위가 잘리는 것보다 낫다.
  const canFlip = overflowsBelow && above >= TOOLTIP_EDGE_MARGIN;

  return { left, top: canFlip ? above : below, flipped: canFlip };
}
