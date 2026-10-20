import {
  MENU_VIEWPORT_MARGIN,
  placeCanvasMenu,
  type MenuAnchor,
  type MenuSize,
  type MenuViewport,
} from '../BubbleMap/canvasMenuPlacement.js';

/**
 * 트리거에 매달려 펼쳐지는 상자(드롭다운·더보기 메뉴·바꾸기 상자)를 화면 안에 넣는 순수 계산.
 *
 * 종전에는 이런 상자들이 트리거 기준 `absolute right-0`/`left-0` 이라 **트리거가 화면 어디에 있든 같은
 * 쪽으로** 펼쳐졌다. 폰(360px)에서는 288px 목록이 화면 왼쪽 밖으로 밀렸고, 지휘통제실 카드 안 메뉴는
 * 카드의 `overflow-hidden` 에 잘려 아래 항목을 누를 수 없었다(데스크톱에서도). 그래서 상자는
 * `position: fixed` 로 띄우고 **실제로 잰 크기**로 자리를 정한다(`useAnchoredMenuPlacement`).
 *
 * 자리가 넉넉하면 결과는 종전과 같다 — 트리거 아래 `gap` 만큼 띄우고 `end` 는 오른쪽 변을, `start` 는
 * 왼쪽 변을, `center` 는 가운데를 트리거에 맞춘다. 아래가 모자라면 위로 뒤집고, 둘 다 모자라면 넓은 쪽을
 * 쓴 뒤 화면 안으로 당긴다. 가장자리 여백은 캔버스 메뉴와 같은 `MENU_VIEWPORT_MARGIN` 이다
 * (두 벌이면 메뉴마다 화면 끝에 붙는 자리가 갈린다). 렌더 없이 시험할 수 있게 기하만 여기 둔다.
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
