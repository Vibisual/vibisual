import {
  MENU_VIEWPORT_MARGIN,
  placeCanvasMenu,
  type MenuAnchor,
  type MenuSize,
  type MenuViewport,
} from '../BubbleMap/canvasMenuPlacement.js';

/**
 * 트리거에 매달린 상자를 화면 안에 넣는 순수 계산(렌더 없이 시험). 상자는 `position: fixed` + 잰 크기 — `absolute` 면 폰에서 밀리고 `overflow-hidden` 에 잘린다.
 * 트리거 아래 `gap`, `end`/`start`/`center` 로 변 맞춤. 아래가 모자라면 위로, 둘 다면 넓은 쪽 뒤 당긴다. 여백은 캔버스 메뉴와 같은 `MENU_VIEWPORT_MARGIN`.
 */

export type AnchoredMenuAlign = 'start' | 'end' | 'center';

/** 트리거와 상자 사이 간격(px) — 종전 `mt-1`(헤더 메뉴)·`top-7`(24px 단추 + 4px) 과 같은 값. */
export const ANCHORED_MENU_GAP = 4;

export interface AnchoredMenuPosition {
  left: number;
  top: number;
  /** 아래 자리가 모자라 트리거 위로 뒤집혔는지. */
  side: 'below' | 'above';
}

export function placeAnchoredMenu(
  anchor: MenuAnchor,
  size: MenuSize,
  viewport: MenuViewport,
  align: AnchoredMenuAlign = 'end',
  gap: number = ANCHORED_MENU_GAP,
): AnchoredMenuPosition {
  const belowTop = anchor.top + anchor.height + gap;
  const belowRoom = viewport.top + viewport.height - MENU_VIEWPORT_MARGIN - belowTop;
  const aboveRoom = anchor.top - gap - (viewport.top + MENU_VIEWPORT_MARGIN);
  // 아래에 다 들어가면 아래 — 아니면 더 넓은 쪽(같으면 아래). 위로 뒤집는 것은 아래가 정말 모자랄 때뿐이다.
  const side = belowRoom >= size.height || belowRoom >= aboveRoom ? 'below' : 'above';
  const x = align === 'end'
    ? anchor.left + anchor.width - size.width
    : align === 'center'
      ? anchor.left + anchor.width / 2 - size.width / 2
      : anchor.left;
  const y = side === 'below' ? belowTop : anchor.top - gap - size.height;
  const { left, top } = placeCanvasMenu({ x, y }, size, viewport);
  return { left, top, side };
}
