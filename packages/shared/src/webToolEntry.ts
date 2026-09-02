/**
 * webToolEntry.ts — §5.23 · 도메인 버블의 **공용 추출기**.
 *
 * `WebFetch`/`WebSearch` 훅 payload 한 건에서 ⑴ 어느 호스트의 일인지 ⑵ 그 줄에 무엇을 적을지를
 * 뽑는다. 서버 `projectGraph` 가 버블을 세울 때도, §5.22 감사 원장이 `target` 을 채울 때도
 * **같은 함수**를 부른다 — 두 벌이 되면 한쪽만 고쳐져 "버블은 섰는데 원장은 비어 있는" 상태가 된다
 * (§2.1 #3 쓰기 추출기를 shared 에 둔 것과 같은 이유).
 *
 * 판정 원칙은 파일 축과 같다 — **모르는 것을 도메인으로 넘겨짚지 않는다.** `http`/`https` 가 아닌
 * 스킴·파싱 실패·빈 호스트는 버린다(버블을 만들지 않는다). 웹 오탐의 대가는 "가짜 버블"이고,
 * 그 버블은 디스크에 없어 존재 확인 스윕이 걷어 주지도 못한다.
 *
 * 순수 함수 모듈(디스크 접근 ❌ · `process.platform` 읽기 ❌ · `Date.now()` 는 **인자로 받는다**)이라
 * 값이 결정적이고 세 OS 를 개발기 한 대에서 단위 테스트할 수 있다.
 */
import {
  WEB_ENTRY_RESULT_HOSTS_MAX,
  WEB_ENTRY_TEXT_MAX,
  WEB_KEY_MARK,
  WEB_SEARCH_HOST,
} from './constants.js';
import type { WebEntry, WebEntryKind } from './types.js';

/** 도메인 노드 키를 만든다 — `__web__<host>`. 조립은 여기 한 곳. */
export function webNodeKey(host: string): string {
  return `${WEB_KEY_MARK}${host}`;
}

/** 도메인 노드 키에서 호스트를 되꺼낸다. 우리 키가 아니면 `null`. 해체도 여기 한 곳. */
export function webHostFromNodeKey(key: string): string | null {
  if (!key.startsWith(WEB_KEY_MARK)) return null;
  const host = key.slice(WEB_KEY_MARK.length);
  return host.length > 0 ? host : null;
}

/**
 * URL 문자열에서 버블이 될 호스트를 뽑는다. 못 뽑으면 `null`(= 버블을 만들지 않는다).
 *
 * - `http`/`https` 만 받는다. `file:`·`data:`·`ftp:` 는 "에이전트가 웹을 읽은 일"이 아니다.
 * - 대소문자를 접고 **선행 `www.` 를 뗀다** — 안 떼면 `www.example.com` 과 `example.com` 이
 *   같은 사이트인데 버블 둘로 갈린다(경로별로 쪼개지 않는다는 §5.23 규칙과 같은 취지).
 * - 포트는 남긴다(`localhost:5173` 은 다른 서버다).
 */
export function webHostFromUrl(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // 스킴이 없으면 https 로 보정한다 — 도구가 `example.com/x` 를 그대로 받는 판본이 있다.
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  let host = parsed.host.toLowerCase();
  if (host.startsWith('www.') && host.length > 4) host = host.slice(4);
  return host.length > 0 ? host : null;
}

/** 문자열을 상한까지 자르고, 잘렸는지 함께 돌려준다(§3.2.3 C축). */
export function clampWebText(
  raw: unknown,
  max: number = WEB_ENTRY_TEXT_MAX,
): { text?: string; truncated?: boolean } {
  if (typeof raw !== 'string') return {};
  const trimmed = raw.trim();
  if (!trimmed) return {};
  if (trimmed.length <= max) return { text: trimmed };
  return { text: trimmed.slice(0, max), truncated: true };
}

/**
 * `tool_response` 에서 본문 텍스트를 **관대하게** 뽑는다.
 * 판본마다 `content: [{type:'text',text}]` · `content: '…'` · `result` · `output` 로 오므로
 * 넓게 받는다. 하나도 못 뽑으면 빈 문자열 — 그때는 `result` 를 **비운 채** 저장한다(§5.23).
 */
