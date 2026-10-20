import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

import { COMPOSITION_CLOCK_EPOCH, COMPOSITION_WEB_EXTENSIONS } from '../constants.js';
import {
  COMPOSITION_RUNTIME_JS,
  compositionCsp,
  compositionFolderOf,
  compositionMimeType,
  compositionRuntimeScript,
  compositionSeed,
  compositionSkeleton,
  injectCompositionRuntime,
  isCompositionHtmlPath,
  isCompositionWebFile,
  isProjectRelativePath,
  localReferences,
  parseCompositionMeta,
  parsePropsDecl,
  parseCompositionSize,
  safeCompositionName,
  scanComposition,
  toPosixPath,
} from './index.js';
import type { CompositionRuntimeInit, CompositionSources } from './index.js';

/**
 * §5.13 (T-1)(T-2)(T-3) — 코드 컴포지션의 순수 층.
 *
 * 컴포지션은 에이전트가 쓴 HTML 이 영상의 한 아이템이 되는 길이다. 여기서 틀리면 증상이 늦게 온다 — 경로 판정이
 * 새면 프로젝트 밖 파일이 영상에 찍히고, 런타임 심이 깨지면 렌더 30초 뒤에 빈 화면이 나온다. 그래서 문자열 판정과
 * 심의 대화(seek → ready)를 창 없이 여기서 못 박는다.
 */

describe('§5.13 (T-1) 컴포지션 경로 판정', () => {
  it('문서에 적는 경로는 늘 / 구분이다', () => {
    expect(toPosixPath('a\\b\\index.html')).toBe('a/b/index.html');
    expect(toPosixPath('a/b/index.html')).toBe('a/b/index.html');
  });

  it('진입 파일은 .html/.htm 하나다(대소문자 무관)', () => {
    expect(isCompositionHtmlPath('x/index.html')).toBe(true);
    expect(isCompositionHtmlPath('x/INDEX.HTM')).toBe(true);
    expect(isCompositionHtmlPath('x/index.html ')).toBe(true);
    expect(isCompositionHtmlPath('x/index.js')).toBe(false);
    expect(isCompositionHtmlPath('x/html')).toBe(false);
  });

  it('프로젝트 루트 기준 상대 경로만 받는다 — 절대·드라이브·UNC·.. 는 밖으로 샌다', () => {
    expect(isProjectRelativePath('.vibisual/video/compositions/intro/index.html')).toBe(true);
    expect(isProjectRelativePath('a\\b\\index.html')).toBe(true);
    expect(isProjectRelativePath('a/..b/index.html')).toBe(true); // '..b' 는 상위 폴더가 아니다
    expect(isProjectRelativePath('/etc/index.html')).toBe(false);
    expect(isProjectRelativePath('C:/x/index.html')).toBe(false);
    expect(isProjectRelativePath('c:\\x\\index.html')).toBe(false);
    expect(isProjectRelativePath('\\\\server\\share\\index.html')).toBe(false);
    expect(isProjectRelativePath('../outside/index.html')).toBe(false);
    expect(isProjectRelativePath('a/../../index.html')).toBe(false);
    expect(isProjectRelativePath('')).toBe(false);
    expect(isProjectRelativePath('   ')).toBe(false);
  });

  it('컴포지션 폴더는 진입 파일이 있는 폴더다', () => {
    expect(compositionFolderOf('a/b/index.html')).toBe('a/b');
    expect(compositionFolderOf('a\\b\\c.html')).toBe('a/b');
    expect(compositionFolderOf('index.html')).toBe('');
  });

  it('내주는 웹 형식만 통과하고, 통과하는 형식은 모두 응답 형식이 있다', () => {
    expect(isCompositionWebFile('x/a.PNG')).toBe(true);
    expect(isCompositionWebFile('x/font.woff2')).toBe(true);
    expect(isCompositionWebFile('x/a.mp4')).toBe(false);
    expect(isCompositionWebFile('x/noext')).toBe(false);
    expect(isCompositionWebFile('x/.env')).toBe(false);
    // 목록에 확장자를 더하고 응답 형식을 빠뜨리면 그 파일은 내줄 수 있다고 판정되고도 404 가 된다.
    for (const ext of COMPOSITION_WEB_EXTENSIONS) expect(compositionMimeType(`f${ext}`), ext).not.toBeNull();
    expect(compositionMimeType('a.html')).toBe('text/html; charset=utf-8');
    expect(compositionMimeType('a.mjs')).toBe('text/javascript; charset=utf-8');
    expect(compositionMimeType('a.exe')).toBeNull();
    expect(compositionMimeType('noext')).toBeNull();
  });

  it('폴더 이름은 세 OS 어디서나 만들 수 있는 이름이다', () => {
    expect(safeCompositionName('Intro Title!')).toBe('intro-title');
    expect(safeCompositionName('café')).toBe('cafe');
    expect(safeCompositionName('CON')).toBe('comp');
    expect(safeCompositionName('nul')).toBe('comp');
    expect(safeCompositionName('com1')).toBe('comp');
    expect(safeCompositionName('한글 제목')).toBe('comp');
    expect(safeCompositionName('con-tent')).toBe('con-tent');
    expect(safeCompositionName('a'.repeat(100))).toHaveLength(40);
    expect(safeCompositionName('a<b>c:d"e|f?g*h')).toMatch(/^[a-z0-9_-]+$/);
  });
});

