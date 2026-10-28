/** htmlViewRequest.ts — §5.5 #17-27 ⑬ (j)·⑮ 편집창 밖의 "이 HTML 을 페이지로" 요청. 페이지/소스는 탭의 화면 상태라(영속화 ❌) 스토어로 안 올리고 요청만 흘린다(편집창이 없으면 기본이 페이지). */

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
