import { describe, it, expect } from 'vitest';
import {
  WORKSPACE_SITE_PATH,
  WORKSPACE_SITE_SOURCE_ATTR,
  annotateWorkspaceSiteSource,
  injectWorkspaceSiteAgents,
  isWorkspaceHtmlPath,
  parseWorkspaceSitePath,
  rewriteWorkspaceSiteCss,
  rewriteWorkspaceSiteHtml,
  workspaceSiteBase,
  workspaceSiteMime,
  workspaceSiteRewriteKind,
  workspaceSiteUrl,
} from '@vibisual/shared';

// shared 의 순수 판정 로직은 server 테스트에서 검증한다(pathCase.test.ts·windowDragRegion.test.ts 선례).
//
// §5.5 #17-27 ⑮ — 이 규약이 어긋나면 증상은 **흰 사각형 하나**다(404 도 오류도 화면에 안 뜬다).
// 조립(클라)과 해석(서버)이 같은 파일에 있는 이유가 그것이고, 여기서 그 왕복을 못 박는다.

const WIN_ROOT = 'C:/work/AIProjects/vibisual';
const NIX_ROOT = '/srv/projects/vibisual';

describe('isWorkspaceHtmlPath — 페이지로 여는 확장자', () => {
  it('html·htm·xhtml 은 페이지다', () => {
    expect(isWorkspaceHtmlPath('index.html')).toBe(true);
    expect(isWorkspaceHtmlPath('docs/a.htm')).toBe(true);
    expect(isWorkspaceHtmlPath('a.xhtml')).toBe(true);
  });

  it('대소문자를 가리지 않는다 — 윈도우에서 저장된 INDEX.HTML 도 페이지다', () => {
    expect(isWorkspaceHtmlPath('INDEX.HTML')).toBe(true);
    expect(isWorkspaceHtmlPath('C:\\proj\\Page.Html')).toBe(true);
  });

  it('이 항목이 넓히지 않는 것들 — md·svg·txt 는 종전대로 편집창', () => {
    expect(isWorkspaceHtmlPath('README.md')).toBe(false);
    expect(isWorkspaceHtmlPath('logo.svg')).toBe(false);
    expect(isWorkspaceHtmlPath('notes.txt')).toBe(false);
  });

  it('이름에 html 이 들어간 것과 확장자를 혼동하지 않는다', () => {
    expect(isWorkspaceHtmlPath('html')).toBe(false);
    expect(isWorkspaceHtmlPath('src/htmlParser.ts')).toBe(false);
  });
});