describe('§5.13 (T-1) 자기 선언(meta) 읽기', () => {
  it('길이·크기·라이브러리를 속성 순서·따옴표·대소문자와 무관하게 읽는다', () => {
    const html = '<head><meta name="vibi:duration" content="6"><meta content=\'1920x1080\' name=\'vibi:size\'>'
      + '<META NAME=vibi:libs CONTENT="gsap, lottie"></head>';
    expect(parseCompositionMeta(html)).toEqual({ duration: 6, width: 1920, height: 1080, libs: ['gsap', 'lottie'] });
  });

  it('쓸 수 없는 길이는 비운다', () => {
    for (const bad of ['0', '-1', 'abc', '']) {
      expect(parseCompositionMeta(`<meta name="vibi:duration" content="${bad}">`).duration, bad).toBeUndefined();
    }
  });

  it('크기는 1920x1080 · 1920×1080 · 1920 x 1080 · 1920*1080 을 받는다', () => {
    expect(parseCompositionSize('1920x1080')).toEqual({ width: 1920, height: 1080 });
    expect(parseCompositionSize('1920×1080')).toEqual({ width: 1920, height: 1080 });
    expect(parseCompositionSize(' 1920 x 1080 ')).toEqual({ width: 1920, height: 1080 });
    expect(parseCompositionSize('1920*1080')).toEqual({ width: 1920, height: 1080 });
    expect(parseCompositionSize('0x100')).toBeNull();
    expect(parseCompositionSize('big')).toBeNull();
  });

  it('로컬 스크립트·스타일 참조만 모은다 — 바깥 주소·data: 는 검사가 따로 잡는다', () => {
    const html = [
      '<script src="lib/gsap.min.js?v=2"></script>',
      '<script src="https://cdn.example.com/y.js"></script>',
      '<script src="//cdn.example.com/z.js"></script>',
      '<script src="data:text/javascript,1"></script>',
      '<script>inline()</script>',
      '<link rel="stylesheet" href="style.css#x">',
      '<link rel="icon" href="fav.png">',
    ].join('');
    expect(localReferences(html)).toEqual(['lib/gsap.min.js', 'style.css']);
  });
});

