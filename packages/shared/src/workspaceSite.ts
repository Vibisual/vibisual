/**
 * workspaceSite.ts — §5.5 #17-27 ⑮ 워크스페이스 HTML 을 **페이지로** 여는 창구의 규약.
 *
 * ⑭ 의 이미지 창구(`/api/workspace-image?root=&path=`)나 §5.13 (R) 의 미디어 창구와 달리
 * 여기만 **경로형**이다. 이유는 하나뿐이고 그게 전부다 — 질의형 URL 에서는
 *
 *     /api/workspace-media?root=…&path=sub/index.html   +   <link href="style.css">
 *       → /api/style.css                                     (CSS·그림·스크립트 전멸)
 *
 * 로 풀린다. 페이지는 자기 옆의 파일들을 상대 경로로 부르는 물건이라, 그 해석이 살아 있지
 * 않으면 "브라우저처럼 열린다"는 말 자체가 성립하지 않는다. 경로형이면
 *
 *     /api/workspace-site/<루트>/sub/index.html         +   <link href="style.css">
 *       → /api/workspace-site/<루트>/sub/style.css        (브라우저의 규칙 그대로)
 *
 * 가 된다. 루트는 **한 세그먼트**로 인코딩한다(`encodeURIComponent` — `/`·`\`·`:` 가 전부
 * 퍼센트로 접히므로 세그먼트가 쪼개지지 않는다).
 *
 * 조립(클라)과 해석(서버)이 **같은 파일**에 있는 이유는 §5.14 v4.62 와 같다 — 한쪽만 고치면
 * 다른 쪽이 조용히 404 를 돌려주고, 화면에는 흰 사각형만 남는다.
 */

import {
  WORKSPACE_IMAGE_MIME_BY_EXT,
  WORKSPACE_MEDIA_MIME_BY_EXT,
  workspaceFileExt,
} from './constants.js';

/** 경로형 창구의 접두어. 서버 라우트·클라 URL 조립·main 의 `protocol.handle` 허용 목록이 함께 본다. */
export const WORKSPACE_SITE_PATH = '/api/workspace-site';

/**
 * 편집창이 **페이지로** 여는 확장자.
 *
 * `.xhtml` 까지인 이유는 Chromium 이 그대로 그려 주기 때문이고, `.md`·`.svg` 가 없는 이유는
 * 이 항목이 HTML 한 갈래만 넓히기 때문이다(⑮ (h)). `.svg` 는 ⑤ 의 판단대로 편집창이 텍스트로 연다.
 */
export const WORKSPACE_HTML_EXTENSIONS: readonly string[] = ['.html', '.htm', '.xhtml'];

/** 이 파일을 페이지로 열 것인가. */
export function isWorkspaceHtmlPath(filePath: string): boolean {
  return WORKSPACE_HTML_EXTENSIONS.includes(workspaceFileExt(filePath));
}

/**
 * 페이지가 함께 부르는 웹 자산의 MIME.
 *
 * **`Content-Type` 이 틀리면 그 자산은 없는 것과 같다** — CSS 를 `text/plain` 으로 주면
 * Chromium 이 스타일시트로 받지 않고, JS 모듈을 `application/octet-stream` 으로 주면
 * `Failed to load module script` 로 죽는다. 그림·미디어는 이미 있는 두 표를 그대로 잇는다.
 */
export const WORKSPACE_SITE_MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.xhtml': 'application/xhtml+xml; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.manifest': 'text/cache-manifest',
  '.webmanifest': 'application/manifest+json',
};

/**
 * 본문을 다시 쓰기 위해 **통째로 메모리에 올려도 되는** 상한(bytes).
 *
 * 넘으면 재작성 없이 바이트 그대로 흘린다 — 그런 파일은 사람이 손으로 쓴 페이지가 아니라
 * 생성물(번들·덤프)이고, 거기에는 애초에 루트 절대 경로가 거의 없다. 8MB 는 손으로 쓴
 * HTML 이 절대 닿지 않는 크기다.
 */
export const WORKSPACE_SITE_REWRITE_MAX_BYTES = 8_000_000;

