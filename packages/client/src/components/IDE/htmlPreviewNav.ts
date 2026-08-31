import { WORKSPACE_SITE_REPORT_MESSAGE, normalizePathShape, parseWorkspaceSitePath } from '@vibisual/shared';

/**
 * htmlPreviewNav.ts — §5.5 #17-27 ⑮ (b) 편집창 속 브라우저의 **주소와 방문 기록** 계산.
 *
 * 화면(JSX)과 통신을 뺀 순수 계산만 둔다 — `editorModel.ts` 와 같은 결이다. 여기 있는 것들은
 * 눈으로 확인하기 어렵고(주소가 한 글자 다른 것은 안 보인다) 잘못되면 증상이 "링크를 눌렀는데
 * 주소가 그대로"처럼 조용하므로, 단위 테스트로 못 박아 두는 편이 훨씬 촘촘하다.
 *
 * **왜 페이지가 스스로 알려 오는가** — 패키지 앱에서 iframe 은 `vibproxy://` 로 뜨고 우리 창은
 * `file://` 이라 두 문서는 서로 다른 오리진이다. 부모가 `contentWindow.location` 을 읽는 것도
 * `history.back()` 을 부르는 것도 SecurityError 다. 그래서 우리가 내보내는 HTML 에 **위치를
 * 알려 주는 한 조각**을 얹고(서버), 부모는 그 신고만 받아 여기서 셈한다 — `previewPicker` 가
 * 프리뷰에서 이미 쓰는 방식 그대로다(새 통로 발명 ❌).
 */

/**
 * 받은 메시지가 **우리 창구 안의 페이지**가 보낸 위치 신고인가.
 *
 * 두 겹으로 거른다: ① 표식이 있는가 ② 그 URL 이 정말 우리 경로형 창구인가. ②가 없으면 아무
 * 페이지나 우리 주소 칸에 제 글자를 적어 넣을 수 있다(iframe 안에는 사용자의 프로젝트 코드가
 * 돌고, 그 안에는 우리가 모르는 스크립트도 있다).
 */
export function readHtmlPreviewReport(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  if (record[WORKSPACE_SITE_REPORT_MESSAGE] !== true) return null;
  const url = record['url'];
  if (typeof url !== 'string' || url.length === 0) return null;
  return sitePathnameOf(url) === null ? null : url;
}

/** URL 문자열에서 우리 창구의 pathname 만. 우리 것이 아니면 null. */
function sitePathnameOf(url: string): string | null {
  let pathname: string;
  try {
    // 상대 URL 로도 올 수 있으므로 기준을 준다(기준은 판정에 쓰이지 않는다).
    pathname = new URL(url, 'http://vibisual.invalid').pathname;
  } catch {
    return null;
  }
  return parseWorkspaceSitePath(pathname) === null ? null : pathname;
}

/**
 * 주소 칸에 적을 글자 — **프로젝트 루트 기준 상대 경로**.
 *
 * 페이지가 아직 아무것도 알려 오지 않았으면(신고가 막혔거나 첫 그림 전) 열었던 그 파일을 적는다.
 * 루트가 우리가 연 루트와 다르면(있을 수 없지만) 열었던 파일로 물러선다 — 남의 경로를 우리
 * 주소 칸에 적지 않는다.
 */
export function htmlPreviewAddress(currentUrl: string | null, root: string, openedRelPath: string): string {
  if (currentUrl === null || currentUrl === '') return openedRelPath;

  let parsed: URL;
  try {
    parsed = new URL(currentUrl, 'http://vibisual.invalid');
  } catch {
    return openedRelPath;
  }
  const site = parseWorkspaceSitePath(parsed.pathname);
  if (!site) return openedRelPath;
  if (normalizePathShape(site.root) !== normalizePathShape(root)) return openedRelPath;

  // 캐시 무력화 토큰(`v`)은 우리가 붙인 것이지 사용자가 볼 것이 아니다 — 나머지 질의만 남긴다.
  const query = new URLSearchParams(parsed.search);
  query.delete('v');
  const rest = query.toString();
  const rel = site.relPath === '' ? '' : site.relPath;
  return `${rel}${rest === '' ? '' : `?${rest}`}${parsed.hash}`;
}

/** 방문 기록 — 우리가 직접 셈한다(iframe 자신의 기록은 오리진이 달라 만질 수 없다). */
export interface HtmlPreviewHistory {
  entries: readonly string[];
  index: number;
}

export const EMPTY_HTML_PREVIEW_HISTORY: HtmlPreviewHistory = { entries: [], index: -1 };

/**
 * 페이지가 알려 온 위치 하나를 기록에 넣는다.
 *
 * 규칙은 브라우저와 같다 — 지금 자리와 같은 곳이면 아무 일도 없고(새로고침은 기록을 늘리지
 * 않는다), 뒤로 간 상태에서 새 곳으로 가면 **앞쪽 기록은 버려진다**. 뒤/앞으로 우리가 옮겨 간
 * 직후에도 페이지는 그 자리를 신고하므로, 그때는 자리만 옮기고 기록을 늘리지 않아야 한다
 * (안 그러면 뒤로 한 번 누를 때마다 기록이 자라 앞으로가 영영 안 켜진다).
 */
export function pushHtmlPreviewHistory(history: HtmlPreviewHistory, url: string): HtmlPreviewHistory {
  const { entries, index } = history;
  if (index >= 0 && entries[index] === url) return history;

  const back = index > 0 ? entries[index - 1] : undefined;
  if (back === url) return { entries, index: index - 1 };
  const forward = index >= 0 && index + 1 < entries.length ? entries[index + 1] : undefined;
  if (forward === url) return { entries, index: index + 1 };

  const kept = index < 0 ? [] : entries.slice(0, index + 1);
  return { entries: [...kept, url], index: kept.length };
}

/** 뒤로 갈 수 있는가 / 앞으로 갈 수 있는가. */
export function canGoBack(history: HtmlPreviewHistory): boolean {
  return history.index > 0;
}
export function canGoForward(history: HtmlPreviewHistory): boolean {
  return history.index >= 0 && history.index + 1 < history.entries.length;
}

/** 한 걸음 옮긴 뒤의 기록과 그 자리의 URL. 갈 수 없으면 `null`(호출부가 아무 일도 하지 않는다). */
export function stepHtmlPreviewHistory(
  history: HtmlPreviewHistory,
  direction: -1 | 1,
): { history: HtmlPreviewHistory; url: string } | null {
  const next = history.index + direction;
  if (next < 0 || next >= history.entries.length) return null;
  const url = history.entries[next];
  if (url === undefined) return null;
  return { history: { entries: history.entries, index: next }, url };
}

/**
 * 그 주소를 **캐시 무력화 토큰과 함께** 다시 연다(⑮ (e)).
 *
 * 저장했는데 화면이 그대로인 것이 이 항목에서 가장 흔한 실패다 — 같은 URL 이면 브라우저가
 * 자기 캐시를 돌려주기 때문이라, 새로 그릴 때는 URL 자체가 달라야 한다. 기존 질의는 그대로
 * 두고 `v` 하나만 갈아 끼운다(페이지가 자기 질의로 동작을 가르는 경우가 있다).
 */
export function withCacheToken(url: string, token: number): string {
  try {
    const parsed = new URL(url, 'http://vibisual.invalid');
    parsed.searchParams.set('v', String(token));
    // 상대 URL 로 들어온 것은 상대로 돌려준다(기준 호스트가 주소에 섞이면 iframe 이 밖으로 나간다).
    return url.startsWith('/') ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.toString();
  } catch {
    return url;
  }
}
