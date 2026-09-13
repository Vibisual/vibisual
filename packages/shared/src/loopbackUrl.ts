/**
 * 루프백(내 기계) 주소 판정 SSOT — §7.11 감지 폴백과 "눌러서 프리뷰" 손잡이가 함께 쓴다.
 *
 * 한 서버를 가리키는 이름은 여럿이다: `localhost` · `127.0.0.1` · `[::1]` · `0.0.0.0`.
 * 그런데 **어느 이름으로 부르느냐에 따라 실제로 붙느냐가 갈린다** — Vite 는 Windows 에서
 * `localhost` 로 열면 IPv6(`::1`) 에만 바인딩되므로 `127.0.0.1` 로는 ECONNREFUSED 다.
 * 그래서 "살아있는지" 를 물을 때는 **한 이름으로 묻고 아니라고 답하면 안 된다** — 별칭을
 * 차례로 물어야 한다(`loopbackUrlVariants`).
 *
 * shared 라 브라우저에서도 로드된다 — `node:` 모듈·`process` 를 읽지 않는 순수 함수만 둔다
 * (pathCase.ts 머리말과 같은 규약). 실제 probe(TCP/HTTP)는 서버 `processChecker` 의 일이다.
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

/**
 * 같은 서버를 가리키는 **별칭 주소들**을 물어볼 순서대로. 경로·쿼리·해시는 그대로 보존한다.
 *
 * 원본이 이미 별칭 중 하나면 그것을 맨 앞에 둔다 — 사용자가 누른 그 주소가 살아 있으면
 * 굳이 다른 이름으로 바꿔 보여 줄 이유가 없다. `0.0.0.0`(모든 인터페이스에 바인딩)은
 * **접속용 주소가 아니므로** 원본을 앞에 두지 않고 별칭만 돌려준다.
 */
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
 * §7.11 감지 폴백 — 임의의 텍스트(Bash 출력·명령어)에서 **루프백 URL 을 통째로** 긁는다.
 *
 * 기존 `extractAllPortsFromLog` 는 포트 **숫자**만 뽑아 `http://localhost:{포트}` 를 합성했다.
 * 그건 background 셸의 output 파일에만 붙는 데다 경로를 잃는다. 이쪽은 URL 모양 그대로를
 * 잡으므로 **경로가 있는 주소**(`http://localhost:8080/index.html`)를 그대로 살릴 수 있고,
 * foreground 명령의 출력에도 쓸 수 있다. 진짜인지는 호출부의 probe 게이트가 판정한다 —
 * 여기서는 모양만 본다(넓게 잡고 probe 로 거른다, §7.11 v2.24 와 같은 규율).
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
 * §7.11 — **프리뷰로 열 주소**를 정한다. 주운 주소 그대로일 수도, 그 서버의 정문일 수도 있다.
 *
 * 감지 폴백(`extractLoopbackUrls`)은 Bash 명령어·출력에 스친 주소를 **통째로** 줍는다. 그래서
 * `curl http://127.0.0.1:3456/api/backtest/state` 한 줄이면 그 **API 경로**가 그대로 프리뷰 주소가
 * 됐다(사용자 보고: "iframe 버블인데 계속 `/api/backtest/state` 로 연결돼 이상한 곳으로 빠진다").
 * 그 주소가 서버라는 것은 맞지만 — 포트는 확실히 서버다 — **그 경로가 페이지라는 뜻은 아니다.**
 * 에이전트가 물어본 API 는 그 에이전트의 관심사이지 사람이 볼 화면이 아니다.
 *
 * 그렇다고 경로를 늘 버릴 수는 없다. §7.11 v2.29 가 경로를 살린 이유가 있다 — `/game.html`
 * 처럼 **그 경로가 곧 보려던 페이지**인 경우가 있고, 그때 루트로 접으면 사용자가 원한 화면이
 * 안 열린다. 그래서 **응답이 스스로 말하게 한다**: `Content-Type` 이 문서면 경로를 살리고,
 * 아니면(JSON·이미지·텍스트) 같은 서버의 정문으로 접는다. 헤더가 아예 없는 서버는 종전대로
 * 경로를 살리되, 확장자가 확실히 페이지가 아닌 것만 접는다(모르면 건드리지 않는다).
 *
 * 순수 함수다 — 실제로 정문이 응답하는지 확인하는 것은 호출부(`resolvePreviewUrl`)의 몫이다.
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
