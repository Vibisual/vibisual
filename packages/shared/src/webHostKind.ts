/**
 * webHostKind.ts — §5.23 웹 버블 묶기의 두 판정.
 *
 *  (A) `webSiteOf` — 호스트의 **사이트**(등록 도메인 어림). `docs.github.com` → `github.com`.
 *  (B) `webKindOfHost` · `webKindOfSite` — 호스트·사이트의 **종류**(검색·문서·코드·패키지·질문·표준·글·영상).
 *
 * 표는 전부 §3.3 상수(`WEB_SITE_SUFFIXES` · `WEB_KIND_HOSTS` · `WEB_KIND_SUBDOMAINS` · `WEB_KIND_SITES` ·
 * `WEB_KIND_PATHS`)이고, 여기에는 **어느 근거를 먼저 믿나**의 순서만 있다. 모르면 지어내지 않는다 — 종류가 없으면
 * `undefined` 를 돌려주고, 묶기는 그 단위를 "그 밖의 웹"에 넣는다(§5.23 "모르는 것을 넘겨짚지 않는다").
 *
 * 순수 함수 모듈이다 — 디스크·네트워크·시각에 닿지 않는다. 고정 시험은
 * `packages/server/src/services/webHostKind.test.ts`(러너가 shared 에 없다).
 */
import {
  WEB_KIND_HOSTS,
  WEB_KIND_PATHS,
  WEB_KIND_SITES,
  WEB_KIND_SUBDOMAINS,
  WEB_SEARCH_HOST,
  WEB_SITE_SUFFIXES,
} from './constants.js';
import type { WebKind } from './types.js';

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.+$/, '');
}

/** 표에 **자기 키**로 있을 때만 — `constructor` 같은 프로토타입 이름이 종류로 새지 않게. */
function lookup(table: Readonly<Record<string, WebKind>>, key: string): WebKind | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/**
 * (A) 호스트의 사이트 — 끝 두 칸. 끝 두(세) 칸이 `WEB_SITE_SUFFIXES` 에 있으면 한 칸 더 붙인다
 * (`bbc.co.uk` · 사람마다 다른 `alice.github.io`). IP·`localhost`·한 칸 이름·`web-search` 의사 호스트는 그 자체가 사이트다.
 */
export function webSiteOf(host: string): string {
  const h = normalizeHost(host);
  if (h === '' || h === WEB_SEARCH_HOST) return h;
  if (h.includes(':') || h.startsWith('[') || IPV4.test(h)) return h;
  const labels = h.split('.');
  if (labels.length <= 2) return h;
  for (let k = Math.min(3, labels.length - 1); k >= 2; k--) {
    if (WEB_SITE_SUFFIXES.has(labels.slice(-k).join('.'))) return labels.slice(-(k + 1)).join('.');
  }
  return labels.slice(-2).join('.');
}

/** 이름(호스트 또는 사이트)에서 시작해 한 칸씩 올라가며 사이트 표를 찾는다. 마지막 한 칸(최상위 도메인)은 안 본다. */
function kindFromSiteTable(name: string): WebKind | undefined {
  const labels = name.split('.');
  for (let i = 0; i <= labels.length - 2; i++) {
    const kind = lookup(WEB_KIND_SITES, labels.slice(i).join('.'));
    if (kind) return kind;
  }
  return undefined;
}

/** 사이트보다 앞에 붙은 칸을 왼쪽부터 본다(`www` 는 건너뛴다). 하위 도메인이 없으면 `undefined`. */
function kindFromSubdomains(host: string, site: string): WebKind | undefined {
  if (host === site || !host.endsWith(`.${site}`)) return undefined;
  for (const label of host.slice(0, host.length - site.length - 1).split('.')) {
    if (label === 'www') continue;
    const kind = lookup(WEB_KIND_SUBDOMAINS, label);
    if (kind) return kind;
  }
  return undefined;
}

/** 주소 하나의 경로 → 종류. 파싱 실패·`http(s)` 밖·표에 없는 경로는 `undefined`. */
export function webKindOfUrl(url: string): WebKind | undefined {
  let pathname: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    pathname = parsed.pathname;
  } catch {
    return undefined;
  }
  for (const { kind, test } of WEB_KIND_PATHS) {
    if (test.test(pathname)) return kind;
  }
  return undefined;
}

/** 다수결 — 같은 수면 목록에서 먼저 나온 것(최신이 앞이므로 가장 최근 것)을 고른다. `undefined` 는 세지 않는다. */
function majority(kinds: readonly (WebKind | undefined)[]): WebKind | undefined {
  const counts = new Map<WebKind, number>();
  let best = 0;
  for (const kind of kinds) {
    if (!kind) continue;
    const n = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, n);
    if (n > best) best = n;
  }
  if (best === 0) return undefined;
  for (const kind of kinds) {
    if (kind && counts.get(kind) === best) return kind;
  }
  return undefined;
}

/**
 * (B) 호스트 하나의 종류.
 * ① `web-search` 의사 호스트 → 검색 ② 호스트 그대로 표 ③ 하위 도메인 머리 ④ 사이트(와 그 위) 표 ⑤ 읽은 주소의 경로 다수결.
 *
 * @param urls 그 호스트에서 읽은 주소 — **최신이 앞**. 경로 근거가 같은 수로 갈리면 최근 주소를 따른다.
 */
export function webKindOfHost(host: string, urls: readonly string[] = []): WebKind | undefined {
  const h = normalizeHost(host);
  if (h === WEB_SEARCH_HOST) return 'search';
  const exact = lookup(WEB_KIND_HOSTS, h);
  if (exact) return exact;
  return kindFromSubdomains(h, webSiteOf(h))
    ?? kindFromSiteTable(h)
    ?? majority(urls.map(webKindOfUrl));
}

/**
 * (B) 같은 사이트로 묶인 호스트들(A)의 종류 — 사이트가 표에 있으면 그것, 없으면 구성원 종류의 다수결.
 * 호스트 표는 사이트에 쓰지 않는다 — `google.com` 사이트 안의 `cloud.google.com` 은 검색이 아니다.
 *
 * @param members 구성원 호스트 — **최신이 앞**. 각자의 주소도 최신이 앞.
 */
export function webKindOfSite(
  site: string,
  members: readonly { host: string; urls?: readonly string[] }[],
): WebKind | undefined {
  const s = normalizeHost(site);
  if (s === WEB_SEARCH_HOST) return 'search';
  return kindFromSiteTable(s) ?? majority(members.map((m) => webKindOfHost(m.host, m.urls ?? [])));
}
