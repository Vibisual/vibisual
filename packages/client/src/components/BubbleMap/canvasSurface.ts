/**
 * "이 자리는 캔버스인가" — 캔버스 생성 메뉴(커스텀/CMD/Auto 에이전트·파이프라인·워크트리)를 열어도
 * 되는 자리인지 한 곳에서 판정한다. 우클릭(§4)과 터치 롱프레스(§4 v3.22 ①)가 **같은 답**을 써야 한다.
 *
 * 왜 필요한가 — IDE 창·보드 패널 같은 화면 위 창들은 화면에서는 캔버스를 덮고 있지만 **DOM 으로는
 * 캔버스 컨테이너의 자식**이다(`BubbleMap` 의 바깥 div 안에 `<ReactFlow>` 와 나란히 선다). 그래서 그
 * 창 안에서 일어난 터치가 컨테이너까지 거슬러 올라가고, 폰에서 IDE 본문 글자를 꾹 눌러 **선택하려던
 * 손짓이 캔버스 생성 메뉴를 여는** 일이 벌어졌다(사용자 보고). 막는 목록을 늘려 잡으면 새 창이
 * 생길 때마다 같은 사고가 반복되므로, 판정을 뒤집어 **React Flow 안에서 시작한 손짓만** 캔버스로 본다.
 *
 * DOM 없이 단위 테스트할 수 있게 `closest` 하나만 요구한다(테스트 환경이 node 라 Element 가 없다).
 */

/** `Element.closest` 만 쓰는 최소 모양 — 진짜 Element 도 이 모양을 만족한다. */
export interface ClosestTarget {
  closest(selector: string): unknown;
}

/** React Flow 가 그리는 캔버스 전체의 뿌리. 창·패널은 이 밖에 선다. */
export const CANVAS_ROOT_SELECTOR = '.react-flow';

/**
 * 캔버스 안이지만 **생성 메뉴 자리는 아닌** 것들 — 버블(노드) 위, 그리고 조작용 패널
 * (`CanvasControls` 는 React Flow `<Panel>` 이라 `.react-flow__panel` 이 된다) 위.
 */
export const CANVAS_CHROME_SELECTOR =
  '.react-flow__node, .react-flow__controls, .react-flow__minimap, .react-flow__panel, .react-flow__attribution';

/**
 * 이 대상 위에서 캔버스 생성 메뉴를 열어도 되는가.
 *
 * - React Flow 밖(IDE 창·보드 패널·팝업 등) → `false` — 그 안의 글자 선택·스크롤을 방해하지 않는다.
 * - 버블 위·캔버스 조작 패널 위 → `false` — 각자 자기 메뉴가 있다.
 * - 판정할 수 없는 대상(`closest` 없음) → `false` — 애매하면 열지 않는다.
 */
export function isCanvasSurfaceTarget(target: unknown): boolean {
  const el = target as ClosestTarget | null | undefined;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.closest(CANVAS_CHROME_SELECTOR)) return false;
  return !!el.closest(CANVAS_ROOT_SELECTOR);
}