/** 확장자 → MIME. 웹 자산 표 → 그림 표 → 미디어 표 순으로 보고, 셋 다 모르면 옥텟 스트림. */
export function workspaceSiteMime(filePath: string): string {
  const ext = workspaceFileExt(filePath);
  return (
    WORKSPACE_SITE_MIME_BY_EXT[ext] ??
    WORKSPACE_IMAGE_MIME_BY_EXT[ext] ??
    WORKSPACE_MEDIA_MIME_BY_EXT[ext] ??
    'application/octet-stream'
  );
}

/**
 * 이 루트의 페이지들이 공유하는 기준 경로 — `/api/workspace-site/<인코딩된 루트>`.
 *
 * 서버가 HTML·CSS 안의 **루트 절대 경로**(`/style.css`)를 다시 쓸 때 붙이는 접두어이기도 하다.
 */
export function workspaceSiteBase(root: string): string {
  return `${WORKSPACE_SITE_PATH}/${encodeURIComponent(root)}`;
}

/**
 * 그 파일을 가리키는 경로형 URL.
 *
 * `cacheToken` 은 파일의 수정 시각이다 — 같은 URL 을 그대로 두면 저장한 뒤에도 브라우저 캐시가
 * 옛 화면을 돌려준다(⑮ (e)). 질의 문자열이라 **상대 경로 해석에는 영향이 없다**.
 */
export function workspaceSiteUrl(root: string, relPath: string, cacheToken?: number): string {
  const segments = relPath
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s))
    .join('/');
  const url = `${workspaceSiteBase(root)}/${segments}`;
  return cacheToken === undefined || cacheToken === 0 ? url : `${url}?v=${cacheToken}`;
}

/** 경로형 URL 해석 결과. `relPath` 가 빈 문자열이면 루트 자신(서버가 `index.html` 을 찾는다). */
export interface WorkspaceSiteRequest {
  root: string;
  relPath: string;
}

/**
 * `/api/workspace-site/<루트>/<파일…>` → `{ root, relPath }`. 접두어가 아니면 `null`.
 *
 * 세그먼트를 **하나씩** 디코딩한다 — 전체를 한 번에 풀면 파일 이름 안의 `%2F` 가 경로 구분자로
 * 살아나 가드를 지나칠 수 있다(경로 가드는 서버가 다시 보지만, 여기서 먼저 새지 않게 한다).
 */
export function parseWorkspaceSitePath(pathname: string): WorkspaceSiteRequest | null {
  const prefix = `${WORKSPACE_SITE_PATH}/`;
  if (!pathname.startsWith(prefix)) return null;

  const raw = pathname.slice(prefix.length).split('/');
  const rootSegment = raw[0] ?? '';
  if (rootSegment === '') return null;

  let root: string;
  try {
    root = decodeURIComponent(rootSegment);
  } catch {
    return null; // 깨진 퍼센트 인코딩 — 우리 URL 이 아니다.
  }
  if (root === '') return null;

  const parts: string[] = [];
  for (const segment of raw.slice(1)) {
    if (segment === '') continue;
    try {
      parts.push(decodeURIComponent(segment));
    } catch {
      return null;
    }
  }
  return { root, relPath: parts.join('/') };
}

/**
 * ⑮ (c) — 내보내는 HTML 안의 **루트 절대 경로**를 이 창구 기준으로 다시 쓴다.
 *
 * 상대 경로(`./a.css`·`../b.js`)는 손대지 않는다 — 경로형 URL 이라 브라우저가 이미 옳게 푼다.
 * 다시 써야 하는 것은 `/`(슬래시)로 시작하는 것뿐이고, 그것은 "이 사이트의 루트에서부터"라는
 * 뜻이라 우리 창구에서는 앞에 기준 경로가 붙어야 같은 자리를 가리킨다.
 *
 * 규칙 자체는 `services/iframeProxy.ts` 의 `rewriteHtml` 과 **같은 것**이다(새 규칙 ❌) —
 * 거기서 이미 dev 서버 프리뷰가 같은 문제를 겪었고, 그 자리에서 검증된 정규식을 그대로 쓴다.
 */
