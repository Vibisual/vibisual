/**
 * "이 자리는 캔버스인가" — 생성 메뉴 판정. 우클릭(§4)과 롱프레스(§4 ①)가 같은 답을 쓴다.
 * IDE 창·보드 패널은 DOM 상 캔버스 컨테이너 자식이라 그 안 길게 누르기가 메뉴를 열었다 — 막는 목록 대신 React Flow 안에서 시작한 손짓만 캔버스로 본다(새 창마다 재발 ❌).
 * `closest` 하나만 요구한다(시험 환경엔 Element 가 없다).
 */

/** `Element.closest` 만 쓰는 최소 모양 — 진짜 Element 도 이 모양을 만족한다. */
export interface ClosestTarget {
  closest(selector: string): unknown;
}

/** React Flow 가 그리는 캔버스 전체의 뿌리. 창·패널은 이 밖에 선다. */
export const CANVAS_ROOT_SELECTOR = '.react-flow';

/**
 * 캔버스 안이지만 메뉴 자리가 아닌 것 — 노드·조작 패널(`.react-flow__panel`). §5.4 #34 — `.react-flow__nodesselection`(`pointer-events: all`)이 빠지면
 * 묶음 우클릭이 만들기 메뉴로 샌다(묶음 메뉴는 `onSelectionContextMenu`).
 */
export const CANVAS_CHROME_SELECTOR =
  '.react-flow__node, .react-flow__nodesselection, .react-flow__controls, .react-flow__minimap, .react-flow__panel, .react-flow__attribution';

/** 남의 판(IDE 세션 버블 지도 §5.5 #17-50)의 뿌리 표식 — 그 판도 `.react-flow` 라 표식이 없으면 지도 빈 곳 우클릭이 캔버스 만들기 메뉴를 연다. */
export const FOREIGN_FLOW_ATTR = 'data-foreign-flow';
const FOREIGN_FLOW_SELECTOR = `[${FOREIGN_FLOW_ATTR}]`;

/** `false`: React Flow 밖(글자 선택·스크롤 방해 ❌) · 남의 판 · 버블·조작 패널 위(각자 메뉴) · `closest` 없는 대상(애매하면 안 연다). */
export function isCanvasSurfaceTarget(target: unknown): boolean {
  const el = target as ClosestTarget | null | undefined;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.closest(FOREIGN_FLOW_SELECTOR)) return false;
  if (el.closest(CANVAS_CHROME_SELECTOR)) return false;
  return !!el.closest(CANVAS_ROOT_SELECTOR);
}