describe('§5.13 (T-2) 결정성 검사', () => {
  const scan = (html: string, extra: Partial<CompositionSources> = {}) =>
    scanComposition({ html, scripts: extra.scripts ?? [], styles: extra.styles ?? [] });
  const codes = (html: string, extra: Partial<CompositionSources> = {}): string[] => scan(html, extra).lint.map((l) => l.code);
  const DECLARED = '<meta name="vibi:duration" content="4">';
  /** §5.13 (V) 37-5 — 값 선언까지 갖춘 깨끗한 머리. */
  const PROPS = '<script type="application/json" id="vibi-props">{"label":{"type":"text","default":"Hi"}}</script>';

  it('@keyframes 로만 움직이는 깨끗한 컴포지션은 아무것도 걸리지 않고 아무 시점으로나 맞출 수 있다', () => {
    const html = `<html><head>${DECLARED}${PROPS}<style>@keyframes a { from { opacity: 0 } to { opacity: 1 } } .t { animation: a 1s both; }</style></head>`
      + '<body><div class="t" data-vibi-prop="label">Hi</div></body></html>';
    expect(scan(html)).toEqual({ lint: [], mode: 'random' });
  });

  it('§5.13 (V) 37-5 — 값 선언이 없으면 안내하고, 틀리면 오류로 알린다', () => {
    expect(codes(`${DECLARED}<style>@keyframes a {}</style>`)).toContain('no-props-decl');
    expect(codes(`${DECLARED}<script type="application/json" id="vibi-props">{ nope </script><style>@keyframes a {}</style>`)).toContain('props-decl-invalid');
    expect(codes(`${DECLARED}<script type="application/json" id="vibi-props">{"x":{"type":"weird"}}</script><style>@keyframes a {}</style>`)).toContain('props-decl-invalid');
  });

  const BLOCKED: Array<[string, string, Partial<CompositionSources>]> = [
    ['network', "<script>fetch('data.json')</script>", {}],
    ['network', '<script>var x = new XMLHttpRequest();</script>', {}],
    ['external-url', '<img src="https://example.com/a.png">', {}],
    ['external-url', '<script src="//cdn.example.com/x.js"></script>', {}],
    ['external-url', '', { styles: ['body { background: url(https://example.com/y.png) }'] }],
    ['media-element', '<video src="a.mp4"></video>', {}],
    ['sound-api', '<script>var ac = new AudioContext();</script>', {}],
    ['worker', "<script>new Worker('w.js')</script>", {}],
    ['storage', "<script>localStorage.setItem('a', 'b')</script>", {}],
    ['css-transition', '', { styles: ['.a { transition: opacity 1s }'] }],
    ['input-wait', "<script>document.addEventListener('click', go)</script>", {}],
  ];
  it.each(BLOCKED)('%s 를 렌더 전에 알려 준다 — %s', (code, html, extra) => {
    expect(codes(`${DECLARED}${html}`, extra)).toContain(code);
  });

  it('§5.13 (W) 38-9 — ES 모듈·import map 은 경고하지 않는다(샌드박스 + vibproxy 에서 로드되는 것을 실측했다)', () => {
    const html = `${DECLARED}<script type="importmap">{"imports":{"x":"./x.js"}}</script><script type="module" src="m.js"></script><script type="module">import y from 'x';</script>`;
    expect(codes(html)).not.toContain('module-script');
  });

  it('§5.13 (W) 38-9 — 렌더 엔진보다 새 기능을 이름과 함께 경고한다(엔진을 모르면 보지 않는다)', () => {
    const html = `${DECLARED}<style>.a { animation-delay: calc(sibling-index() * 80ms); text-box-trim: trim-both; }</style><script>Promise.try(go)</script>`;
    const old = scanComposition({ html, scripts: [], styles: [] }, { chromium: 126 });
    const hit = old.lint.find((l) => l.code === 'engine-unsupported');
    expect(hit?.level).toBe('warn');
    expect(hit?.message).toContain('Chromium 126');
    expect(hit?.message).toContain('sibling-index');
    expect(hit?.message).toContain('text-box');
    expect(hit?.message).toContain('Promise.try');
    // 새 엔진이면 그 기능들을 안다 — 경고가 사라진다.
    expect(scanComposition({ html, scripts: [], styles: [] }, { chromium: 152 }).lint.some((l) => l.code === 'engine-unsupported')).toBe(false);
    // 엔진을 모르는 자리(시험·서버만)는 검사하지 않는다.
    expect(scanComposition({ html, scripts: [], styles: [] }).lint.some((l) => l.code === 'engine-unsupported')).toBe(false);
  });

  it('§5.13 (W) 38-9 — 엔진이 아는 기능(linear() 이징·@starting-style)은 경고하지 않는다', () => {
    const html = `${DECLARED}<style>@starting-style { .a { opacity: 0 } } .a { transition-timing-function: linear(0, 0.6, 1); }</style>`;
    expect(scanComposition({ html, scripts: [], styles: [] }, { chromium: 126 }).lint.some((l) => l.code === 'engine-unsupported')).toBe(false);
  });

  it('prefetch( 같은 다른 낱말은 네트워크로 잡지 않는다', () => {
    expect(codes(`${DECLARED}<script>prefetch(1); el.animate([], 1000)</script>`)).not.toContain('network');
  });

  it('길이 선언이 없으면 경고한다', () => {
    expect(codes('<style>@keyframes a {}</style>')).toContain('no-duration');
  });

  it('프레임 콜백에 기대면 순방향 전용이 되고 그렇게 알린다', () => {
    const r = scan(`${DECLARED}<script>requestAnimationFrame(function loop() { requestAnimationFrame(loop); });</script>`);
    expect(r.mode).toBe('forward');
    expect(r.lint.map((l) => l.code)).toContain('frame-callbacks');
    expect(r.lint.map((l) => l.code)).not.toContain('no-motion');
  });

  it('시계·난수 호출은 가상화된다고 알려만 준다', () => {
    const r = scan(`${DECLARED}${PROPS}<script>window.__vibi.seek = function (t) { draw(t, Math.random(), Date.now()); };</script>`);
    expect(r.lint).toEqual([expect.objectContaining({ level: 'info', code: 'virtual-clock' })]);
    expect(r.mode).toBe('random');
  });

  it('시각을 받는 길이 없으면 움직이지 않는다고 경고한다 — __vibi.seek·element.animate 는 길로 친다', () => {
    expect(codes(`${DECLARED}<div>still</div>`)).toContain('no-motion');
    expect(codes(`${DECLARED}<script>window.__vibi.seek = function (t) {};</script>`)).not.toContain('no-motion');
    expect(codes(`${DECLARED}<script>el.animate([{ opacity: 0 }, { opacity: 1 }], 1000);</script>`)).not.toContain('no-motion');
  });

  it('새 컴포지션 뼈대는 검사를 깨끗하게 통과하고, 선언한 길이·크기를 다시 읽을 수 있다', () => {
    const html = compositionSkeleton({ title: 'Intro "quoted" </script>', duration: 6, width: 1280, height: 720 });
    const r = scanComposition({ html, scripts: [], styles: [] });
    expect(r.lint.filter((l) => l.level !== 'info')).toEqual([]);
    // §5.13 (V) 37-5 — 뼈대는 값 선언을 갖춘다(안내 줄도 없다).
    expect(r.lint.map((l) => l.code)).not.toContain('no-props-decl');
    expect(r.mode).toBe('random');
    expect(parseCompositionMeta(html)).toEqual({ duration: 6, width: 1280, height: 720, responsive: true });
    expect(parsePropsDecl(html).decl.map((d) => d.name)).toEqual(['title', 'accent', 'titleSize']);
    // 제목이 스크립트·태그를 끊지 않는다(값 선언 하나 + 그리기 스크립트 하나).
    expect(html).not.toContain('</script>"');
    expect(html.match(/<\/script>/g)).toHaveLength(2);
  });
});