export function rewriteWorkspaceSiteHtml(html: string, siteBase: string): string {
  // `//example.com/x`(프로토콜 상대)와 이미 접두어가 붙은 것은 건드리지 않는다.
  const attrRe = /\b(src|href|action)=(["'])(\/[^"'/][^"']*)\2/g;
  let out = html.replace(attrRe, (m, attr: string, quote: string, url: string) => {
    if (url.startsWith(siteBase)) return m;
    return `${attr}=${quote}${siteBase}${url}${quote}`;
  });
  out = rewriteWorkspaceSiteCss(out, siteBase);
  return out;
}

/**
 * ⑮ (c) — 스타일시트 안의 `url(/…)` 도 같은 이유로 다시 쓴다.
 *
 * HTML 만 고치면 `<link href="/app.css">` 는 살아나지만 그 CSS 안의 `url(/logo.png)` 가
 * 그대로 남아 그림만 빠진다 — 실패가 눈에 덜 띄는 쪽이라 더 오래 남는다.
 */
export function rewriteWorkspaceSiteCss(css: string, siteBase: string): string {
  const cssUrlRe = /url\(\s*(["']?)(\/[^"')/][^"')]*)\1\s*\)/g;
  return css.replace(cssUrlRe, (m, quote: string, url: string) => {
    if (url.startsWith(siteBase)) return m;
    return `url(${quote}${siteBase}${url}${quote})`;
  });
}

/** 내보낼 때 본문을 다시 써야 하는 확장자인가(HTML 계열 · CSS). 그 외는 바이트 그대로 흘린다. */
export function workspaceSiteRewriteKind(filePath: string): 'html' | 'css' | null {
  const ext = workspaceFileExt(filePath);
  if (WORKSPACE_HTML_EXTENSIONS.includes(ext)) return 'html';
  if (ext === '.css') return 'css';
  return null;
}

// ─── ⑮ (b) 페이지가 자기 위치를 알려 온다 ────────────────────────────────────
//
// 패키지 앱에서 iframe 은 `vibproxy://`, 우리 창은 `file://` 이라 두 문서의 오리진이 다르다.
// 부모가 `contentWindow.location` 을 읽는 것도 `history.back()` 을 부르는 것도 SecurityError 다.
// 그래서 내보내는 HTML 에 **위치를 알려 주는 한 조각**을 얹는다 — `previewPicker` 가 프리뷰에서
// 이미 쓰는 방식 그대로이고(새 통로 발명 ❌), 막히면(페이지 자신의 CSP 등) 주소 칸이 열었던
// 파일 이름에 머무를 뿐 페이지 자체는 멀쩡히 그려진다.

/** 신고 메시지의 표식. 서버(주입)와 클라(수신)가 같은 글자를 봐야 하므로 여기 한 곳에 둔다. */
export const WORKSPACE_SITE_REPORT_MESSAGE = '__vibisualSitePage';

/**
 * 주입되는 조각. **위치를 알리는 것 말고는 아무것도 하지 않는다** — 페이지의 스타일·전역·
 * 네트워크를 건드리면 사용자가 자기 페이지를 검증하는 자리를 우리가 오염시키는 셈이 된다.
 */
export function workspaceSiteReporterScript(): string {
  return [
    '<script>',
    '(function(){',
    '  function r(){try{parent.postMessage({',
    `    ${WORKSPACE_SITE_REPORT_MESSAGE}:true,url:location.href`,
    "  },'*')}catch(e){}}",
    '  r();',
    "  addEventListener('pageshow',r);",
    "  addEventListener('hashchange',r);",
    "  addEventListener('popstate',r);",
    '})();',
    '</script>',
  ].join('');
}

/**
 * 두 조각을 `<head>` 바로 뒤에 넣는다(없으면 `<html>` 뒤, 그것도 없으면 맨 앞).
 *
 * 앞쪽에 두는 이유는 페이지가 스스로 다른 곳으로 옮겨 가기 **전에** 첫 위치를 알려야 하기
 * 때문이다. 대소문자·속성이 붙은 태그도 잡는다(`<HEAD>`·`<html lang="ko">`).
 *
 * 얹는 것은 위치 신고(b)와 요소 집기(i) 둘뿐이고, 둘 다 **부모와의 대화**만 한다 — 페이지의
 * 스타일·전역·네트워크에는 손대지 않는다.
 */
