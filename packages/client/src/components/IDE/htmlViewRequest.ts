/**
 * htmlViewRequest.ts — §5.5 #17-27 ⑬ (j) · ⑮ 편집창 **밖에서** "이 HTML 을 페이지로 보여 달라"고 부르는 자리.
 *
 * 페이지/소스 중 무엇을 보고 있었는지는 편집창이 탭마다 들고 있는 **화면 상태**다(⑮ (a) · (g) 영속화 ❌).
 * 본문 경로 링크의 우클릭 [웹(내부) 열기]는 그 탭이 소스로 돌려져 있어도 페이지를 보여야 하므로, 상태를
 * 스토어로 끌어올리는 대신 **요청만** 흘린다 — 떠 있는 편집창이 제 탭 목록에서 그 경로를 소스 쪽에서 뺀다.
 *
 * 편집창이 아직 없으면 받을 곳이 없지만 할 일도 없다: 새로 뜨는 편집창의 기본값이 이미 페이지다.
 */

type HtmlPageViewListener = (relPath: string) => void;

const listeners = new Set<HtmlPageViewListener>();

/** 그 경로의 탭을 페이지 쪽으로 돌려 달라고 떠 있는 편집창 모두에 알린다. */
export function requestHtmlPageView(relPath: string): void {
  for (const listener of listeners) listener(relPath);
}

/** 편집창이 요청을 받는다. 돌려준 함수로 해제한다(`useEffect` 정리 함수에 그대로 쓴다). */
export function subscribeHtmlPageView(listener: HtmlPageViewListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
