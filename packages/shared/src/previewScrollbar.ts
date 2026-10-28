/**
 * 프리뷰 안쪽 문서의 스크롤바를 앱 톤(`index.css` `.scrollbar-thin`)으로 — 기본 숨김, 대거나 굴리면 등장. iframe 안 페이지의 것이라
 * 부모 CSS 가 못 닿아 프록시의 HTML 재작성 자리에서 싣는다. **트랙 색이 핵심(실측)** — 문서 트랙은 페이지 배경이 안 칠해 투명이면
 * iframe 의 `bg-white` 가 흰 띠로 남는다 → 문서 트랙만 페이지 배경색(`--vib-sb-track`), 안쪽 상자는 투명. 얇게 하는 건 모바일 폭 정확도이기도 하다.
 * 스크롤바만 건드린다(배경색은 읽기만) · 네이티브 스크롤바는 없애지 않는다(드래그 스크롤) · 선택자는 `*`·`html`·속성뿐(페이지가 꾸민 것이 이긴다)
 * · `transition` 을 `*` 에 넣지 마라(페이지 전이를 덮는다).
 */

/** 스크롤이 멎은 뒤 스크롤바를 더 두는 시간(ms). 클라 `useScrollReveal` 과 같은 값이라 안팎이 같게 느껴진다. */
export const PREVIEW_SCROLLBAR_HOLD_MS = 900;

/** 굴리는 중인 요소에 잠깐 붙는 표식. 페이지가 쓸 일이 없는 이름이어야 한다. */
export const PREVIEW_SCROLLBAR_ACTIVE_ATTR = 'data-vib-scrolling';

/** 문서 스크롤바의 **트랙 색**을 담는 변수. 스크립트가 페이지 배경을 읽어 채운다. */
export const PREVIEW_SCROLLBAR_TRACK_VAR = '--vib-sb-track';

/** 대기 상태의 썸 — 자리는 잡되(레이아웃이 흔들리지 않게) 보이지 않는다. */
const THUMB_IDLE = 'transparent';
/** hover·스크롤 중 — `index.css` `.scrollbar-thin:hover` 와 같은 값. */
const THUMB_ACTIVE = 'rgba(100, 116, 139, 0.35)';
/** webkit 계열의 썸(같은 톤, `.scrollbar-thin` 의 그 값). */
const THUMB_ACTIVE_WEBKIT = 'rgba(100, 116, 139, 0.3)';
const THUMB_HOVER_WEBKIT = 'rgba(148, 163, 184, 0.5)';

/**
 * 주입할 `<style>` + `<script>` 한 벌(문서당 한 번). 스크립트가 필요한 이유: CSS 에 "굴리는 중" 셀렉터가 없고(hover 로는 휠·터치·키보드에 안 뜬다),
 * 트랙에 칠할 페이지 배경색은 열어 봐야 안다.
 */
