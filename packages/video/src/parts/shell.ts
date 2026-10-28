/**
 * §5.13 (V) 37-11 — 부품 공통 뼈대(순수). 모든 부품에 `vibi-props`·스타일 변수(`--vibi-accent`·`--vibi-bg`·`--vibi-fg`·`--vibi-muted`·`--vibi-font`)·
 * `vibi:responsive` 를 똑같이 깐다. 움직임은 `__vibi.seek(t)` 하나(t 의 순수 함수). ⚠ 실행되는 HTML·JS 문자열 — 백틱·`${` ❌, 외부 라이브러리·바깥 주소 ❌((B)).
 */

export interface PartShellArgs {
  readonly title: string;
  readonly duration: number;
  readonly width: number;
  readonly height: number;
  /** 값 선언(`vibi-props` 그대로). */
  readonly props: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly css: string;
  readonly body: string;
  /** `vibi`(=`window.__vibi`)·`W`·`H`·`S`(짧은 변)·`P(name, fallback)`·도우미가 준비된 뒤 도는 스크립트. `vibi.seek` 를 정한다. */
  readonly script: string;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** `<script>` 안에 그대로 넣을 JSON(`</script>` 조기 종료·줄 구분 문자 방지). */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .split(String.fromCharCode(0x2028)).join('\\u2028')
    .split(String.fromCharCode(0x2029)).join('\\u2029');
}

/** 모든 부품이 쓰는 도우미(부드러운 곡선·자르기·값 읽기·목록 읽기). */
const HELPERS = [
  'var vibi = window.__vibi || (window.__vibi = { props: {} });',
  'var W = vibi.width || DESIGN_W;',
  'var H = vibi.height || DESIGN_H;',
  'var S = Math.min(W, H);',
  'document.documentElement.style.setProperty("--W", W + "px");',
  'document.documentElement.style.setProperty("--H", H + "px");',
  'document.documentElement.style.setProperty("--S", S + "px");',
  'function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }',
  'function lerp(a, b, p) { return a + (b - a) * p; }',
  'function prog(t, a, b) { return b <= a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a), 0, 1); }',
  'function easeOut(p) { return 1 - Math.pow(1 - clamp(p, 0, 1), 3); }',
  'function easeInOut(p) { p = clamp(p, 0, 1); return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }',
  'function easeBack(p) { p = clamp(p, 0, 1); var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); }',
  'function P(name, fallback) { var v = vibi.props && vibi.props[name]; return v === undefined || v === null || v === "" ? fallback : v; }',
  'function N(name, fallback) { var v = Number(P(name, fallback)); return isFinite(v) ? v : fallback; }',
  'function LIST(name, fallback) { var v = P(name, fallback); if (Array.isArray(v)) return v.map(String); return String(v).split(/[,\\n]/).map(function (s) { return s.trim(); }).filter(function (s) { return s !== ""; }); }',
  'function NUMS(name, fallback) { return LIST(name, fallback).map(function (s) { var n = Number(s); return isFinite(n) ? n : 0; }); }',
  'function el(id) { return document.getElementById(id); }',
].join('\n');

/** 부품 HTML 한 장. */
export function partHtml(a: PartShellArgs): string {
  const w = Math.max(16, Math.round(a.width));
  const h = Math.max(16, Math.round(a.height));
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="vibi:duration" content="${a.duration}">
<meta name="vibi:size" content="${w}x${h}">
<meta name="vibi:responsive" content="true">
<title>${escapeHtml(a.title)}</title>
<script type="application/json" id="vibi-props">${scriptJson(a.props)}</script>
<style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
  body { font-family: var(--vibi-font, system-ui, -apple-system, "Segoe UI", sans-serif); color: var(--vibi-fg, #f8fafc); }
  * { box-sizing: border-box; }
${a.css}
</style>
</head>
<body>
${a.body}
<script>
  var DESIGN_W = ${w};
  var DESIGN_H = ${h};
  var DESIGN_D = ${a.duration};
${HELPERS}
  function DUR() { return vibi.duration || DESIGN_D; }
${a.script}
</script>
</body>
</html>
`;
}
