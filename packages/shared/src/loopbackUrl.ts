/**
 * 루프백 주소 판정 — §7.11 감지 폴백과 "눌러서 프리뷰"가 함께 쓴다. 같은 서버도 이름에 따라 붙느냐가 갈린다
 * (Windows Vite 는 `localhost` 로 열면 `::1` 만 — `127.0.0.1` 은 ECONNREFUSED) — 살아 있는지는 별칭을 차례로 물어야 한다(`loopbackUrlVariants`).
 * 브라우저에서도 로드되는 순수 함수만(`node:`·`process` ❌). 실제 probe 는 서버 `processChecker` 몫.
 */

/** 물어볼 순서대로의 루프백 호스트 별칭. `localhost` 가 먼저인 이유는 브라우저·Node 둘 다
 *  v4/v6 를 알아서 시도해 주는 유일한 이름이라, 맞으면 그 값을 그대로 iframe 에 실을 수 있어서다. */
export const LOOPBACK_HOST_ALIASES: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

/** `URL.hostname` 이 돌려주는 형태(IPv6 는 대괄호가 벗겨진 `::1`)로 루프백인지 본다. */
export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1' || h === '::' || h === '0.0.0.0') return true;
  // 127.0.0.0/8 전체가 루프백이다 — `127.0.0.1` 만 보면 `127.0.0.2` 를 놓친다.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/** 프리뷰로 열 수 있는 루프백 주소면 파싱 결과를, 아니면 null. http(s) 만 — `file:`·`vscode:` 는 대상 아님. */
export function parseLoopbackUrl(rawUrl: string): { url: URL; port: number } | null {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!isLoopbackHostname(url.hostname)) return null;
  const port = url.port ? parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { url, port };
}

/** "이 주소는 내 기계에서 도는 서버인가" — 클릭 손잡이·감지 폴백의 1차 체. */
export function isLoopbackPreviewUrl(rawUrl: string): boolean {
  return parseLoopbackUrl(rawUrl) !== null;
}

/** 같은 서버의 별칭 주소들을 물을 순서대로(경로·쿼리·해시 보존). 원본이 별칭이면 맨 앞, 단 `0.0.0.0` 은 접속용이 아니라 별칭만. */
export function loopbackUrlVariants(rawUrl: string): string[] {
  const parsed = parseLoopbackUrl(rawUrl);
  if (!parsed) return [];
  const { url } = parsed;
  const tail = `${url.pathname}${url.search}${url.hash}`;
  const portPart = url.port ? `:${url.port}` : '';
  const dialable = !/^(?:0\.0\.0\.0|\[?::\]?)$/.test(url.hostname.toLowerCase());
  const out: string[] = [];
  const push = (u: string): void => { if (!out.includes(u)) out.push(u); };
  if (dialable) push(url.toString());
  for (const host of LOOPBACK_HOST_ALIASES) {
    push(`${url.protocol}//${host}${portPart}${tail}`);
  }
  return out;
}

/**
 * §7.11 감지 폴백 — 텍스트에서 루프백 URL 을 통째로 긁는다(포트만 뽑는 `extractAllPortsFromLog` 와 달리 경로를 살리고 foreground 출력에도 쓴다).
 * 모양만 본다 — 진짜인지는 호출부 probe 게이트가 거른다.
 */
export function extractLoopbackUrls(text: string, limit = 12): string[] {
  if (!text) return [];
  const out: string[] = [];
  // 뒤따르는 구두점(`.` `,` `)` `"` 등)은 주소가 아니다 — 문장 안에 박힌 URL 이 흔하므로 잘라낸다.
  const re = /https?:\/\/(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9._-]+)(?::\d{1,5})?(?:\/[^\s'"`<>)\]}]*)?/g;
  for (const m of text.matchAll(re)) {
    if (out.length >= limit) break;
    const cleaned = m[0].replace(/[.,;:!?'"`)\]}>]+$/, '');
    if (!isLoopbackPreviewUrl(cleaned)) continue;
    if (!out.includes(cleaned)) out.push(cleaned);
  }
  return out;
}

/** 브라우저가 **페이지로 그리는** 응답의 MIME. 프리뷰에 실을 수 있는 것은 이것뿐이다. */
const DOCUMENT_MIME_TYPES: readonly string[] = ['text/html', 'application/xhtml+xml'];

/** `Content-Type` 헤더가 페이지(문서)를 가리키는가. 파라미터(`; charset=…`)는 떼고 본다. */
export function isDocumentContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return DOCUMENT_MIME_TYPES.includes(mime);
}

/** 확장자만으로 **확실히 페이지가 아닌** 것들 — `Content-Type` 이 아예 없을 때의 보조 판정. */
const NON_DOCUMENT_EXTENSIONS: readonly string[] = [
  'json', 'xml', 'txt', 'csv', 'tsv', 'yaml', 'yml', 'md',
  'js', 'mjs', 'cjs', 'ts', 'css', 'map', 'wasm',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp',
  'pdf', 'zip', 'gz', 'tar', 'mp3', 'mp4', 'webm', 'wav',
];

/** 경로의 마지막 조각이 위 확장자로 끝나는가(대소문자 무시). */
function hasNonDocumentExtension(pathname: string): boolean {
  const last = pathname.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  if (dot <= 0) return false;
  return NON_DOCUMENT_EXTENSIONS.includes(last.slice(dot + 1).toLowerCase());
}

/** 같은 서버의 **정문**(경로·쿼리 없는 루트). 파싱 불가면 null. */
export function serverRootUrl(rawUrl: string): string | null {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return `${url.protocol}//${url.host}/`;
}

/**
 * §7.11 — 프리뷰로 열 주소: 주운 그대로이거나 그 서버의 정문. 스친 주소를 통째로 주우므로 `curl …/api/…` 이면 API 경로가 열린다 —
 * 그렇다고 늘 버리면 `/game.html` 같은 페이지가 안 열린다. 그래서 `Content-Type` 이 문서면 경로를 살리고 아니면 정문으로 접는다.
 * 헤더가 없으면 살리되 확실히 페이지가 아닌 확장자만 접는다. 순수 함수 — 정문 응답 확인은 `resolvePreviewUrl` 몫.
 */
export function previewUrlForServer(rawUrl: string, contentType?: string | null): string {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return rawUrl; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return rawUrl;
  // 경로가 없으면 이미 정문이다 — 접을 것이 없다.
  if (url.pathname === '' || url.pathname === '/') return rawUrl;
  const keepPath = contentType != null && contentType !== ''
    ? isDocumentContentType(contentType)
    : !hasNonDocumentExtension(url.pathname);
  if (keepPath) return rawUrl;
  return serverRootUrl(rawUrl) ?? rawUrl;
}