export function injectWorkspaceSiteAgents(html: string): string {
  const script = workspaceSiteReporterScript() + workspaceSiteInspectorScript();
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + script + html.slice(at);
  }
  const htmlTag = /<html\b[^>]*>/i.exec(html);
  if (htmlTag) {
    const at = htmlTag.index + htmlTag[0].length;
    return html.slice(0, at) + script + html.slice(at);
  }
  return script + html;
}

// ─── ⑮ (i) 페이지 안의 요소를 Alt 로 집는다 ──────────────────────────────────
//
// 앱 화면에서는 Alt+클릭이 요소를 집어 준다(`useInspector`). 그런데 이 미리보기 iframe 은
// 패키지 앱에서 `vibproxy://` 라 우리 창과 **오리진이 다르고**, 인스펙터는 `contentDocument`
// 를 못 읽어 그 자리에서 조용히 포기한다 — 사용자가 얻는 것은 iframe 을 그린 React 컴포넌트
// (`IDEHtmlPreview`) 뿐이라, 정작 가리킨 그 요소는 어디에도 없다.
//
// 여기 있는 것은 그 벽을 넘는 두 조각이다.
//   ① `annotateWorkspaceSiteSource` — 내보내는 HTML 의 **모든 시작 태그**에 원본의 줄:칸을
//      적어 둔다. 우리 파일이므로 위치를 추측할 이유가 없다(사용자 지적 — "어차피 우리 내부에
//      있는 html").
//   ② `workspaceSiteInspectorScript` — 부모가 좌표를 물으면 그 자리의 요소를 되짚어 답하는
//      조각. **묻는 말에만 답한다** — 페이지의 스타일·전역·네트워크를 건드리지 않는다((b) 의
//      위치 신고 조각과 같은 규율).

/** 시작 태그마다 붙는 원본 위치. 값은 `"줄:칸"`(1부터), 파일은 문서 URL 이 말한다. */
export const WORKSPACE_SITE_SOURCE_ATTR = 'data-vib-src';

/**
 * 안을 **마크업으로 읽지 않는** 태그. 여기 든 `<div>` 는 요소가 아니라 글자라, 주석을 달면
 * 그 글자를 우리가 고쳐 쓰는 셈이 된다(스크립트 문자열·`<textarea>` 예제 코드가 그렇다).
 */
const WORKSPACE_SITE_RAW_TEXT_TAGS: ReadonlySet<string> = new Set(['script', 'style', 'textarea', 'title']);

/** 인용부호를 인식하며 시작 태그의 `>` 를 찾는다 — 속성 값 안의 `>` 에 속지 않기 위해서다. */
function findTagEnd(html: string, from: number): number {
  let quote = '';
  for (let k = from; k < html.length; k++) {
    const ch = html[k] as string;
    if (quote !== '') {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '>') return k;
  }
  return -1;
}

/** `i` 자리가 `raw` 의 닫는 태그인가(`</script>` 는 맞고 `</scripts>` 는 아니다). */
function closesRawText(html: string, i: number, raw: string): boolean {
  if (html.slice(i + 1, i + 2 + raw.length).toLowerCase() !== `/${raw}`) return false;
  const after = html[i + 2 + raw.length] ?? '';
  return after === '' || after === '>' || after === '/' || /\s/.test(after);
}

/**
 * 시작 태그마다 `data-vib-src="줄:칸"` 을 끼워 넣는다(원본 기준, 1부터).
 *
 * 왜 파서를 쓰지 않는가: 우리가 알아야 하는 것은 **시작 태그의 자리** 하나뿐이고, 그것은
 * 인용부호만 제대로 세면 나온다. 정식 파서를 물리면 잘못 닫힌 태그 하나에 문서 전체가
 * 다시 배열돼, 손으로 쓴 페이지의 위치가 오히려 어긋난다.
 *
 * 손대지 않는 것들 — 주석 · DOCTYPE · 처리 지시 · 닫는 태그 · 원시텍스트 태그의 **내용** ·
 * 닫히지 않은 태그 · 이미 `data-vib-src` 를 들고 있는 태그(중복 주입 방지).
 */
