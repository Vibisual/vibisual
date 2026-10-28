import { WORKSPACE_SITE_REPORT_MESSAGE, normalizePathShape, parseWorkspaceSitePath } from '@vibisual/shared';

/**
 * htmlPreviewNav.ts — §5.5 #17-27 ⑮ (b) 편집창 속 브라우저의 주소·방문 기록(순수). iframe(`vibproxy://`)과 창(`file://`)은 오리진이 달라
 * location 읽기·`history.back()` 이 SecurityError — 서버가 넣은 신고 조각의 위치만 받아 셈한다(`previewPicker` 와 같은 길).
 */

/** 받은 메시지가 우리 창구 안 페이지의 위치 신고인가 — 표식과 URL(우리 경로형 창구) 둘 다 본다(URL 을 안 보면 iframe 안 아무 스크립트나 주소 칸에 적는다). */
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

/** 주소 칸 글자 — 루트 기준 상대 경로. 신고 전이거나 루트가 다르면 열었던 파일을 적는다(남의 경로 ❌). */
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

/** 알려 온 위치를 기록에 넣는다(브라우저 규칙: 같은 자리면 그대로, 뒤로 간 뒤 새 곳이면 앞쪽 버림). 뒤/앞 이동 직후 신고는 자리만 옮긴다(늘리면 앞으로가 영영 안 켜진다). */
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

/** 캐시 무력화 토큰을 붙여 다시 연다(⑮ (e)) — 같은 URL 이면 캐시라 저장해도 그대로다. 기존 질의는 두고 `v` 만 바꾼다. */
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
