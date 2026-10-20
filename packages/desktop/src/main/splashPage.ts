// SCENARIO.md §3.7 · §9 「시작 화면(스플래시)」 — 스플래시 창이 띄우는 한 장짜리 문서(순수 함수).
//
// 동의 창(`consentPage.ts`)과 같은 규율이다 — data: 문서 · nonce CSP · 바깥 자원 0(글꼴·그림·주소 없음) · 글자는
// textContent 로만. 진척은 preload 가 넘겨 주는 메시지 포트로 받는다(`window.vibSplash.onUpdate`). 그 포트는 본체가
// 메인 스레드를 붙잡고 있어도 곧바로 닿으므로, 프로젝트 복원 중에도 막대와 문구가 실제 진척대로 움직인다.
//
// 막대는 "다음 소식이 올 때까지 천장 쪽으로 천천히" 다가간다 — 소식이 끊긴 구간(본체 모듈을 읽는 동기 구간 등)에도
// 멎어 보이지 않게. 천장은 다음 단계의 시작을 넘지 않으므로 막대가 뒤로 가지 않는다(`SPLASH_STAGE_BANDS`).
// 움직임은 전부 합성 단계에서 도는 transform 이다(SVG 회전 ❌ — 배율이 100% 가 아니면 메인 스레드에서 돈다).
//
// 아이콘은 이모지 ❌ — 로고는 앱 아이콘과 같은 버블 그라데이션(`favicon.svg`), 그 둘레를 위성 하나가 돈다.

import type { SplashPalette, SplashView } from './splashPolicy';

export interface SplashPageInput {
  nonce: string;
  /** `<html lang>` — 한중일 글꼴 선택과 화면 낭독기가 쓰는 값. */
  locale: string;
  view: SplashView;
  palette: SplashPalette;
  /** `v0.2.3` 처럼 보일 판올림. */
  version: string;
  progressLabel: string;
}