describe('§5.13 (T-3) 런타임 주입·CSP', () => {
  const RUNTIME = '/*runtime*/';

  it('CSP 는 그 컴포지션의 앞머리 경로만 열고 바깥과는 한 바이트도 주고받지 않는다', () => {
    const prefix = 'vibproxy://proxy/api/app/vibistudio/content/p/d/';
    const csp = compositionCsp([prefix]);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`script-src ${prefix} 'unsafe-inline'`);
    expect(csp).toContain(`img-src ${prefix} data: blob:`);
    for (const closed of ['connect-src', 'media-src', 'frame-src', 'object-src', 'worker-src', 'base-uri', 'form-action']) {
      expect(csp).toContain(`${closed} 'none'`);
    }
    expect(csp).not.toMatch(/(^|\s)\*(\s|;|$)/);
  });

  it('<head> 맨 앞에 CSP 와 심을 넣는다 — 컴포지션 코드보다 먼저 선다', () => {
    const html = '<!doctype html><html><head lang="x"><script>user()</script></head><body>b</body></html>';
    const out = injectCompositionRuntime(html, "default-src 'none'", RUNTIME);
    expect(out.startsWith('<!doctype html><html><head lang="x"><meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(out.indexOf(RUNTIME)).toBeLessThan(out.indexOf('user()'));
    expect(out.endsWith('<body>b</body></html>')).toBe(true);
  });

  it('<head> 가 없으면 만든다 — <html> 뒤, doctype 뒤, 그것도 없으면 맨 앞', () => {
    const block = `<head><meta http-equiv="Content-Security-Policy" content="x"><script>${RUNTIME}</script></head>`;
    expect(injectCompositionRuntime('<html><body>x</body></html>', 'x', RUNTIME)).toBe(`<html>${block}<body>x</body></html>`);
    expect(injectCompositionRuntime('<!DOCTYPE html><p>x</p>', 'x', RUNTIME)).toBe(`<!DOCTYPE html>${block}<p>x</p>`);
    expect(injectCompositionRuntime('<p>x</p>', 'x', RUNTIME)).toBe(`${block}<p>x</p>`);
  });

  it('CSP 값은 속성 안에서 깨지지 않게 감싼다', () => {
    const out = injectCompositionRuntime('<head></head>', 'a"b<c>&d', RUNTIME);
    expect(out).toContain('content="a&quot;b&lt;c&gt;&amp;d"');
  });

  it('씨앗은 문서·아이템마다 정해진 32비트 수다', () => {
    const a = compositionSeed(7, 'comp-1');
    expect(compositionSeed(7, 'comp-1')).toBe(a);
    expect(compositionSeed(7, 'comp-2')).not.toBe(a);
    expect(compositionSeed(8, 'comp-1')).not.toBe(a);
    expect(Number.isInteger(compositionSeed(undefined, 'comp-1'))).toBe(true);
    for (const s of [a, compositionSeed(undefined, ''), compositionSeed(-5, 'x')]) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(2 ** 32);
    }
  });
});

