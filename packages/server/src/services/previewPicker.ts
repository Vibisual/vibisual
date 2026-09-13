import {
  PREVIEW_ALT_CAPTURE_DEFAULT,
  PREVIEW_ALT_CAPTURE_MESSAGE,
  PREVIEW_ALT_MESSAGE,
  PREVIEW_HOVER_MESSAGE,
  PREVIEW_PICK_SOURCE,
  PREVIEW_PICK_TEXT_MAX,
  previewScrollbarInjection,
  workspaceSiteInspectorScript,
} from '@vibisual/shared';

/**
 * §7.11 (판올림 번호 발급 대기) — 프리뷰 **요소 집기** 주입 스크립트.
 *
 * 프리뷰는 이미 우리 `iframe-proxy` 를 거쳐 같은 오리진으로 뜨므로, Electron `webview` 로
 * 격상하지 않고도 프록시가 HTML 을 재작성하는 그 자리에서 스크립트 한 개를 넣어 요소를 집을 수 있다.
 *
 * 규약(양방향 모두 `source` 표식이 있는 메시지만 취급 — 프리뷰 안 페이지가 자기 목적으로 쓰는
 * postMessage 를 우리 것으로 오인하지 않는다):
 *
 * - 부모 → 프리뷰: `{ source, type: 'pick-mode', on: boolean }`
 * - 프리뷰 → 부모: `{ source, type: 'pick', payload: PreviewPickPayload }` / `{ source, type: 'pick-cancel' }`
 * - 부모 → 프리뷰: `{ source, type: 'alt-capture', on: boolean }` — Alt 를 우리가 가져갈지(§7.11 (G))
 * - 프리뷰 → 부모: `{ source, type: 'alt', down: boolean, shift: boolean }` — 여기서 Alt 를 눌렀다/뗐다
 * - 프리뷰 → 부모: `{ source, type: 'hover', on: boolean }` — 마우스가 이 프레임 안에 들어왔다/나갔다
 *
 * 경계: DOM 을 **읽기만** 한다. 네트워크·저장소·쿠키에 손대지 않고, 켜져 있지 않으면 아무 것도 하지
 * 않는다(평소 프리뷰 조작은 종전 그대로). 켜져 있는 동안의 클릭은 여기서 소비해 대상 앱이 조작되지 않는다.
 * **Alt 다리만 예외로 처음부터 켜져 있다** — 인스펙터는 앱 전체에서 같은 손짓이어야 하고, 이 자리만
 * 죽어 있으면 사용자는 프리뷰에 들어갈 때마다 "여기선 왜 안 되냐"를 다시 겪는다(기본값의 근거는
 * `PREVIEW_ALT_CAPTURE_DEFAULT`). 안에서 도는 앱이 Alt 를 쓰면 헤더 토글로 양보한다.
 *
 * 문자열로 사는 코드라 **ES5 범위**로 쓰고, CSS 선택자에 역슬래시 이스케이프가 필요한 이름은
 * 아예 쓰지 않는다(단순한 이름만 선택자에 넣고, 나머지는 `nth-of-type` 경로로 간다).
 */
