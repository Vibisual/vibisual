import { MENU_VIEWPORT_MARGIN, visibleViewport, type MenuSize, type MenuViewport, type ViewportSource } from '../BubbleMap/canvasMenuPlacement.js';

// 보이는 화면을 읽는 함수는 캔버스 메뉴 자리 모듈 한 곳에 있다(머리줄 메뉴·IDE 상자가 같은 기준을 쓴다) — IDE 쪽은 여기서 받아 쓴다.
export { visibleViewport, type ViewportSource };

/**
 * popupPlacement.ts — IDE 안에서 body 로 포털되는 **작은 떠 있는 상자**(우클릭 메뉴·링크 상자·링크 창)의 자리.
 *
 * 왜 따로 두는가: 이 상자들은 저마다 `window.innerWidth/innerHeight` 로 화면 안을 잡았다. 그런데 폰에서
 * 가상 키보드가 올라오면 **보이는 화면**(시각 뷰포트)만 줄고 `innerHeight` 는 그대로라, 아래쪽으로 접힌
 * 상자가 키보드 밑에 깔렸다. 핀치로 확대한 화면도 마찬가지다(보이는 화면이 문서 안에서 옮겨 간다).
 * `IDEContextMenuPanel` 이 이미 시각 뷰포트로 재고 있어, 같은 규칙을 한 곳에 모아 나머지가 따라 쓰게 한다.
 *
 * 가장자리 여백은 캔버스 메뉴와 한 벌이다(`MENU_VIEWPORT_MARGIN`) — 두 벌이면 상자마다 화면 끝에서 띄우는
 * 거리가 달라진다.
 */

/** 상자가 넘지 말아야 할 최대 높이(px) — 이보다 크면 상자 안에서 스크롤한다. */
export function viewportMaxHeight(viewport: MenuViewport): number {
  return Math.max(0, viewport.height - MENU_VIEWPORT_MARGIN * 2);
}

/**
 * 앵커 글자 **바로 아래**에 — 아래가 모자라면 위로 뒤집고, 위도 모자라면 화면 위끝에 붙인다.
 * 가로는 앵커 왼쪽에 맞추되 화면 안으로 접는다. 크기는 재어 본 값(`size`)이다.
 * 앵커가 보이는 화면 밖에 있어도(핀치로 옮겨 간 화면) 상자는 그 화면 안에 선다.
 */
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

/**
 * 보이는 화면이 바뀔 때마다(창 크기 · 가상 키보드 · 핀치 확대·이동) `update` 를 다시 부른다.
 * 처음 한 번은 바로 부르고, 건 리스너를 모두 떼는 함수를 돌려준다(`useLayoutEffect` 의 정리 함수로 그대로 쓴다).
 */
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