export function previewScrollbarInjection(): string {
  const TRACK = `var(${PREVIEW_SCROLLBAR_TRACK_VAR}, transparent)`;

  const css = [
    '/* Vibisual preview — 스크롤바는 앱 톤(기본 숨김 · hover/스크롤 때 등장) */',
    // ① 공통 — 얇게, 썸은 숨김. 안쪽 상자의 트랙은 그 상자 배경이 칠하므로 투명한 채로 둔다.
    `*{scrollbar-width:thin;scrollbar-color:${THUMB_IDLE} transparent}`,
    `*:hover{scrollbar-color:${THUMB_ACTIVE} transparent}`,
    `[${PREVIEW_SCROLLBAR_ACTIVE_ATTR}]{scrollbar-color:${THUMB_ACTIVE} transparent}`,
    // ② 문서 스크롤바만 트랙을 칠한다 — 투명하면 그 자리에서 iframe 요소의 흰 배경이 드러난다.
    `html{scrollbar-color:${THUMB_IDLE} ${TRACK}}`,
    `html:hover{scrollbar-color:${THUMB_ACTIVE} ${TRACK}}`,
    `html[${PREVIEW_SCROLLBAR_ACTIVE_ATTR}]{scrollbar-color:${THUMB_ACTIVE} ${TRACK}}`,
    // ③ `scrollbar-width`/`scrollbar-color` 를 모르는 엔진용 같은 그림.
    '*::-webkit-scrollbar{width:5px;height:5px}',
    '*::-webkit-scrollbar-track{background:transparent;margin:4px 0}',
    '*::-webkit-scrollbar-track:horizontal{margin:0 4px}',
    `html::-webkit-scrollbar-track{background:${TRACK}}`,
    '*::-webkit-scrollbar-thumb{background:transparent;border-radius:9999px;transition:background 0.3s}',
    `*:hover::-webkit-scrollbar-thumb{background:${THUMB_ACTIVE_WEBKIT}}`,
    `[${PREVIEW_SCROLLBAR_ACTIVE_ATTR}]::-webkit-scrollbar-thumb{background:${THUMB_ACTIVE_WEBKIT}}`,
    `*::-webkit-scrollbar-thumb:hover{background:${THUMB_HOVER_WEBKIT}}`,
    `*::-webkit-scrollbar-corner{background:${TRACK}}`,
  ].join('');

  const script = [
    '<script>',
    '(function(){',
    '  if (window.__vibisualScrollbar) return;',
    '  window.__vibisualScrollbar = true;',
    `  var ATTR = ${JSON.stringify(PREVIEW_SCROLLBAR_ACTIVE_ATTR)}, HOLD = ${PREVIEW_SCROLLBAR_HOLD_MS};`,
    `  var TRACK = ${JSON.stringify(PREVIEW_SCROLLBAR_TRACK_VAR)};`,
    '  var root = document.documentElement;',
    // ── 트랙 색 = 페이지 자기 배경. 없으면(아무것도 안 칠한 페이지) 손대지 않는다 —
    //    그 경우 브라우저에서도 흰 종이인 것이 맞다.
    '  var bgAt = 0;',
    '  function opaque(c){ return !!c && c !== "transparent" && c.indexOf("rgba(0, 0, 0, 0)") === -1; }',
    '  function syncTrack(){',
    '    var now = Date.now();',
    '    if (now - bgAt < 1000) return;',  // 스크롤마다 재계산하지 않는다(읽기도 공짜가 아니다).
    '    bgAt = now;',
    '    var body = document.body;',
    '    var c = body ? getComputedStyle(body).backgroundColor : "";',
    '    if (!opaque(c)) c = getComputedStyle(root).backgroundColor;',
    '    if (opaque(c)) root.style.setProperty(TRACK, c);',
    '  }',
    // ── "지금 굴리는 중" 표식. 표식은 **한 번에 하나**만 들고, 타이머는 이 클로저 안에만 둔다
    //    (페이지의 요소에 우리 속성을 심으면 그 페이지 코드가 그것을 보게 된다).
    '  var cur = null, timer = 0;',
    '  function clear(){ if (cur && cur.removeAttribute) cur.removeAttribute(ATTR); cur = null; }',
    '  function reveal(el){',
    '    syncTrack();',
    '    if (cur !== el) clear();',
    '    cur = el;',
    '    if (el && el.setAttribute) el.setAttribute(ATTR, "");',
    '    if (timer) clearTimeout(timer);',
    '    timer = setTimeout(function(){ timer = 0; clear(); }, HOLD);',
    '  }',
    // 캡처로 듣는다 — `scroll` 은 버블하지 않으므로, 안쪽 상자가 굴러도 여기까지 오려면 이 길뿐이다.
    '  document.addEventListener("scroll", function(e){',
    '    var t = e.target;',
    '    reveal(!t || t.nodeType !== 1 ? root : t);',
    '  }, true);',
    // 페이지가 테마를 바꾸거나 CSS 가 늦게 실려도 트랙이 따라온다.
    '  syncTrack();',
    '  window.addEventListener("load", function(){ bgAt = 0; syncTrack(); });',
    '  document.addEventListener("mouseover", function(){ syncTrack(); }, true);',
    '})();',
    '</script>',
  ].join('\n');

  return `<style>${css}</style>${script}`;
}