export function buildPreviewPickerScript(proxyBase: string, target: string): string {
  const lines = [
    '<script>',
    '(function(){',
    '  if (window.__vibisualPicker) return;',
    '  window.__vibisualPicker = true;',
    `  var SRC = ${JSON.stringify(PREVIEW_PICK_SOURCE)};`,
    `  var BASE = ${JSON.stringify(proxyBase)};`,
    `  var TARGET = ${JSON.stringify(target)};`,
    `  var TEXT_MAX = ${PREVIEW_PICK_TEXT_MAX};`,
    `  var ALT = ${JSON.stringify(PREVIEW_ALT_MESSAGE)}, ALT_CAP = ${JSON.stringify(PREVIEW_ALT_CAPTURE_MESSAGE)};`,
    `  var altOn = ${PREVIEW_ALT_CAPTURE_DEFAULT ? 'true' : 'false'}, altDown = false;`,
    `  var HOVER = ${JSON.stringify(PREVIEW_HOVER_MESSAGE)};`,
    '  var hoverIn = false;',
    '  var on = false, box = null;',
    '  function simpleName(s){ return /^[A-Za-z][A-Za-z0-9_-]*$/.test(s); }',
    '  function pageUrl(){',
    '    var p = location.pathname || "/";',
    '    if (p.indexOf(BASE) === 0) p = p.slice(BASE.length) || "/";',
    '    return (location.protocol === "https:" ? "https://" : "http://") + TARGET + p + (location.search || "");',
    '  }',
    '  function ensureBox(){',
    '    if (box && box.parentNode) return box;',
    '    box = document.createElement("div");',
    '    box.setAttribute("data-vibisual-pick", "1");',
    '    box.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #3B82F6;background:rgba(59,130,246,0.16);border-radius:2px;display:none";',
    '    (document.body || document.documentElement).appendChild(box);',
    '    return box;',
    '  }',
    '  function place(el){',
    '    var r = el.getBoundingClientRect(); var b = ensureBox();',
    '    b.style.left = r.left + "px"; b.style.top = r.top + "px";',
    '    b.style.width = r.width + "px"; b.style.height = r.height + "px"; b.style.display = "block";',
    '  }',
    '  function hide(){ if (box) box.style.display = "none"; }',
    '  function classesOf(el){',
    '    var raw = (el.getAttribute && el.getAttribute("class")) || "";',
    '    return raw.split(/\\s+/).filter(function(c){ return c !== ""; });',
    '  }',
    '  function typeIndex(el){',
    '    var p = el.parentElement; if (!p) return 0;',
    '    var same = 0, i;',
    '    for (i = 0; i < p.children.length; i++) {',
    '      var c = p.children[i];',
    '      if (c === el) return same;',
    '      if (c.tagName === el.tagName) same++;',
    '    }',
    '    return same;',
    '  }',
    '  function selectorFor(el){',
    '    var parts = [], node = el, depth = 0;',
    '    while (node && node.nodeType === 1 && depth < 6) {',
    '      var tag = String(node.tagName).toLowerCase();',
    '      if (tag === "html" || tag === "body") break;',
    '      var testId = node.getAttribute ? node.getAttribute("data-testid") : null;',
    '      if (testId) { parts.unshift(tag + "[data-testid=" + JSON.stringify(testId) + "]"); break; }',
    '      if (node.id && simpleName(node.id)) { parts.unshift("#" + node.id); break; }',
    '      var part = tag;',
    '      var cls = classesOf(node).filter(simpleName).slice(0, 2);',
    '      if (cls.length) part += "." + cls.join(".");',
    '      var idx = typeIndex(node);',
    '      if (idx > 0) part += ":nth-of-type(" + (idx + 1) + ")";',
    '      parts.unshift(part);',
    '      node = node.parentElement; depth++;',
    '    }',
    '    return parts.join(" > ");',
    '  }',
    '  function payloadFor(el){',
    '    var r = el.getBoundingClientRect();',
    '    var text = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();',
    '    var testId = el.getAttribute ? el.getAttribute("data-testid") : null;',
    '    var out = {',
    '      selector: selectorFor(el),',
    '      tagName: String(el.tagName).toLowerCase(),',
    '      classes: classesOf(el),',
    '      textSnippet: text.length > TEXT_MAX ? text.slice(0, TEXT_MAX) : text,',
    '      rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },',
    '      pageUrl: pageUrl()',
    '    };',
    '    if (el.id) out.id = el.id;',
    '    if (testId) out.testId = testId;',
    '    return out;',
    '  }',
    '  function post(msg){ try { parent.postMessage(msg, "*"); } catch (e) {} }',
    '  function setMode(v){',
    '    on = !!v;',
    '    if (!on) hide();',
    '    try { document.documentElement.style.cursor = on ? "crosshair" : ""; } catch (e) {}',
    '  }',
    '  function onMove(e){ if (!on) return; var el = e.target; if (!el || el.nodeType !== 1 || el === box) return; place(el); }',
    '  function onClick(e){',
    '    if (!on) return;',
    '    var el = e.target; if (!el || el.nodeType !== 1) return;',
    '    e.preventDefault(); e.stopPropagation();',
    '    post({ source: SRC, type: "pick", payload: payloadFor(el) });',
    '    setMode(false);',
    '  }',
    '  function onKey(e){',
    '    if (!on) return;',
    '    if (e.key === "Escape" || e.keyCode === 27) { setMode(false); post({ source: SRC, type: "pick-cancel" }); }',
    '  }',
    // ── §7.11 (G) Alt 다리 ───────────────────────────────────────────
    // 이 페이지에 포커스가 있으면 Alt 는 여기까지만 오고 부모(우리 창)는 아무 것도 모른다.
    // 그래서 **여기서 잡아 부모에게 넘긴다** — 부모는 그 신고를 받고 포커스를 되가져가므로,
    // 이어지는 Alt 뗌·휠·클릭은 전부 부모가 받는다(우리가 두 번 보낼 일이 없다).
    '  function isAlt(e){ return e.key === "Alt" || e.keyCode === 18; }',
    '  function onAltDown(e){',
    '    if (!altOn || !isAlt(e)) return;',
    // 우리 것이 강제 — 페이지가 자기 Alt 단축키로 쓰지 못하게 여기서 끊는다(토글을 끄면 안 온다).
    '    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();',
    '    if (altDown) return;',
    '    altDown = true;',
    '    post({ source: SRC, type: ALT, down: true, shift: !!e.shiftKey });',
    '  }',
    '  function onAltUp(e){',
    '    if (!isAlt(e) || !altDown) return;',
    '    altDown = false;',
    '    if (!altOn) return;',
    // 부모가 포커스를 가져갔으면 이 뗌은 오지 않는다 — 안 왔을 때를 위한 길이라 부모도 자기 keyup 을 본다.
    '    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();',
    '    post({ source: SRC, type: ALT, down: false, shift: false });',
    '  }',
    // 포커스를 부모에게 뺏긴 순간이 곧 이 상태다 — 여기서 뗌을 보내면 방금 켠 인스펙터가 즉시 꺼진다.
    // 그러니 **보내지 않고 눌림만 푼다**(다음 Alt 가 다시 신고될 수 있게).
    '  function onBlur(){ altDown = false; }',
    // ── §7.16 마우스 다리 ────────────────────────────────────────────
    // 마우스가 이 프레임 위로 들어가면 **부모 문서는 아무 것도 받지 못한다** — 그래서 프리뷰를 담은
    // 우리 스크롤 상자의 `:hover` 가 서지 않고, 기본 숨김인 스크롤바가 굴릴 때만 떴다. Alt 와 같은
    // 까닭이라 같은 다리로 알린다(들고 남이 바뀔 때 한 번씩 — `mouseover` 는 수없이 오므로).
    '  function setHover(v){ if (hoverIn === v) return; hoverIn = v; post({ source: SRC, type: HOVER, on: v }); }',
    '  function onOver(){ setHover(true); }',
    // `relatedTarget` 이 남아 있으면 아직 이 문서 안에서 옮겨 다니는 중이다 — 나간 것은 비었을 때뿐.
    '  function onOut(e){ if (!e || !e.relatedTarget) setHover(false); }',
    '  window.addEventListener("message", function(e){',
    '    var d = e.data;',
    '    if (!d || d.source !== SRC) return;',
    '    if (d.type === "pick-mode") setMode(!!d.on);',
    '    else if (d.type === ALT_CAP) altOn = !!d.on;',
    '  });',
    '  document.addEventListener("mousemove", onMove, true);',
    '  document.addEventListener("mouseover", onOver, true);',
    '  document.addEventListener("mouseout", onOut, true);',
    '  document.addEventListener("click", onClick, true);',
    '  document.addEventListener("keydown", onAltDown, true);',
    '  document.addEventListener("keyup", onAltUp, true);',
    '  document.addEventListener("keydown", onKey, true);',
    '  window.addEventListener("blur", onBlur);',
    '  window.addEventListener("scroll", hide, true);',
    '})();',
    '</script>',
  ];
  return lines.join('\n');
}

