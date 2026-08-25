/**
 * webSearchUrl.ts — §5.5 #17-3 (판올림 번호 발급 대기) **고른 글자를 웹에서 검색**.
 *
 * 우클릭 메뉴 네 자리(스트림 출력 · 입력창 · 편집창 본문 · 내장 터미널)가 **같은 주소**를 만들어야
 * 하므로 조립을 컴포넌트에서 떼어 여기 한 곳에 둔다. 화면 없이 못 박아야 하는 것 셋 —
 *  (a) 줄바꿈·연속 공백은 한 칸으로 접는다(코드 조각을 그대로 넘기면 검색어가 깨진다),
 *  (b) 너무 긴 선택은 상한에서 자른다(주소가 받지 못하는 길이),
 *  (c) 남는 글자가 없으면 `null` — 부르는 쪽은 아무 일도 하지 않는다(빈 검색창을 띄우지 않는다).
 *
 * 창을 여는 길은 이미 있는 것 하나다 — `window.open(url, '_blank')` 은 Electron main 의
 * `setWindowOpenHandler` 가 가로채 `shell.openExternal` 로 **기본 브라우저**에 넘긴다(§7.11 서버
 * 목록 · #17-27 "밖에서 열기" 가 쓰는 그 길). 새 IPC·새 REST 를 만들지 않는다.
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