describe('workspaceSiteUrl / parseWorkspaceSitePath — 조립과 해석의 왕복', () => {
  it('윈도우 절대 경로 루트가 한 세그먼트로 접힌다(슬래시가 살아 나가지 않는다)', () => {
    const url = workspaceSiteUrl(WIN_ROOT, 'demo/index.html');
    expect(url.startsWith(`${WORKSPACE_SITE_PATH}/`)).toBe(true);
    // 루트가 쪼개지면 세그먼트 수가 늘어 서버가 다른 파일을 찾는다.
    const afterPrefix = url.slice(WORKSPACE_SITE_PATH.length + 1);
    expect(afterPrefix.split('/').length).toBe(3); // <루트> / demo / index.html
  });

  it('왕복해도 같은 루트·경로다 — 윈도우', () => {
    const url = workspaceSiteUrl(WIN_ROOT, 'demo/index.html');
    expect(parseWorkspaceSitePath(url)).toEqual({ root: WIN_ROOT, relPath: 'demo/index.html' });
  });

  it('왕복해도 같은 루트·경로다 — POSIX', () => {
    const url = workspaceSiteUrl(NIX_ROOT, 'a/b/c.html');
    expect(parseWorkspaceSitePath(url)).toEqual({ root: NIX_ROOT, relPath: 'a/b/c.html' });
  });

  it('공백·한글·#·?·& 가 든 이름이 살아 돌아온다', () => {
    const rel = '데모 폴더/a b#c?d&e.html';
    const url = workspaceSiteUrl(WIN_ROOT, rel);
    expect(url).not.toContain(' ');
    expect(url).not.toContain('#');
    expect(parseWorkspaceSitePath(url)).toEqual({ root: WIN_ROOT, relPath: rel });
  });

  it('역슬래시 경로도 슬래시로 정규화돼 나간다', () => {
    const url = workspaceSiteUrl(WIN_ROOT, 'demo\\sub\\index.html');
    expect(parseWorkspaceSitePath(url)).toEqual({ root: WIN_ROOT, relPath: 'demo/sub/index.html' });
  });

  it('캐시 토큰은 질의 문자열이라 경로 해석을 건드리지 않는다', () => {
    const url = workspaceSiteUrl(WIN_ROOT, 'index.html', 1712345678000);
    expect(url).toContain('?v=1712345678000');
    // 라우터가 넘겨주는 pathname 에는 질의가 없다 — 그 형태로 해석된다.
    expect(parseWorkspaceSitePath(url.split('?')[0] ?? '')).toEqual({ root: WIN_ROOT, relPath: 'index.html' });
  });

  it('토큰 0/미지정이면 질의를 붙이지 않는다(URL 이 매번 달라지면 캐시가 아무 뜻이 없다)', () => {
    expect(workspaceSiteUrl(WIN_ROOT, 'a.html')).not.toContain('?');
    expect(workspaceSiteUrl(WIN_ROOT, 'a.html', 0)).not.toContain('?');
  });

  it('상대 경로가 브라우저 규칙대로 풀린다 — 이 창구가 경로형인 유일한 이유', () => {
    const base = new URL(workspaceSiteUrl(WIN_ROOT, 'demo/index.html'), 'http://x');
    expect(new URL('style.css', base).pathname).toBe(
      new URL(workspaceSiteUrl(WIN_ROOT, 'demo/style.css'), 'http://x').pathname,
    );
    expect(new URL('../shared/a.js', base).pathname).toBe(
      new URL(workspaceSiteUrl(WIN_ROOT, 'shared/a.js'), 'http://x').pathname,
    );
  });

  it('우리 접두어가 아니면 null', () => {
    expect(parseWorkspaceSitePath('/api/workspace-media?root=x')).toBeNull();
    expect(parseWorkspaceSitePath('/iframe-proxy/localhost:5173/')).toBeNull();
    expect(parseWorkspaceSitePath(WORKSPACE_SITE_PATH)).toBeNull();
    expect(parseWorkspaceSitePath(`${WORKSPACE_SITE_PATH}/`)).toBeNull();
  });

  it('루트만 있으면 relPath 는 빈 문자열(서버가 index.html 을 찾는 자리)', () => {
    expect(parseWorkspaceSitePath(workspaceSiteBase(NIX_ROOT))).toEqual({ root: NIX_ROOT, relPath: '' });
  });

  it('깨진 퍼센트 인코딩은 우리 URL 이 아니다', () => {
    expect(parseWorkspaceSitePath(`${WORKSPACE_SITE_PATH}/%E0%A4%A/a.html`)).toBeNull();
  });

  it('세그먼트를 하나씩 푼다 — 이름 속 %2F 가 경로 구분자로 살아나지 않는다', () => {
    const parsed = parseWorkspaceSitePath(`${WORKSPACE_SITE_PATH}/${encodeURIComponent(NIX_ROOT)}/a%2Fb.html`);
    expect(parsed).toEqual({ root: NIX_ROOT, relPath: 'a/b.html' });
    // 한 번에 풀었다면 세그먼트가 둘로 갈렸을 것 — 여기서는 파일 이름 한 개다.
    expect(parsed?.relPath.split('/').length).toBe(2);
  });
});

describe('workspaceSiteMime — Content-Type 이 틀리면 그 자산은 없는 것과 같다', () => {
  it('웹 자산 표', () => {
    expect(workspaceSiteMime('a.html')).toBe('text/html; charset=utf-8');
    expect(workspaceSiteMime('a.css')).toBe('text/css; charset=utf-8');
    expect(workspaceSiteMime('a.mjs')).toBe('text/javascript; charset=utf-8');
    expect(workspaceSiteMime('a.woff2')).toBe('font/woff2');
  });

  it('그림·미디어는 이미 있는 두 표를 잇는다(새 표를 또 만들지 않는다)', () => {
    expect(workspaceSiteMime('a.png')).toBe('image/png');
    expect(workspaceSiteMime('a.svg')).toBe('image/svg+xml');
    expect(workspaceSiteMime('a.mp4')).toBe('video/mp4');
  });

  it('모르는 확장자는 옥텟 스트림', () => {
    expect(workspaceSiteMime('a.zzz')).toBe('application/octet-stream');
    expect(workspaceSiteMime('LICENSE')).toBe('application/octet-stream');
  });
});

