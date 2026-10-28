/**
 * §5.5 #17-3 고른 글자를 웹에서 검색 — 우클릭 네 자리가 같은 주소를 만들게 한 곳에 둔다(공백 접기 · 상한 자르기 · 빈 글자면 `null`).
 * `window.open(url, '_blank')` 을 main 의 `setWindowOpenHandler` 가 `shell.openExternal` 로 넘긴다 — 새 IPC·REST ❌.
 */

/** 검색어 상한 — 이보다 길면 잘라서 보낸다(검색창이 받는 실용 길이). */
export const WEB_SEARCH_QUERY_LIMIT = 400;

/** 검색 주소 틀 — 엔진이 바뀌면 여기 한 줄만 바뀐다. */
const SEARCH_ENDPOINT = 'https://www.google.com/search?q=';

/**
 * 고른 글자를 검색 주소로. 검색할 것이 남지 않으면 `null`.
 */
export function buildWebSearchUrl(selection: string): string | null {
  const query = normalizeQuery(selection);
  if (query.length === 0) return null;
  return `${SEARCH_ENDPOINT}${encodeURIComponent(query)}`;
}

/** 공백 접기 + 앞뒤 다듬기 + 상한 자르기(자른 끝에 남은 공백도 다시 다듬는다). */
export function normalizeQuery(selection: string): string {
  const folded = selection.replace(/\s+/g, ' ').trim();
  if (folded.length <= WEB_SEARCH_QUERY_LIMIT) return folded;
  return folded.slice(0, WEB_SEARCH_QUERY_LIMIT).trim();
}

/**
 * 고른 글자를 기본 브라우저에서 검색한다. 검색할 것이 없거나 창을 열 수 없으면 `false`
 * (부르는 쪽은 조용히 넘어간다 — 우클릭 한 번에 오류창이 뜨는 편이 더 나쁘다).
 */
export function openWebSearch(selection: string): boolean {
  const url = buildWebSearchUrl(selection);
  if (url === null || typeof window === 'undefined' || typeof window.open !== 'function') return false;
  // 스트림 링크 열기(StreamRenderer)·터미널 링크와 같은 호출 모양 — 창이 막히면 예외만 삼킨다.
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    return false;
  }
  return true;
}
