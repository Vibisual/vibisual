/**
 * 프리뷰 **안쪽 문서**의 스크롤바를 앱 톤으로 — 기본 숨김, 마우스를 대거나 굴리면 등장.
 *
 * 왜 여기(주입)여야 하는가: 프리뷰는 iframe 이고, 사용자가 보는 그 스크롤바는 iframe 을 **담는**
 * 우리 컨테이너의 것이 아니라 **안에서 도는 페이지 자신의 것**이다. 부모 문서의 CSS 는 iframe 경계를
 * 넘지 못하므로, 우리 톤을 그 안에 적용하려면 프록시가 HTML 을 재작성하는 그 자리에서 스타일 한 벌을
 * 함께 실어 보내는 길밖에 없다.
 *
 * 값은 클라이언트 `index.css` 의 `.scrollbar-thin` 을 그대로 옮긴 것이다 — 앱 안팎에서 스크롤바가
 * 다르게 생기면 그게 곧 "우리 디자인이 아니다"가 된다.
 *
 * **트랙 색이 이 파일의 핵심이다(실측으로 밝혀진 함정).** 썸만 투명하게 해서는 화면이 달라지지
 * 않는다 — 문서 스크롤바의 **트랙은 페이지 배경이 칠해 주지 않기 때문에**, 투명하게 두면 그 자리에서
 * **iframe 요소의 배경(`bg-white`)** 이 그대로 드러난다. 썸이 사라져도 오른쪽에 흰 띠가 그대로 남아,
 * 고치기 전과 눈으로 구별되지 않는다(headless Chrome 으로 나란히 그려 확인). 그래서 **문서 스크롤바의
 * 트랙만** 페이지 자기 배경색으로 칠한다(`--vib-sb-track`). 안쪽 상자의 스크롤바는 그 상자의 배경이
 * 이미 트랙까지 칠하므로 투명한 채로 둔다.
 *
 * 굵은 기본 스크롤바를 얇게 만드는 것은 **모바일 폭 확인의 정확도** 문제이기도 하다 — 실제 휴대폰
 * 브라우저는 15px 짜리 고전 스크롤바로 본문 폭을 깎지 않는다.
 *
 * 경계:
 * - 스크롤바 **외의** 것은 건드리지 않는다. 페이지의 색·폰트·레이아웃·전역·네트워크는 그대로다.
 *   (읽기만 한다 — 페이지 배경색을 `getComputedStyle` 로 **읽어** 우리 변수에 적을 뿐이다.)
 * - 네이티브 스크롤바를 없애지 않는다. 없애면 그 자리를 드래그해 스크롤하던 손이 함께 사라진다.
 * - 선택자는 `*` / `html` / 속성 선택자뿐이라, 페이지가 자기 스크롤바를 직접 꾸며 뒀다면 그쪽이
 *   이긴다(더 높은 특정도). 우리가 대체하는 것은 브라우저 **기본값**이지 개발자의 선택이 아니다.
 * - `transition` 은 `*` 에 넣지 않는다. 페이지가 자기 요소에 걸어 둔 전이를 덮어써 애먼 곳의
 *   애니메이션이 죽는다(그리고 `scrollbar-color` 는 어차피 보간되지 않는다).
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
 * 주입할 `<style>` + 스크롤 감지·트랙색 `<script>` 한 벌.
 *
 * 스크립트가 필요한 까닭은 둘이다 — ① CSS 에 "지금 굴리는 중"을 나타내는 셀렉터가 없다(hover 만으로는
 * 휠·터치·키보드로 굴리기만 한 손에 스크롤바가 오지 않는다). ② 트랙에 칠할 **페이지 배경색**은 그
 * 페이지를 열어 봐야 안다. 문서 하나에 한 번만 선다.
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