describe('§5.13 (T-2) 런타임 심은 문자열이다 — 그대로 컴파일된다', () => {
  const INIT: CompositionRuntimeInit = { props: {}, seed: 7, itemId: 'comp-1', fps: 30, duration: 4, width: 640, height: 360 };

  it('심 본문이 JS 로 컴파일된다(템플릿 문자열 안의 백틱·${·역슬래시 사고를 잡는다)', () => {
    expect(() => new vm.Script(`(${COMPOSITION_RUNTIME_JS})`)).not.toThrow();
    expect(() => new vm.Script(compositionRuntimeScript(INIT))).not.toThrow();
  });

  it('props 안의 </script> 와 줄 구분 문자가 스크립트를 끊지 않는다', () => {
    const LS = String.fromCharCode(0x2028);
    const PS = String.fromCharCode(0x2029);
    const script = compositionRuntimeScript({ ...INIT, props: { title: '</script><b>x</b>', note: `a${LS}b${PS}c` } });
    expect(script).not.toContain('</script>');
    expect(script.includes(LS)).toBe(false);
    expect(script.includes(PS)).toBe(false);
    expect(() => new vm.Script(script)).not.toThrow();
    const props = JSON.parse(bootRuntime({ props: { title: '</script><b>x</b>', note: `a${LS}b${PS}c` } })
      .run<string>('JSON.stringify(window.__vibi.props)'));
    expect(props).toEqual({ title: '</script><b>x</b>', note: `a${LS}b${PS}c` });
  });
});

