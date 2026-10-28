import { MENU_VIEWPORT_MARGIN, visibleViewport, type MenuSize, type MenuViewport, type ViewportSource } from '../BubbleMap/canvasMenuPlacement.js';

// 보이는 화면을 읽는 함수는 캔버스 메뉴 자리 모듈 한 곳에 있다(머리줄 메뉴·IDE 상자가 같은 기준을 쓴다) — IDE 쪽은 여기서 받아 쓴다.
export { visibleViewport, type ViewportSource };

/**
 * IDE 안 body 포털 상자(우클릭 메뉴·링크 상자·링크 창)의 자리 — `innerHeight` 가 아니라 시각 뷰포트로 잰다(가상 키보드·핀치 때 키보드 밑에 깔린다).
 * 가장자리 여백은 캔버스 메뉴와 한 벌(`MENU_VIEWPORT_MARGIN`).
 */

/** 상자가 넘지 말아야 할 최대 높이(px) — 이보다 크면 상자 안에서 스크롤한다. */
export function viewportMaxHeight(viewport: MenuViewport): number {
  return Math.max(0, viewport.height - MENU_VIEWPORT_MARGIN * 2);
}

/** 앵커 바로 아래 — 모자라면 위로 뒤집고, 위도 모자라면 화면 위끝. 가로는 앵커 왼쪽에 맞춰 화면 안으로. 앵커가 화면 밖이어도(핀치) 상자는 화면 안. */
export function placeBelowAnchor(
  anchor: { left: number; top: number; bottom: number },
  size: MenuSize,
  viewport: MenuViewport,
  gap: number,
): { left: number; top: number } {
  const minLeft = viewport.left + MENU_VIEWPORT_MARGIN;
  const maxLeft = Math.max(minLeft, viewport.left + viewport.width - MENU_VIEWPORT_MARGIN - size.width);
  const minTop = viewport.top + MENU_VIEWPORT_MARGIN;
  const bottomEdge = viewport.top + viewport.height - MENU_VIEWPORT_MARGIN;
  const maxTop = Math.max(minTop, bottomEdge - size.height);
  let top = anchor.bottom + gap;
  if (top + size.height > bottomEdge) top = anchor.top - size.height - gap;
  return {
    left: Math.min(Math.max(minLeft, anchor.left), maxLeft),
    top: Math.min(Math.max(minTop, top), maxTop),
  };
}

/** 리스너를 거는 자리 — 시험이 가짜 창을 넣을 수 있게 필요한 칸만 받는다. */
interface ViewportEvents {
  addEventListener: (type: 'resize', fn: () => void) => void;
  removeEventListener: (type: 'resize', fn: () => void) => void;
  visualViewport?: Pick<VisualViewport, 'addEventListener' | 'removeEventListener'> | null;
}

/** 보이는 화면이 바뀔 때마다(창 크기·가상 키보드·핀치) `update` 를 부른다. 처음 한 번 바로 부르고, 리스너를 떼는 함수를 돌려준다(`useLayoutEffect` 정리용). */
export function followVisibleViewport(update: () => void, win: ViewportEvents = window): () => void {
  update();
  win.addEventListener('resize', update);
  const v = win.visualViewport;
  v?.addEventListener('resize', update);
  v?.addEventListener('scroll', update);
  return () => {
    win.removeEventListener('resize', update);
    v?.removeEventListener('resize', update);
    v?.removeEventListener('scroll', update);
  };
}
