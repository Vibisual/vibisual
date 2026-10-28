import { WEB_SEARCH_HOST, isHttpUrl, webHostFromNodeKey, type BubbleData, type WebEntry } from '@vibisual/shared';
import { buildWebSearchUrl, normalizeQuery } from '../IDE/webSearchUrl.js';

/**
 * §5.23 — 도메인 버블 더블클릭이 여는 주소(순수). 가장 최근 항목(`at`) — 검색은 우클릭 [웹에서 검색]과 같은 `buildWebSearchUrl`. 실패한 가져오기도 연다.
 * 묶인 버블은 구성원 전체에서. 항목이 없으면 최근 호스트 첫 화면(§7.22 칩과 같은 꼴), 검색뿐이면 `null`(지어내지 않는다). http(s) 가 아니면 안 연다.
 */

export interface DomainOpenTarget {
  /** 열 주소(http(s)). */
  url: string;
  /** iframe 탭 이름 — 가져오기·첫 화면은 그 호스트, 검색은 검색어. */
  label: string;
}

/** 스킴이 있는가 — 없으면 추출기(`webHostFromUrl`)와 같이 https 로 보정한다(도구가 `example.com/x` 를 그대로 받는 판본). */
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function fetchUrlOf(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const candidate = HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;
  return isHttpUrl(candidate) ? candidate : null;
}

function hostLabelOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** 항목 한 건 → 열 주소. 못 만들면 `null`. */
export function webEntryOpenTarget(entry: WebEntry): DomainOpenTarget | null {
  if (entry.kind === 'fetch') {
    const url = fetchUrlOf(entry.url);
    return url ? { url, label: hostLabelOf(url) } : null;
  }
  // 탭 이름도 검색 주소와 같은 다듬기를 거친다(공백 접기·상한) — 주소와 이름이 다른 검색어를 말하지 않게.
  const query = normalizeQuery(entry.query ?? '');
  if (!query) return null;
  const url = buildWebSearchUrl(query);
  return url ? { url, label: query } : null;
}

/** 이 버블이 읽은 호스트들 — 묶인 버블이면 구성원(최근 순), 아니면 자기 자신. 호스트 이름은 노드 키에서 되꺼낸다. */
function memberHostsOf(data: Pick<BubbleData, 'id' | 'path' | 'webFold'>): Array<{ id: string; host: string | null }> {
  if (data.webFold) return data.webFold.hosts.map((h) => ({ id: h.id, host: h.host }));
  return [{ id: data.id, host: webHostFromNodeKey(data.path) }];
}

/** 도메인 버블 더블클릭이 열 주소. 열 것이 없으면 `null`(부르는 쪽은 아무것도 하지 않는다). */
export function domainOpenTarget(
  data: Pick<BubbleData, 'id' | 'path' | 'webFold'>,
  domainEntries: Readonly<Record<string, readonly WebEntry[] | undefined>>,
): DomainOpenTarget | null {
  const hosts = memberHostsOf(data);
  let best: { at: number; target: DomainOpenTarget } | null = null;
  for (const h of hosts) {
    for (const entry of domainEntries[h.id] ?? []) {
      if (best !== null && entry.at <= best.at) continue;
      const target = webEntryOpenTarget(entry);
      if (target) best = { at: entry.at, target };
    }
  }
  if (best) return best.target;
  for (const h of hosts) {
    if (!h.host || h.host === WEB_SEARCH_HOST) continue;
    const url = `https://${h.host}/`;
    if (isHttpUrl(url)) return { url, label: h.host };
  }
  return null;
}