export function annotateWorkspaceSiteSource(html: string): string {
  let out = '';
  let i = 0;
  let line = 1;
  let col = 1;
  /** 지금 내용을 건너뛰는 중인 원시텍스트 태그(소문자). */
  let raw: string | null = null;

  /** 원본 `n` 글자를 그대로 흘리며 줄·칸을 센다(주입한 글자는 세지 않는다 — 위치는 원본 것이다). */
  const emit = (n: number): void => {
    for (let k = 0; k < n; k++) {
      if (html[i + k] === '\n') { line += 1; col = 1; } else { col += 1; }
    }
    out += html.slice(i, i + n);
    i += n;
  };

  while (i < html.length) {
    if (html[i] !== '<') { emit(1); continue; }

    if (raw !== null) {
      if (closesRawText(html, i, raw)) raw = null;
      emit(1);
      continue;
    }

    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      emit(end < 0 ? html.length - i : end + 3 - i);
      continue;
    }

    const next = html[i + 1] ?? '';
    if (next === '!' || next === '?' || next === '/') {
      const end = findTagEnd(html, i + 1);
      emit(end < 0 ? html.length - i : end + 1 - i);
      continue;
    }
    if (!/[a-zA-Z]/.test(next)) { emit(1); continue; }

    let j = i + 1;
    while (j < html.length && !/[\s/>]/.test(html[j] as string)) j += 1;
    const name = html.slice(i + 1, j).toLowerCase();
    const tagEnd = findTagEnd(html, j);
    // 닫히지 않은 태그는 우리가 고칠 자리가 아니다 — 원본 그대로 흘린다.
    if (tagEnd < 0) { emit(1); continue; }

    const startLine = line;
    const startCol = col;
    const already = new RegExp(`\\s${WORKSPACE_SITE_SOURCE_ATTR}\\s*=`, 'i').test(html.slice(j, tagEnd));
    emit(j - i);
    if (!already) out += ` ${WORKSPACE_SITE_SOURCE_ATTR}="${String(startLine)}:${String(startCol)}"`;
    emit(tagEnd + 1 - j);
    if (WORKSPACE_SITE_RAW_TEXT_TAGS.has(name) && html[tagEnd - 1] !== '/') raw = name;
  }
  return out;
}

/** 부모가 "이 좌표의 요소" 를 묻는 메시지의 표식. */
export const WORKSPACE_SITE_INSPECT_REQUEST = '__vibisualSiteInspect';
/** 페이지가 답하는 메시지의 표식. */
export const WORKSPACE_SITE_INSPECT_RESULT = '__vibisualSiteInspected';

/** 페이지가 돌려주는 요소 하나. 좌표는 **그 페이지 안**(iframe 로컬) 기준이다. */
export interface WorkspaceSiteInspectHit {
  /** iframe 로컬 좌표·크기(CSS px). */
  rect: { x: number; y: number; width: number; height: number };
  /** 소문자 태그 이름. */
  tag: string;
  /** `id` 속성(없으면 빈 문자열). */
  id: string;
  /** `class` 속성 원문(없으면 빈 문자열). */
  cls: string;
  /** 눈에 보이는 글자(잘려 온다). */
  text: string;
  /** `class`·`style` 을 뺀 속성들 — `이름="값"` 꼴로 이미 잘려 온다. */
  attrs: string[];
  /** `body` 아래에서의 짧은 선택자 경로. */
  path: string;
  /** 원본 위치 `"줄:칸"`. 스크립트가 만든 요소면 `null`. */
  at: string | null;
  /** 그 위치가 **몇 대 조상**의 것인가(0 = 이 요소 자신). */
  atHops: number;
  /** 이 요소 위로 더 올라갈 조상이 남았는가(휠로 부모 이동이 되는지). */
  hasParent: boolean;
}