describe('rewriteWorkspaceSiteHtml — 루트 절대 경로만 다시 쓴다', () => {
  const base = workspaceSiteBase(NIX_ROOT);

  it('src·href·action 이 기준 경로를 얻는다', () => {
    const out = rewriteWorkspaceSiteHtml(
      '<link href="/app.css"><script src="/main.js"></script><form action="/go">',
      base,
    );
    expect(out).toContain(`href="${base}/app.css"`);
    expect(out).toContain(`src="${base}/main.js"`);
    expect(out).toContain(`action="${base}/go"`);
  });

  it('상대 경로는 손대지 않는다 — 브라우저가 이미 옳게 푼다', () => {
    const html = '<link href="style.css"><img src="./img/a.png"><script src="../lib/b.js"></script>';
    expect(rewriteWorkspaceSiteHtml(html, base)).toBe(html);
  });

  it('프로토콜 상대·외부 URL 은 그대로 둔다', () => {
    const html = '<script src="//cdn.example.com/x.js"></script><a href="https://example.com">x</a>';
    expect(rewriteWorkspaceSiteHtml(html, base)).toBe(html);
  });

  it('이미 접두어가 붙은 것을 두 번 붙이지 않는다(새로고침마다 경로가 자라지 않는다)', () => {
    const once = rewriteWorkspaceSiteHtml('<link href="/a.css">', base);
    expect(rewriteWorkspaceSiteHtml(once, base)).toBe(once);
  });

  it('HTML 안의 style url(/…) 도 함께 고친다 — 그림만 빠지는 실패가 가장 오래 남는다', () => {
    const out = rewriteWorkspaceSiteHtml('<style>body{background:url(/bg.png)}</style>', base);
    expect(out).toContain(`url(${base}/bg.png)`);
  });
});

describe('rewriteWorkspaceSiteCss', () => {
  const base = workspaceSiteBase(WIN_ROOT);

  it('따옴표가 있든 없든 url(/…) 을 고친다', () => {
    const out = rewriteWorkspaceSiteCss("a{background:url(/a.png)}b{background:url('/b.png')}", base);
    expect(out).toContain(`url(${base}/a.png)`);
    expect(out).toContain(`url('${base}/b.png')`);
  });

  it('상대 url 과 data: 는 그대로', () => {
    const css = 'a{background:url(./a.png)}b{background:url(data:image/png;base64,AAA)}';
    expect(rewriteWorkspaceSiteCss(css, base)).toBe(css);
  });
});

describe('workspaceSiteRewriteKind — 본문을 다시 쓰는 것은 두 갈래뿐', () => {
  it('HTML 계열과 CSS 만', () => {
    expect(workspaceSiteRewriteKind('a.html')).toBe('html');
    expect(workspaceSiteRewriteKind('a.xhtml')).toBe('html');
    expect(workspaceSiteRewriteKind('a.css')).toBe('css');
  });

  it('나머지는 바이트 그대로 흘린다 — JS·그림을 정규식으로 훑지 않는다', () => {
    expect(workspaceSiteRewriteKind('a.js')).toBeNull();
    expect(workspaceSiteRewriteKind('a.png')).toBeNull();
    expect(workspaceSiteRewriteKind('a.wasm')).toBeNull();
  });
});

// ─── ⑮ (i) 시작 태그마다 원본 줄:칸 ────────────────────────────────────────────
//
// 이 주석이 어긋나면 Alt+클릭이 **엉뚱한 줄**을 가리킨다 — 틀린 위치는 없는 위치보다 나쁘다
// (받은 쪽이 그 줄을 믿고 고치기 시작한다). 그래서 손으로 쓴 HTML 이 흔히 담는 함정들을
// 하나씩 못 박는다.

/** `data-vib-src="L:C"` 를 전부 뽑아 `[줄, 칸]` 목록으로. */
function positions(html: string): string[] {
  return [...html.matchAll(/data-vib-src="(\d+:\d+)"/g)].map((m) => m[1] as string);
}