/**
 * §7.11 (G) — 프록시가 `</body>` 앞에 넣는 조각 **한 벌**.
 *
 * 둘이 함께 가야 프리뷰에서 Alt 가 온전히 산다 — ① 위 picker 가 Alt 를 잡아 부모에게 넘기고,
 * ② `workspaceSiteInspectorScript()` 가 부모의 좌표 질문에 요소를 답한다(§5.5 #17-27 ⑮ (i)).
 * ② 가 없으면 Alt 는 켜지는데 강조할 상자가 없어 "여전히 안 되는" 화면이 된다 — 패키지 앱에서
 * 이 프리뷰는 `vibproxy://` 라 인스펙터가 `contentDocument` 를 못 읽기 때문이다. 부르는 자리가
 * 하나뿐이라 여기 한 함수로 묶어 둔다(한쪽만 빠뜨릴 자리를 없앤다).
 *
 * ③ `previewScrollbarInjection()` — 프리뷰 안쪽 문서의 **스크롤바 톤**(사용자 지시). 부모 문서의
 * CSS 는 iframe 경계를 못 넘으므로, 폭 프리셋을 무엇으로 고르든 안쪽에는 브라우저 기본 스크롤바가
 * 그대로 그어져 있었다. **문서의 맨 뒤**라 페이지의 스타일시트보다 늦게 서고, 그래서 기본값을
 * 확실히 덮는다(자기 스크롤바를 직접 꾸민 페이지는 특정도로 여전히 이긴다).
 */
export function buildPreviewInjectionTail(proxyBase: string, target: string): string {
  return buildPreviewPickerScript(proxyBase, target)
    + workspaceSiteInspectorScript()
    + previewScrollbarInjection();
}
