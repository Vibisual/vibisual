/**
 * §5.13 (T-5) — 새 컴포지션의 뼈대 HTML (순수).
 *
 * `POST /composition` 이 기본 자리에 이 파일을 쓴다. 에이전트가 처음부터 쓸 수도 있지만, 뼈대가 meta 셋과 두 가지
 * 시각 맞춤 길(CSS `@keyframes` · `__vibi.seek` 캔버스)을 보여 주면 자리와 규약을 틀리지 않는다. 사람이 열어도 읽히게
 * 짧게 둔다 — 화려함은 에이전트·사람이 채운다.
 *
 * §5.13 (V) 37-5·37-10·37-15 — 뼈대가 규약 셋을 그대로 보인다: ① 값 선언(`vibi-props` — 사람이 바꿀 글자·색은 코드 밖으로)과
 * 묶기(`data-vibi-prop`), ② 스타일 변수(`--vibi-accent`·`--vibi-fg`·`--vibi-font` — 문서 스타일이 있으면 그것으로 칠한다),
 * ③ 판형 반응형(`vibi:responsive` — `__vibi.width/height` 로 상자 크기에 맞춘다).
 */

import { COMPOSITION_DEFAULT_DURATION } from '../constants.js';

export interface CompositionSkeletonArgs {
  readonly title: string;
  readonly duration?: number;
  readonly width: number;
  readonly height: number;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** `<script>` 안에 그대로 넣을 수 있는 JSON(`</script>` 조기 종료 방지). */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function compositionSkeleton(args: CompositionSkeletonArgs): string {
  const duration = args.duration !== undefined && Number.isFinite(args.duration) && args.duration > 0
    ? args.duration
    : COMPOSITION_DEFAULT_DURATION;
  const w = Math.max(16, Math.round(args.width));
  const h = Math.max(16, Math.round(args.height));
  const title = escapeHtml(args.title);
  // JSON 으로 넣는다 — 제목에 따옴표·역슬래시가 있어도 스크립트가 깨지지 않게.
  const titleJson = scriptJson(args.title);
  const props = scriptJson({
    title: { type: 'text', default: args.title, label: 'Title' },
    accent: { type: 'color', default: '#6366F1', label: 'Accent' },
    titleSize: { type: 'number', default: 11, min: 4, max: 24, step: 0.5, label: 'Title size (% of height)' },
  });
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="vibi:duration" content="${duration}">
<meta name="vibi:size" content="${w}x${h}">
<meta name="vibi:responsive" content="true">
<title>${title}</title>
<script type="application/json" id="vibi-props">${props}</script>
<style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
  canvas { position: absolute; left: 0; top: 0; }
  .stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    font-family: var(--vibi-font, system-ui, -apple-system, "Segoe UI", sans-serif); }
  .title { color: var(--vibi-fg, #fff); font-weight: 800; letter-spacing: -0.02em; text-align: center; max-width: 86%;
    animation: rise 1.1s cubic-bezier(.2, .8, .2, 1) 0.2s both; }
  @keyframes rise { from { opacity: 0; transform: translateY(4vh); } to { opacity: 1; transform: none; } }
</style>
</head>
<body>
<canvas id="bg"></canvas>
<div class="stage"><div class="title" id="title" data-vibi-prop="title"></div></div>
<script>
  // Vibistudio injects window.__vibi before this script. The fallback keeps the file viewable on its own.
  var vibi = window.__vibi || (window.__vibi = { props: {} });
  // Responsive: draw at the box size Vibistudio gives (vibi.width/height), not a fixed size.
  var W = vibi.width || ${w};
  var H = vibi.height || ${h};
  var canvas = document.getElementById('bg');
  canvas.width = W;
  canvas.height = H;
  var ctx = canvas.getContext('2d');
  var titleEl = document.getElementById('title');
  function prop(name, fallback) { var v = vibi.props && vibi.props[name]; return v === undefined || v === null || v === '' ? fallback : v; }
  function applyProps() {
    titleEl.textContent = prop('title', ${titleJson});
    titleEl.style.fontSize = Math.round(H * Number(prop('titleSize', 11)) / 100) + 'px';
  }
  applyProps();
  // Values changed in Vibistudio arrive here (no reload). Bound elements ([data-vibi-prop]) update by themselves.
  vibi.onProps = applyProps;
  function accent() {
    var styleAccent = getComputedStyle(document.documentElement).getPropertyValue('--vibi-accent').trim();
    return prop('accent', styleAccent || '#6366F1');
  }
  // Draw the frame for time t (seconds) — a pure function of t is deterministic and seeks instantly.
  vibi.seek = function (t) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = accent();
    for (var i = 0; i < 24; i++) {
      var a = t * 0.6 + i * 0.26;
      ctx.globalAlpha = 0.08 + 0.04 * Math.sin(a * 2);
      ctx.beginPath();
      ctx.arc(W / 2 + Math.cos(a) * (W * 0.12 + i * 18), H / 2 + Math.sin(a) * (H * 0.13 + i * 10), 40 + i * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };
</script>
</body>
</html>
`;
}
