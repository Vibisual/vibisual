import { createHmac, timingSafeEqual } from 'node:crypto';
import { MOBILE_CONTENT_PATH, isAppContentPath } from '@vibisual/shared';

/**
 * §5.13 (T-3) — 모바일 리스너가 코어로 넘기기 전에 요청을 고치는 순수 판정(electron 없이 시험한다).
 * 샌드박스 프레임 안의 하위 요청에는 SameSite 쿠키가 실리지 않으므로, 쿠키가 실리는 문서 요청을 문서 범위 권한 경로로 돌려
 * 상대 주소가 권한을 물고 오게 한다. 세션 토큰이 HMAC 열쇠라 세션을 지우면 권한도 함께 죽는다.
 */

export interface ContentCapability {
  /** 코어에 넘길 원래 주소(권한 앞머리를 뗀 것). */
  readonly url: string;
  /** 코어가 CSP 와 절대 주소에 붙일 앞머리. */
  readonly base: string;
}

const HMAC_LABEL = 'vibisual-mobile-content\u0000';
/** 경로를 `/` 로 나눴을 때 `['', api, app, <앱>, content, <프로젝트>, <문서>]` 까지가 문서 범위다. */
const SCOPE_PARTS = 7;

function splitUrl(url: string): { readonly pathname: string; readonly search: string } {
  const query = url.indexOf('?');
  return query < 0 ? { pathname: url, search: '' } : { pathname: url.slice(0, query), search: url.slice(query) };
}

/**
 * 문서 범위 `/api/app/<앱>/content/<프로젝트>/<문서>/`. 재디스패치의 URL 파서가 점 구간·역슬래시를 풀어 버리므로,
 * 풀었을 때 모양이 달라지는 경로는 받지 않는다 — 안 그러면 서명한 범위를 벗어나 다른 API 에 닿는다.
 */
function contentScope(pathname: string): string | null {
  if (!isAppContentPath(pathname)) return null;
  try {
    if (new URL(pathname, 'https://vibisual.invalid').pathname !== pathname) return null;
  } catch {
    return null;
  }
  const parts = pathname.split('/');
  if (parts.length <= SCOPE_PARTS || parts[SCOPE_PARTS - 2] === '' || parts[SCOPE_PARTS - 1] === '') return null;
  return `${parts.slice(0, SCOPE_PARTS).join('/')}/`;
}

function sign(session: string, scope: string): string {
  return createHmac('sha256', session).update(HMAC_LABEL + scope).digest('base64url');
}

/** 쿠키로 인증된 앱 콘텐츠 요청을 돌릴 권한 경로. 앱 콘텐츠가 아니면 null. */
export function contentCapabilityRedirect(url: string, session: string): string | null {
  const { pathname, search } = splitUrl(url);
  const scope = contentScope(pathname);
  return scope === null ? null : `${MOBILE_CONTENT_PATH}/${sign(session, scope)}${pathname}${search}`;
}

/** 권한 경로를 검증해 코어로 넘길 모양을 돌려준다. 권한이 틀렸거나 그 문서 범위 밖이면 null. */
export function resolveContentCapability(url: string, sessions: readonly string[]): ContentCapability | null {
  const { pathname, search } = splitUrl(url);
  const head = `${MOBILE_CONTENT_PATH}/`;
  if (!pathname.startsWith(head)) return null;
  const slash = pathname.indexOf('/', head.length);
  if (slash < 0) return null;
  const capability = pathname.slice(head.length, slash);
  const inner = pathname.slice(slash);
  const scope = contentScope(inner);
  if (scope === null) return null;
  const given = Buffer.from(capability);
  const valid = sessions.some((session) => {
    const expected = Buffer.from(sign(session, scope));
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
  return valid ? { url: `${inner}${search}`, base: `${head}${capability}` } : null;
}

/** `bytes=N-` 를 `bytes=N-(N+chunk-1)` 로 묶는다. 닫힌 구간·접미 구간·여러 구간은 요청한 길이를 지켜야 하므로 그대로 둔다. */
export function boundOpenRange(range: string, chunkBytes: number): string {
  const open = /^bytes=(\d+)-$/.exec(range.trim());
  if (!open) return range;
  const start = Number(open[1]);
  return Number.isSafeInteger(start) ? `bytes=${start}-${start + chunkBytes - 1}` : range;
}