export function readWebResponseText(response: unknown): string {
  if (typeof response === 'string') return response;
  if (!response || typeof response !== 'object') return '';
  const rec = response as Record<string, unknown>;

  const content = rec['content'];
  if (typeof content === 'string' && content.trim()) return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (typeof item === 'string') { parts.push(item); continue; }
      if (item && typeof item === 'object') {
        const text = (item as Record<string, unknown>)['text'];
        if (typeof text === 'string') parts.push(text);
      }
    }
    if (parts.length > 0) return parts.join('\n');
  }
  for (const key of ['result', 'output', 'text', 'stdout']) {
    const v = rec[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}

/** 응답에서 실패 사유를 뽑는다 — 없으면 `undefined`(성공이었다고 넘겨짚지 않는다). */
export function readWebResponseError(response: unknown): string | undefined {
  if (!response || typeof response !== 'object') return undefined;
  const rec = response as Record<string, unknown>;
  for (const key of ['error', 'errorMessage', 'message']) {
    const v = rec[key];
    if (typeof v === 'string' && v.trim()) return clampWebText(v, 300).text;
  }
  if (rec['is_error'] === true || rec['isError'] === true) {
    const { text } = clampWebText(readWebResponseText(response), 300);
    return text ?? 'error';
  }
  return undefined;
}

/**
 * 검색 결과 텍스트에서 대표 호스트들을 뽑는다(중복 제거·상한까지).
 * **이 호스트들로 버블을 만들지 않는다** — 에이전트는 그것을 읽지 않았다(§5.23).
 */
export function extractResultHosts(
  text: string,
  max: number = WEB_ENTRY_RESULT_HOSTS_MAX,
): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /https?:\/\/[^\s"'<>)\]}]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const host = webHostFromUrl(m[0]);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    out.push(host);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * 검색 결과 건수를 센다. **못 세면 `undefined`** — 0 으로 채우면 "결과가 없었다"는 거짓말이 된다.
 * 우선 응답 객체의 명시 필드를 보고, 없으면 본문의 URL 개수로 근사한다.
 */
export function extractResultCount(response: unknown, text: string): number | undefined {
  if (response && typeof response === 'object') {
    const rec = response as Record<string, unknown>;
    for (const key of ['resultCount', 'result_count', 'count']) {
      const v = rec[key];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.floor(v);
    }
    const results = rec['results'] ?? rec['links'];
    if (Array.isArray(results)) return results.length;
  }
  if (!text) return undefined;
  const matches = text.match(/https?:\/\/[^\s"'<>)\]}]+/g);
  return matches ? new Set(matches).size : undefined;
}

/** 추출 결과 — 어느 버블에 붙일지(`host`)와 그 버블에 쌓을 한 줄(`entry`). */
export interface WebToolExtraction {
  host: string;
  entry: WebEntry;
}

/**
 * `WebFetch`/`WebSearch` 한 건을 도메인 버블 항목으로 옮긴다. 우리 축이 아니거나
 * 호스트를 못 세우면 `null` — 그러면 버블도 항목도 만들어지지 않는다.
 *
 * @param nowMs   `Date.now()` 를 **인자로 받는다**(순수 함수 유지 — 테스트가 값을 고정할 수 있다).
 * @param idSeed  항목 id 를 만들 때 섞는 값. 같은 ms 에 두 건이 와도 id 가 갈린다.
 */
export function extractWebEntry(
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
  toolResponse: unknown,
  nowMs: number,
  idSeed = '',
): WebToolExtraction | null {
  const kind: WebEntryKind | null =
    toolName === 'WebFetch' ? 'fetch' : toolName === 'WebSearch' ? 'search' : null;
  if (!kind) return null;

  const input = toolInput ?? {};
  const text = readWebResponseText(toolResponse);
  const error = readWebResponseError(toolResponse);
  const id = `web-${nowMs.toString(36)}-${idSeed || Math.random().toString(36).slice(2, 8)}`;

  if (kind === 'fetch') {
    const rawUrl = input['url'];
    if (typeof rawUrl !== 'string') return null;
    const host = webHostFromUrl(rawUrl);
    if (!host) return null;
    const { text: result, truncated } = clampWebText(text);
    const entry: WebEntry = { id, kind: 'fetch', url: rawUrl.trim(), at: nowMs };
    const prompt = clampWebText(input['prompt'], 500).text;
    if (prompt) entry.prompt = prompt;
    if (result) entry.result = result;
    if (truncated) entry.resultTruncated = true;
    if (error) entry.error = error;
    return { host, entry };
  }

  // search — 호스트가 없어 의사 호스트 한 칸에 모은다.
  const rawQuery = input['query'];
  const query = clampWebText(rawQuery, 500).text;
  if (!query) return null; // 검색어가 없으면 무엇을 찾았는지 적을 수 없다 — 줄만 늘리지 않는다.
  const { text: result, truncated } = clampWebText(text);
  const entry: WebEntry = { id, kind: 'search', query, at: nowMs };
  const hosts = extractResultHosts(text);
  if (hosts.length > 0) entry.resultHosts = hosts;
  const count = extractResultCount(toolResponse, text);
  if (count !== undefined) entry.resultCount = count;
  if (result) entry.result = result;
  if (truncated) entry.resultTruncated = true;
  if (error) entry.error = error;
  return { host: WEB_SEARCH_HOST, entry };
}