// ─── 심을 창 없이 돌린다 — vm 문맥에 iframe 이 가진 것만 흉내 낸 window 를 준다 ───

type Msg = Record<string, unknown>;

interface FakeAnimation {
  paused: boolean;
  currentTime: number;
  pause(): void;
}

function bootRuntime(init: Partial<CompositionRuntimeInit> = {}, manualPaint = false) {
  const messages: Msg[] = [];
  const waiters: Array<{ pred: (m: Msg) => boolean; resolve: (m: Msg) => void }> = [];
  const listeners = new Map<string, Array<(e: unknown) => void>>();
  const animations: FakeAnimation[] = [];
  const paints = new Map<number, (t: number) => void>();
  let paintId = 0;
  const parent = {
    postMessage(msg: unknown): void {
      const plain = JSON.parse(JSON.stringify(msg)) as Msg;
      messages.push(plain);
      for (const w of [...waiters]) {
        if (!w.pred(plain)) continue;
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(plain);
      }
    },
  };
  const sandbox: Record<string, unknown> = {
    parent,
    performance: { now: () => 0 },
    requestAnimationFrame: (cb: (t: number) => void) => {
      if (!manualPaint) return setTimeout(() => cb(0), 0);
      const id = ++paintId;
      paints.set(id, cb);
      return id;
    },
    cancelAnimationFrame: (id: ReturnType<typeof setTimeout> & number) => manualPaint ? paints.delete(id) : clearTimeout(id),
    setTimeout,
    clearTimeout,
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    document: {
      readyState: 'complete',
      images: [],
      addEventListener: () => undefined,
      getAnimations: () => animations,
      querySelector: () => null,
    },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext('var window = globalThis;', ctx);
  vm.runInContext(
    compositionRuntimeScript({ props: {}, seed: 7, itemId: 'comp-1', fps: 30, duration: 4, width: 640, height: 360, ...init }),
    ctx,
  );
  const waitFor = (pred: (m: Msg) => boolean): Promise<Msg> => {
    const hit = messages.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve) => waiters.push({ pred, resolve }));
  };
  const dispatch = (event: unknown): void => {
    for (const fn of listeners.get('message') ?? []) fn(event);
  };
  return {
    animations,
    messages,
    waitFor,
    dispatch,
    paints,
    paint(): void {
      const batch = [...paints.values()];
      paints.clear();
      for (const cb of batch) cb(0);
    },
    run<T>(code: string): T {
      return vm.runInContext(code, ctx) as T;
    },
    seek(t: number, seq: number, preview = false): Promise<Msg> {
      dispatch({ source: parent, data: { __vibi: 'seek', t, seq, preview } });
      return waitFor((m) => m.__vibi === 'ready' && m.seq === seq);
    },
  };
}