const NONCE_RE = /^[A-Za-z0-9+/=_-]{16,128}$/;
const LOCALE_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const CSS_COLOR_RE = /^(?:#[0-9a-fA-F]{6}|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0|1|0?\.\d+)\s*\))$/;

/** `<script>` 안에 싣는 JSON — `</script>`·줄 구분자로 문서를 깨지 못하게(동의 창과 같은 처리). */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function cssColor(value: string, fallback: string): string {
  return CSS_COLOR_RE.test(value) ? value : fallback;
}

/** HTML 속성·본문에 들어갈 짧은 글자(판올림·접근성 이름) — 마크업 문자를 바꿔 둔다. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => (
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;'
  ));
}

export function splashPage(input: SplashPageInput): string {
  if (!NONCE_RE.test(input.nonce)) throw new Error('splash nonce has an unexpected shape');
  const nonce = input.nonce;
  const lang = LOCALE_RE.test(input.locale) ? input.locale : 'en';
  const p = input.palette;
  const light = p.kind === 'light';
  const colors = {
    bg: cssColor(p.background, '#030712'),
    fg: cssColor(p.foreground, '#f1f5f9'),
    muted: cssColor(p.muted, '#94a3b8'),
    faint: cssColor(p.faint, '#64748b'),
    track: cssColor(p.track, 'rgba(148, 163, 184, 0.18)'),
    border: cssColor(p.border, 'rgba(148, 163, 184, 0.16)'),
  };
  const payload = scriptJson({ view: input.view });
  const version = escapeHtml(input.version.slice(0, 40));
  const progressLabel = escapeHtml(input.progressLabel.slice(0, 80));
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'">
<title>Vibisual</title>
<style nonce="${nonce}">
:root { color-scheme: ${light ? 'light' : 'dark'}; --bg: ${colors.bg}; --fg: ${colors.fg}; --muted: ${colors.muted}; --faint: ${colors.faint}; --track: ${colors.track}; --border: ${colors.border}; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; background: var(--bg); }
body { background: var(--bg); color: var(--fg); overflow: hidden; cursor: default; -webkit-user-select: none; user-select: none;
  font: 13px/1.5 "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR", "Noto Sans KR", "Noto Sans", Ubuntu, Cantarell, sans-serif; }
.frame { position: relative; height: 100vh; display: flex; flex-direction: column; padding: 36px 38px 24px; border: 1px solid var(--border); overflow: hidden; }
.glow { position: absolute; left: -150px; top: -170px; width: 460px; height: 460px; border-radius: 50%; pointer-events: none;
  background: radial-gradient(closest-side, rgba(96, 165, 250, ${light ? '0.16' : '0.22'}), rgba(139, 92, 246, ${light ? '0.08' : '0.10'}) 55%, rgba(139, 92, 246, 0) 100%); }
.brand { position: relative; flex: 1; display: flex; align-items: center; gap: 22px; }
.mark { position: relative; flex: none; width: 76px; height: 76px; }
.mark svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.orbit { position: absolute; inset: 0; border-radius: 50%; border: 1px solid rgba(139, 92, 246, ${light ? '0.30' : '0.38'}); animation: vb-spin 3.4s linear infinite; will-change: transform; }
.satellite { position: absolute; top: -4px; left: 50%; width: 8px; height: 8px; margin-left: -4px; border-radius: 50%; background: #a78bfa; box-shadow: 0 0 10px rgba(167, 139, 250, 0.85); }
h1 { font-size: 32px; font-weight: 650; letter-spacing: -0.01em; line-height: 1.1; }
.tagline { margin-top: 7px; color: var(--muted); font-size: 13.5px; }
.status { position: relative; display: flex; flex-direction: column; gap: 9px; }
.line { display: flex; align-items: baseline; justify-content: space-between; gap: 18px; min-height: 20px; }
#text { flex: 1 1 auto; min-width: 0; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#detail { flex: 0 1 auto; max-width: 46%; color: var(--faint); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar { position: relative; height: 3px; border-radius: 3px; background: var(--track); overflow: hidden; }
.fill { position: absolute; inset: 0; border-radius: 3px; transform-origin: 0 50%; transform: scaleX(0); will-change: transform; background: linear-gradient(90deg, #60a5fa, #8b5cf6); }
.sheen { position: absolute; top: 0; bottom: 0; left: 0; width: 28%; transform: translateX(-120%); will-change: transform;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0), rgba(255, 255, 255, ${light ? '0.55' : '0.30'}), rgba(255, 255, 255, 0)); animation: vb-sheen 1.7s ease-in-out infinite; }
.meta { display: flex; justify-content: space-between; gap: 16px; color: var(--faint); font-size: 12px; }
@keyframes vb-spin { to { transform: rotate(360deg); } }
@keyframes vb-sheen { to { transform: translateX(460%); } }
@media (prefers-reduced-motion: reduce) { .orbit, .sheen { animation: none; } .sheen { display: none; } }
</style></head><body>
<main class="frame">
<div class="glow" aria-hidden="true"></div>
<header class="brand">
<div class="mark" aria-hidden="true">
<svg viewBox="0 0 76 76" fill="none"><defs>
<linearGradient id="vb-bubble" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#60A5FA"/><stop offset="1" stop-color="#8B5CF6"/></linearGradient>
<radialGradient id="vb-shine" cx="0.34" cy="0.28" r="0.62"><stop offset="0" stop-color="#ffffff" stop-opacity="0.5"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
</defs><circle cx="38" cy="38" r="25" fill="url(#vb-bubble)"/><circle cx="38" cy="38" r="25" fill="url(#vb-shine)"/></svg>
<div class="orbit"><span class="satellite"></span></div>
</div>
<div><h1>Vibisual</h1><p class="tagline">See your AI agents think.</p></div>
</header>
<footer class="status">
<div class="line"><p id="text" role="status" aria-live="polite"></p><p id="detail"></p></div>
<div class="bar" id="bar" role="progressbar" aria-label="${progressLabel}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="fill" id="fill"></div><div class="sheen"></div></div>
<div class="meta"><span>Visual Development Environment</span><span>${version}</span></div>
</footer>
</main>
<script nonce="${nonce}">
'use strict';
const data = ${payload};
const byId = (id) => document.getElementById(id);
const text = byId('text'), detail = byId('detail'), fill = byId('fill'), bar = byId('bar');
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let floor = 0;
let creep = 0;
function setBar(value, ms) {
  fill.style.transition = ms > 0 && !reduce ? 'transform ' + ms + 'ms cubic-bezier(.2,.7,.2,1)' : 'none';
  fill.style.transform = 'scaleX(' + value + ')';
}
function apply(view) {
  if (!view || typeof view !== 'object') return;
  if (typeof view.text === 'string') text.textContent = view.text;
  detail.textContent = typeof view.detail === 'string' ? view.detail : '';
  const progress = Math.max(floor, Math.min(1, Number(view.progress) || 0));
  const ceiling = Math.max(progress, Math.min(1, Number(view.ceiling) || progress));
  floor = progress;
  bar.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
  clearTimeout(creep);
  setBar(progress, 320);
  if (ceiling > progress && !reduce) creep = setTimeout(() => setBar(progress + (ceiling - progress) * 0.85, 9000), 340);
}
apply(data.view);
const bridge = window.vibSplash;
if (bridge && typeof bridge.onUpdate === 'function') bridge.onUpdate(apply);
</script></body></html>`;
}