describe('annotateWorkspaceSiteSource — 시작 태그의 자리를 원본 기준으로 적는다', () => {
  it('줄과 칸은 1부터, 여는 꺾쇠의 자리다', () => {
    const html = '<html>\n<body>\n  <p>hi</p>\n</body>\n</html>';
    expect(positions(annotateWorkspaceSiteSource(html))).toEqual(['1:1', '2:1', '3:3']);
  });

  it('주석·DOCTYPE 안의 태그는 요소가 아니다', () => {
    const html = '<!doctype html>\n<!-- <div>주석</div> -->\n<p>x</p>';
    const out = annotateWorkspaceSiteSource(html);
    expect(positions(out)).toEqual(['3:1']);
    expect(out).toContain('<!-- <div>주석</div> -->');
    expect(out).toContain('<!doctype html>');
  });

  it('script·style·textarea·title 안의 글자는 마크업이 아니다', () => {
    const html = [
      '<script>var s = "<section>x</section>";</script>',
      '<style>.a{content:"<div>"}</style>',
      '<textarea><span>literal</span></textarea>',
    ].join('\n');
    const out = annotateWorkspaceSiteSource(html);
    // 바깥 세 태그만 주석이 붙고 안쪽 글자는 한 글자도 안 바뀐다.
    expect(positions(out)).toEqual(['1:1', '2:1', '3:1']);
    expect(out).toContain('var s = "<section>x</section>";');
    expect(out).toContain('.a{content:"<div>"}');
    expect(out).toContain('><span>literal</span><');
  });

  it('속성 값 안의 꺾쇠에 속지 않는다', () => {
    const html = '<div data-x="a>b" class="w">\n  <p>y</p>\n</div>';
    const out = annotateWorkspaceSiteSource(html);
    expect(positions(out)).toEqual(['1:1', '2:3']);
    expect(out).toContain('data-x="a>b"');
    expect(out).toContain('class="w"');
  });

  it('자기 닫는 태그·닫는 태그를 구분한다', () => {
    const html = '<div>\n<img src="a.png"/>\n<br>\n</div>';
    expect(positions(annotateWorkspaceSiteSource(html))).toEqual(['1:1', '2:1', '3:1']);
  });

  it('닫히지 않은 태그는 손대지 않는다(고쳐 쓰다 페이지를 망가뜨리지 않는다)', () => {
    const html = '<p>ok</p>\n<div class="never-closed';
    const out = annotateWorkspaceSiteSource(html);
    expect(positions(out)).toEqual(['1:1']);
    expect(out.endsWith('<div class="never-closed')).toBe(true);
  });

  it('두 번 돌려도 주석이 겹치지 않는다(멱등)', () => {
    const html = '<div>\n  <p>x</p>\n</div>';
    const once = annotateWorkspaceSiteSource(html);
    expect(annotateWorkspaceSiteSource(once)).toBe(once);
  });

  it('요소가 없으면 한 글자도 바뀌지 않는다', () => {
    const html = 'plain text with 3 < 4 and a > b';
    expect(annotateWorkspaceSiteSource(html)).toBe(html);
  });

  it('주석은 재작성 정규식(src|href|action)에 걸리지 않는다 — 순서가 안전하다', () => {
    const html = '<div>\n  <img src="/a.png">\n</div>';
    const out = rewriteWorkspaceSiteHtml(annotateWorkspaceSiteSource(html), '/api/workspace-site/R');
    expect(out).toContain('src="/api/workspace-site/R/a.png"');
    // `data-vib-src="2:3"` 은 값이 `/` 로 시작하지 않아 그대로 남는다.
    expect(out).toContain(`${WORKSPACE_SITE_SOURCE_ATTR}="2:3"`);
    expect(out).not.toContain('/api/workspace-site/R2:3');
  });
});

describe('injectWorkspaceSiteAgents — 부모와 말하는 두 조각', () => {
  it('<head> 바로 뒤에 들어가고, 위치 신고와 요소 집기가 함께 실린다', () => {
    const out = injectWorkspaceSiteAgents('<html><head><title>t</title></head><body></body></html>');
    const at = out.indexOf('<script>');
    expect(at).toBe('<html><head>'.length);
    expect(out).toContain('__vibisualSitePage');
    expect(out).toContain('__vibisualSiteInspect');
    expect(out).toContain('__vibisualSiteInspected');
  });

  it('<head> 가 없으면 <html> 뒤, 그것도 없으면 맨 앞', () => {
    expect(injectWorkspaceSiteAgents('<html><body>x</body></html>').indexOf('<script>')).toBe('<html>'.length);
    expect(injectWorkspaceSiteAgents('<p>x</p>').indexOf('<script>')).toBe(0);
  });
});