describe('§5.13 (T-2) 런타임 심 — 시각은 렌더러가 정한다', () => {
  it('live preview waits for its async drawing but does not wait two extra browser paints', async () => {
    const b = bootRuntime({}, true);
    b.run('var finishDraw; window.__vibi.seek = function (t) { return new Promise(function (resolve) { finishDraw = resolve; }); };');
    const ready = b.seek(1, 1, true);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(b.messages.some((m) => m.__vibi === 'ready')).toBe(false);
    b.run('finishDraw();');
    expect(await ready).toMatchObject({ t: 1, seq: 1 });
    expect(b.paints.size).toBe(0);
  });

  it('capture seeks retain both paint barriers even after a preview seek', async () => {
    const b = bootRuntime({}, true);
    await b.seek(0, 1, true);
    const captured = b.seek(1, 2);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(b.paints.size).toBe(1);
    expect(b.messages.some((m) => m.__vibi === 'ready' && m.seq === 2)).toBe(false);
    b.paint();
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(b.paints.size).toBe(1);
    expect(b.messages.some((m) => m.__vibi === 'ready' && m.seq === 2)).toBe(false);
    b.paint();
    expect(await captured).toMatchObject({ t: 1, seq: 2 });
    expect(b.paints.size).toBe(0);
  });

  it('preview still waits for pending fonts and image decoding before its ready signal', async () => {
    const b = bootRuntime({}, true);
    b.run('var fontDone, imageDone; document.fonts = { ready: new Promise(function (r) { fontDone = r; }) };'
      + 'document.images = [{ complete: false, decode: function () { return new Promise(function (r) { imageDone = r; }); } }];');
    const ready = b.seek(0, 1, true);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    b.run('fontDone();');
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(b.messages.some((m) => m.__vibi === 'ready')).toBe(false);
    b.run('imageDone();');
    expect(await ready).toMatchObject({ seq: 1 });
  });

  it('뜨면 loaded 를 알리고, 프레임 콜백이 없으면 아무 시점으로나 맞춘다', async () => {
    const b = bootRuntime();
    expect(await b.waitFor((m) => m.__vibi === 'loaded')).toEqual({
      __vibi: 'loaded',
      mode: 'random',
      declared: { duration: null, size: null },
      // §5.13 (Z) 41-1 — 직통 채널(포트)·스스로 재생을 받는 판이라고 알린다.
      port: true,
    });
  });

  it('seek 는 __vibi.seek(t) 를 부르고 같은 순번으로 ready 를 답한다 — 시계는 뒤로 갈 때도 t 를 읽는다', async () => {
    const b = bootRuntime();
    b.run('var seen = []; window.__vibi.seek = function (t) { seen.push([t, performance.now(), Date.now(), window.__vibi.time()]); };');
    expect(await b.seek(2, 1)).toEqual({ __vibi: 'ready', seq: 1, t: 2, mode: 'random' });
    expect(await b.seek(0.5, 2)).toMatchObject({ seq: 2, t: 0.5 });
    expect(JSON.parse(b.run<string>('JSON.stringify(seen)'))).toEqual([
      [2, 2000, COMPOSITION_CLOCK_EPOCH + 2000, 2],
      [0.5, 500, COMPOSITION_CLOCK_EPOCH + 500, 0.5],
    ]);
  });

  it('부모가 아닌 곳에서 온 seek 는 듣지 않는다', async () => {
    const b = bootRuntime();
    b.run('var calls = 0; window.__vibi.seek = function () { calls += 1; };');
    b.dispatch({ source: {}, data: { __vibi: 'seek', t: 1, seq: 9 } });
    await b.seek(1, 10);
    expect(b.run<number>('calls')).toBe(1);
    expect(b.messages.some((m) => m.__vibi === 'ready' && m.seq === 9)).toBe(false);
  });

  it('프레임 콜백은 출력 fps 가 아니라 60Hz 가상 틱마다 불고, 그 컴포지션은 순방향 전용이 된다', async () => {
    const b = bootRuntime();
    b.run('var frames = 0; function loop() { frames += 1; requestAnimationFrame(loop); } requestAnimationFrame(loop);');
    expect((await b.waitFor((m) => m.__vibi === 'loaded')).mode).toBe('forward');
    expect((await b.seek(1, 1)).mode).toBe('forward');
    expect(b.run<number>('frames')).toBe(61); // 0, 1/60, …, 60/60 초
  });

  it('타이머는 가상 시각 순서대로 분다(setInterval 은 다시 걸린다)', async () => {
    const b = bootRuntime();
    b.run("var log = []; setTimeout(function () { log.push('a'); }, 500); setTimeout(function () { log.push('b'); }, 100);"
      + " setInterval(function () { log.push('i'); }, 300);");
    await b.seek(0.4, 1);
    expect(JSON.parse(b.run<string>('JSON.stringify(log)'))).toEqual(['b', 'i']);
    await b.seek(1, 2);
    expect(JSON.parse(b.run<string>('JSON.stringify(log)'))).toEqual(['b', 'i', 'a', 'i', 'i']);
  });

  it('CSS·Web Animations 는 멈추고 t 로 맞춘다', async () => {
    const b = bootRuntime();
    const anim: FakeAnimation = { paused: false, currentTime: 0, pause(): void { this.paused = true; } };
    b.animations.push(anim);
    await b.seek(1.5, 1);
    expect(anim).toMatchObject({ paused: true, currentTime: 1500 });
  });

  it('타임라인 객체는 한 번 멈추고 매번 t 로 옮긴다(seek·currentTime 덕 타이핑)', async () => {
    const b = bootRuntime();
    b.run('var tl = { pauses: 0, at: [], pause: function () { this.pauses += 1; }, seek: function (t) { this.at.push(t); } };'
      + ' window.__vibi.timelines.push(tl); window.__timelines = { other: { currentTime: 0 } };');
    await b.seek(1, 1);
    await b.seek(2.5, 2);
    expect(JSON.parse(b.run<string>('JSON.stringify([tl.pauses, tl.at, window.__timelines.other.currentTime])')))
      .toEqual([1, [1, 2.5], 2500]);
  });

  it('난수는 씨앗이 같으면 같은 수열이다', () => {
    const draw = (seed: number): number[] =>
      JSON.parse(bootRuntime({ seed }).run<string>('JSON.stringify([Math.random(), Math.random(), Math.random()])')) as number[];
    const a = draw(7);
    expect(draw(7)).toEqual(a);
    expect(draw(8)).not.toEqual(a);
    for (const x of a) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('소리를 내는 API 는 던지지 않고 성공한 척한다(로드 때 AudioContext 부터 만드는 코드가 그림까지 멈추지 않게)', () => {
    const b = bootRuntime();
    const out = b.run<string>('var ac = new AudioContext(); var osc = ac.createOscillator(); osc.connect(ac.destination); osc.start(0);'
      + ' JSON.stringify([ac.state, typeof ac.resume().then, ac.sampleRate])');
    expect(JSON.parse(out)).toEqual(['running', 'function', 48000]);
  });

  it('window.__vibi 는 갈아 끼워지지 않고 더해지기만 한다 — 문서의 props 는 코드가 덮지 못한다', () => {
    const b = bootRuntime({ props: { title: 'From the document' } });
    const out = b.run<string>("window.__vibi = { props: { title: 'replaced' }, seek: function () {} };"
      + ' JSON.stringify([window.__vibi.props.title, typeof window.__vibi.seek, window.__vibi.item])');
    expect(JSON.parse(out)).toEqual(['From the document', 'function', 'comp-1']);
  });

  it('seek 안에서 던진 오류는 error 로 알리고 ready 는 그래도 답한다(렌더가 끝없이 기다리지 않게)', async () => {
    const b = bootRuntime();
    b.run("window.__vibi.seek = function () { throw new Error('boom'); };");
    expect((await b.seek(1, 1)).__vibi).toBe('ready');
    expect(b.messages.some((m) => m.__vibi === 'error' && String(m.message).includes('boom'))).toBe(true);
  });
});