/**
 * 주입되는 조각 — **묻는 말에만 답한다.**
 *
 * 부모가 `pointer-events:none` 으로 iframe 을 덮어 두므로 이 페이지는 마우스를 보지 못한다.
 * 그래서 키·마우스 리스너를 하나도 달지 않고, 부모가 좌표를 보내면 그 자리의 요소를 되짚어
 * 돌려주기만 한다(페이지의 손짓을 우리가 가로채는 일이 없다).
 */
export function workspaceSiteInspectorScript(): string {
  return [
    '<script>',
    '(function(){',
    `  var REQ=${JSON.stringify(WORKSPACE_SITE_INSPECT_REQUEST)},RES=${JSON.stringify(WORKSPACE_SITE_INSPECT_RESULT)};`,
    `  var SRC=${JSON.stringify(WORKSPACE_SITE_SOURCE_ATTR)};`,
    '  function attr(el,n){try{return el.getAttribute(n)||""}catch(e){return ""}}',
    '  function clip(s,n){s=String(s||"");return s.length>n?s.slice(0,n)+"\\u2026":s}',
    '  function classes(el,n){return attr(el,"class").split(/\\s+/).filter(Boolean).slice(0,n)}',
    '  function seg(el){',
    '    var out=el.tagName.toLowerCase();',
    '    if(el.id) return out+"#"+el.id;',
    '    var c=classes(el,2);',
    '    return c.length?out+"."+c.join("."):out;',
    '  }',
    '  function path(el){',
    '    var segs=[],cur=el;',
    '    while(cur&&cur.nodeType===1&&cur!==document.documentElement){',
    '      segs.unshift(seg(cur));',
    '      if(cur.id) break;',
    '      cur=cur.parentElement;',
    '    }',
    '    if(segs.length>6) segs=segs.slice(0,2).concat(["\\u2026"],segs.slice(-3));',
    '    return segs.join(" > ");',
    '  }',
    '  function attrs(el){',
    '    var out=[];',
    '    try{',
    '      for(var k=0;k<el.attributes.length;k++){',
    '        var a=el.attributes[k],n=a.name;',
    '        if(n==="class"||n==="style"||n===SRC) continue;',
    '        out.push(a.value===""?n:n+"=\\""+clip(a.value,60)+"\\"");',
    '        if(out.length>=8) break;',
    '      }',
    '    }catch(e){}',
    '    return out;',
    '  }',
    '  function where(el){',
    '    var cur=el,hops=0;',
    '    while(cur&&cur.nodeType===1){',
    '      var v=attr(cur,SRC);',
    '      if(v) return {at:v,atHops:hops};',
    '      cur=cur.parentElement;hops++;',
    '    }',
    '    return {at:null,atHops:0};',
    '  }',
    '  function pick(x,y,depth){',
    '    var el=document.elementFromPoint(x,y);',
    '    if(!el) return null;',
    '    for(var k=0;k<depth&&el.parentElement;k++) el=el.parentElement;',
    '    var r=el.getBoundingClientRect(),w=where(el);',
    '    return {',
    '      rect:{x:r.left,y:r.top,width:r.width,height:r.height},',
    '      tag:el.tagName.toLowerCase(),id:el.id||"",cls:attr(el,"class"),',
    '      text:clip((el.innerText||el.textContent||"").replace(/\\s+/g," ").trim(),120),',
    '      attrs:attrs(el),path:path(el),at:w.at,atHops:w.atHops,',
    '      hasParent:!!el.parentElement',
    '    };',
    '  }',
    '  addEventListener("message",function(e){',
    '    var d=e.data;',
    '    if(!d||d[REQ]!==true) return;',
    // 부모만 물을 수 있다 — 페이지가 띄운 다른 프레임이 우리 창구를 흉내내지 못하게.
    '    if(e.source&&e.source!==parent) return;',
    '    var hit=null;',
    '    try{hit=pick(d.x,d.y,d.depth||0)}catch(err){}',
    '    var m={};m[RES]=true;m.id=d.id;m.hit=hit;m.url=location.href;',
    '    try{parent.postMessage(m,"*")}catch(err){}',
    '  });',
    '})();',
    '</script>',
  ].join('');
}
