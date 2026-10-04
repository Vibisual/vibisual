/** DOM Inspector utilities — element info extraction & AI-friendly clipboard format */

import { WORKSPACE_SITE_SOURCE_ATTR } from '@vibisual/shared';

import { siteRelPathFromUrl } from './inspectorSite.js';

export const INSPECTOR_OVERLAY_ID = 'vibisual-inspector-overlay';

/**
 * Normalize className across iframe boundaries.
 * `instanceof HTMLElement` fails for cross-window elements, so we use typeof check.
 */
export function getClassString(el: Element): string {
  if (typeof el.className === 'string') return el.className;
  return el.getAttribute('class') || '';
}

// ─────────────────────────────────────────────────────────────
// 보이는 사각형 — CSS `zoom` 아래에서도 상자가 그 요소 위에 앉는다 (§5.4 #15 (B))
// ─────────────────────────────────────────────────────────────

/** 엔진이 `zoom` 아래 요소의 사각형을 그 zoom 으로 **나눠** 주는가 — 엔진 동작이라 한 번 재서 기억한다. */
let zoomDividesRectsMemo: boolean | null = null;

/**
 * 10px 상자를 `zoom:2` 아래 두고 잰다 — 나눈 값(10)이 오면 옛 엔진, 보이는 값(20)이 오면 표준 엔진.
 * `zoom` 을 아예 모르는 엔진도 10 이 나오지만 그때는 곱할 zoom 도 늘 1 이라 결과가 같다.
 * 판본 문자열로 가르지 않는다 — Electron 을 올리는 날 이 자리를 다시 찾아와 고칠 일이 없게.
 */
export function probeZoomDividesRects(doc: Document): boolean {
  const root = doc.body ?? doc.documentElement;
  if (!root) return false;
  const host = doc.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;zoom:2;visibility:hidden;pointer-events:none';
  const box = doc.createElement('div');
  box.style.cssText = 'width:10px;height:10px';
  host.appendChild(box);
  root.appendChild(host);
  try {
    return box.getBoundingClientRect().width < 15;
  } finally {
    host.remove();
  }
}

/** 우리 문서에서 잰다 — 미리보기 페이지(남의 문서)에 잴 상자를 꽂지 않는다. */
function zoomDividesRects(): boolean {
  if (zoomDividesRectsMemo === null) zoomDividesRectsMemo = probeZoomDividesRects(document);
  return zoomDividesRectsMemo;
}

/** 테스트 전용 — 재 둔 엔진 동작을 잊는다. */
export function __resetZoomRectModeForTest(): void {
  zoomDividesRectsMemo = null;
}

function computedCssZoom(el: Element): number {
  const view = el.ownerDocument.defaultView;
  if (!view) return 1;
  const z = parseFloat(view.getComputedStyle(el).zoom);
  return Number.isFinite(z) && z > 0 ? z : 1;
}

/** 그려지는 트리의 부모 — 슬롯에 꽂힌 요소는 슬롯, 그림자 트리의 뿌리는 호스트(zoom 은 그 길로 곱해진다). */
function renderedParent(el: Element): Element | null {
  if (el.assignedSlot) return el.assignedSlot;
  if (el.parentElement) return el.parentElement;
  return (el.getRootNode() as Node & { host?: Element }).host ?? null;
}

/**
 * 요소와 그 조상들의 CSS `zoom` 을 곱한 값 — 그 요소가 화면에 몇 배로 그려지는가.
 * `getComputedStyle(el).zoom` 은 자기 칸의 값만 준다(물려받지 않고 곱해진다).
 */
export function cumulativeCssZoom(el: Element, zoomOf: (e: Element) => number = computedCssZoom): number {
  let z = 1;
  for (let cur: Element | null = el; cur; cur = renderedParent(cur)) z *= zoomOf(cur);
  return z;
}

/**
 * 요소가 **화면에 보이는** 사각형(자기 문서의 뷰포트 기준 CSS px).
 *
 * 통합 앱의 엔진(Electron 31 = Chromium 126)은 CSS `zoom` 아래 요소의 `getBoundingClientRect` 를
 * **위치·크기 모두 그 요소의 누적 zoom 으로 나눠** 준다 — 실측: `zoom:0.9` 아래 화면 `[145,100] 180×36`
 * 인 요소가 `[161,111] 200×40` 으로 왔다. IDE 본문은 글자 크기(`ideTextZoom`)를 항목마다 `zoom` 으로
 * 걸어서, 인스펙터 상자가 IDE 창 본문에서만 엉뚱한 자리·크기로 그려졌다(사용자 보고 — 배율 0.9 에서
 * 상자가 오른쪽 아래로 밀리고 커져 무엇을 집었는지 알 수 없었다). 집는 요소는 맞았다 — `elementFromPoint`
 * 는 화면 기준이다. 틀린 것은 상자와 그 옆 크기 글자뿐이었다.
 *
 * 표준 엔진(Chromium 130 실측)은 이미 보이는 값을 준다 — 거기서 또 곱하면 두 번 곱한 것이 된다.
 */
export function visualClientRect(el: Element): DOMRect {
  const r = el.getBoundingClientRect();
  if (!zoomDividesRects()) return r;
  const z = cumulativeCssZoom(el);
  if (z === 1) return r;
  return new DOMRect(r.left * z, r.top * z, r.width * z, r.height * z);
}

/**
 * `getBoundingClientRect` 값에 곱하면 **보이는 값**이 되는 배율(표준 엔진이면 늘 1).
 * 같은 zoom 아래 형제 여럿을 잴 때 한 번만 구해 두려고 꺼냈다 — `visualClientRect` 는 부를 때마다
 * 조상을 거슬러 오른다(IDE 항목 래퍼 이분 탐색이 스크롤 프레임마다 그 길을 수십 번 걸었다).
 */
export function visualRectScale(el: Element): number {
  return zoomDividesRects() ? cumulativeCssZoom(el) : 1;
}

/** Adjust an element's rect by adding the iframe's viewport offset */
export function getAdjustedRect(
  el: Element,
  iframeEl: HTMLIFrameElement | null,
): DOMRect {
  const r = visualClientRect(el);
  if (!iframeEl) return r;
  const ir = visualClientRect(iframeEl);
  return new DOMRect(r.left + ir.left, r.top + ir.top, r.width, r.height);
}

/**
 * Try to resolve the real element inside an iframe.
 * Returns { el, iframeEl } or null if the element is not an iframe / cross-origin.
 */
export function resolveIframeElement(
  el: Element,
  clientX: number,
  clientY: number,
): { el: Element; iframeEl: HTMLIFrameElement } | null {
  if (el.tagName !== 'IFRAME') return null;
  const iframe = el as HTMLIFrameElement;
  try {
    const doc = iframe.contentDocument;
    if (!doc) return null;
    const ir = iframe.getBoundingClientRect();
    const inner = doc.elementFromPoint(clientX - ir.left, clientY - ir.top);
    if (inner) return { el: inner, iframeEl: iframe };
  } catch {
    // cross-origin — cannot access contentDocument
  }
  return null;
}

function getElementPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  const root = el.ownerDocument.documentElement;
  while (current && current !== root) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      selector += `#${current.id}`;
    } else {
      const cls = getClassString(current).split(/\s+/).filter(Boolean).slice(0, 3);
      if (cls.length > 0) selector += '.' + cls.join('.');
    }
    parts.unshift(selector);
    current = current.parentElement;
  }
  return parts.join(' > ');
}


/**
 * 영역 선택 정보 (Shift+드래그). canvas/WebGL 앱 등 DOM 구조를 못 파낼 때도
 * 좌표만 있으면 AI에게 위치를 특정해줄 수 있다.
 */
export interface RegionInfo {
  /** viewport 기준 좌표 (px) */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 영역이 iframe 내부라면 그 iframe 참조 + iframe 내부 기준 좌표 */
  iframeEl: HTMLIFrameElement | null;
  iframeRect?: { x: number; y: number; width: number; height: number };
}

/** 영역 선택 → AI에게 넘기기 좋은 포맷으로 직렬화 */
export function buildRegionClipboardText(region: RegionInfo): string {
  const out: string[] = [];
  const w = Math.round(region.width);
  const h = Math.round(region.height);

  if (region.iframeEl) {
    out.push(`[IFrame] ${region.iframeEl.src}`);
    if (region.iframeRect) {
      const rx = Math.round(region.iframeRect.x);
      const ry = Math.round(region.iframeRect.y);
      out.push(`[Region (iframe-local)] x=${rx} y=${ry} ${w}\u00d7${h}px`);
    }
  }
  out.push(`[Region (viewport)] x=${Math.round(region.x)} y=${Math.round(region.y)} ${w}\u00d7${h}px`);

  // 영역 중심점 아래의 DOM 경로 (힌트용 — canvas 앱이면 <canvas>만 나옴)
  const cx = region.x + region.width / 2;
  const cy = region.y + region.height / 2;
  try {
    let elAtCenter: Element | null = null;
    if (region.iframeEl && region.iframeRect) {
      const doc = region.iframeEl.contentDocument;
      const rcx = region.iframeRect.x + region.iframeRect.width / 2;
      const rcy = region.iframeRect.y + region.iframeRect.height / 2;
      elAtCenter = doc?.elementFromPoint(rcx, rcy) ?? null;
    } else {
      elAtCenter = document.elementFromPoint(cx, cy);
    }
    if (elAtCenter) {
      out.push(`[CenterElement] ${getElementPath(elAtCenter)}`);
    }
  } catch { /* cross-origin etc. */ }

  return out.join('\n');
}

// ─────────────────────────────────────────────────────────────
// Tier-based clipboard payload — optimized for AI consumption
// ─────────────────────────────────────────────────────────────
//
//  Tier A  React fiber + _debugSource     → [Source][Component][Text][Hint]
//  Tier B  React fiber, no source         → [Component][Text][Attrs][Path]
//  Tier C  no framework                   → [Tag][Text][Attrs][Path]
//  Tier D  cross-origin iframe element    → [IFrame] only

interface ReactSource { fileName: string; lineNumber: number }
interface ReactInfo {
  name: string;
  source: ReactSource | null;
  props: Record<string, unknown> | null;
}

function getReactFiber(el: Element): unknown {
  for (const key in el) {
    if (key.startsWith('__reactFiber$')) return (el as unknown as Record<string, unknown>)[key];
  }
  return null;
}

function getReactInfo(el: Element): ReactInfo | null {
  try {
    const fiber = getReactFiber(el) as { _debugSource?: ReactSource; return?: unknown } | null;
    if (!fiber) return null;
    const source = fiber._debugSource
      ? { fileName: fiber._debugSource.fileName, lineNumber: fiber._debugSource.lineNumber }
      : null;

    let cur: { type?: unknown; memoizedProps?: unknown; return?: unknown } | null = fiber;
    while (cur) {
      const t = cur.type as unknown;
      let name: string | undefined;
      if (typeof t === 'function') {
        name = (t as { displayName?: string; name?: string }).displayName
            ?? (t as { name?: string }).name;
      } else if (t && typeof t === 'object') {
        const obj = t as { displayName?: string; name?: string; render?: { displayName?: string; name?: string } };
        name = obj.displayName ?? obj.name ?? obj.render?.displayName ?? obj.render?.name;
      }
      if (name && /^[A-Z]/.test(name)) {
        return { name, source, props: (cur.memoizedProps ?? null) as Record<string, unknown> | null };
      }
      cur = cur.return as typeof cur;
    }
  } catch { /* not React, mangled, or production build */ }
  return null;
}

function relativizePath(p: string): string {
  const norm = p.replace(/\\/g, '/');
  const pkgIdx = norm.indexOf('/packages/');
  if (pkgIdx >= 0) return norm.substring(pkgIdx + 1);
  const srcIdx = norm.lastIndexOf('/src/');
  if (srcIdx >= 0) return norm.substring(srcIdx + 1);
  return norm;
}

const PROP_BLACKLIST = new Set(['children', 'ref', 'key', 'className', 'style']);

function formatProps(props: Record<string, unknown> | null): string {
  if (!props) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(props)) {
    if (PROP_BLACKLIST.has(k)) continue;
    if (typeof v === 'function') continue;
    if (v === undefined) continue;
    let val: string;
    if (v === null) val = 'null';
    else if (typeof v === 'string') val = v.length > 40 ? `"${v.substring(0, 40)}…"` : `"${v}"`;
    else if (typeof v === 'number' || typeof v === 'boolean') val = String(v);
    else if (Array.isArray(v)) val = `Array(${v.length})`;
    else if (typeof v === 'object') {
      const keys = Object.keys(v as object);
      val = keys.length > 3 ? `{${keys.slice(0, 3).join(',')},…}` : `{${keys.join(',')}}`;
    } else val = typeof v;
    parts.push(`${k}=${val}`);
    if (parts.join(' ').length > 200) {
      parts.push('…');
      break;
    }
  }
  return parts.join(' ');
}

function getInnerText(el: Element): string {
  const raw = (el as HTMLElement).innerText ?? el.textContent ?? '';
  let text = raw.replace(/\r/g, '').replace(/\n+/g, ' / ').replace(/\s+/g, ' ').trim();
  if (text.length > 120) text = text.substring(0, 120) + '…';
  return text;
}

const ATTR_PRIORITY = ['type', 'name', 'href', 'src', 'alt', 'title', 'value', 'placeholder', 'for'];

function buildAttrs(el: Element, skipKeys: Set<string>): string {
  const items: { rank: number; out: string }[] = [];
  for (const attr of Array.from(el.attributes)) {
    const n = attr.name;
    if (n === 'class' || n === 'style') continue;
    if (skipKeys.has(n.toLowerCase())) continue;

    let rank = 99;
    if (n === 'id') rank = 0;
    else if (n === 'role') rank = 1;
    else if (n.startsWith('aria-')) rank = 2;
    else if (n.startsWith('data-')) rank = 3;
    else {
      const idx = ATTR_PRIORITY.indexOf(n);
      if (idx >= 0) rank = 10 + idx;
    }

    // 우리가 심어 둔 원본 위치는 `[Source]` 줄이 이미 말한다 — 속성 목록에 또 나오면 잡음이다.
    if (n === WORKSPACE_SITE_SOURCE_ATTR) continue;

    let v = attr.value;
    if (v.length > 60) v = v.substring(0, 60) + '…';
    items.push({ rank, out: v === '' ? n : `${n}="${v}"` });
  }
  items.sort((a, b) => a.rank - b.rank);
  return items.map((i) => i.out).join(' ');
}

function buildShortPath(el: Element): string {
  const segs: { tag: string; id: string; cls: string[] }[] = [];
  let cur: Element | null = el;
  const root = el.ownerDocument.documentElement;
  while (cur && cur !== root) {
    segs.unshift({
      tag: cur.tagName.toLowerCase(),
      id: cur.id,
      cls: getClassString(cur).split(/\s+/).filter(Boolean).slice(0, 2),
    });
    if (cur.id) break;
    cur = cur.parentElement;
  }

  const seen = new Set<string>();
  const segStrs = segs.map((s) => {
    let out = s.tag;
    if (s.id) out += `#${s.id}`;
    const filtered: string[] = [];
    for (const c of s.cls) {
      const m = c.match(/^([a-z][a-z0-9-]*?__)/);
      const prefix = m?.[1];
      if (prefix) {
        if (seen.has(prefix)) continue;
        seen.add(prefix);
      }
      filtered.push(c);
    }
    if (filtered.length > 0) out += '.' + filtered.join('.');
    return out;
  });

  if (segStrs.length > 6) {
    return [...segStrs.slice(0, 2), '…', ...segStrs.slice(-3)].join(' > ');
  }
  return segStrs.join(' > ');
}

/**
 * §5.5 #17-27 ⑮ (i) — 워크스페이스 페이지의 요소가 들고 있는 **원본 줄:칸**.
 *
 * 스크립트가 만든 요소에는 자기 자리가 없으므로 가장 가까운 조상까지 거슬러 올라가고, 몇 단계
 * 위였는지 함께 돌려준다 — "정확하지 않다"를 숨기는 것보다 그 편이 쓸모 있다.
 */
function siteSourceOf(el: Element): { at: string; hops: number } | null {
  let cur: Element | null = el;
  let hops = 0;
  while (cur) {
    const at = cur.getAttribute(WORKSPACE_SITE_SOURCE_ATTR);
    if (at) return { at, hops };
    cur = cur.parentElement;
    hops += 1;
  }
  return null;
}

/** Build a tier-aware, AI-friendly representation of a DOM element. */
export function buildClipboardText(el: Element, iframeSrc?: string): string {
  // Tier D: cross-origin iframe — only the src is accessible.
  if (el.tagName === 'IFRAME') {
    const ifr = el as HTMLIFrameElement;
    let crossOrigin = false;
    try { void ifr.contentDocument; } catch { crossOrigin = true; }
    if (crossOrigin || !ifr.contentDocument) {
      return `[IFrame] ${ifr.src} (cross-origin)`;
    }
  }

  const lines: string[] = [];

  /**
   * ⑮ (i) — 같은 오리진(개발 서버)에서 미리보기 페이지를 집었을 때. 패키지 앱에서는 오리진이
   * 달라 `inspectorSite` 의 왕복이 이 자리를 대신하는데, **두 갈래가 다른 글을 내면 안 된다** —
   * 개발에서 본 형식과 배포에서 본 형식이 다르면 받는 쪽이 두 가지를 배워야 한다.
   */
  const siteRel = iframeSrc ? siteRelPathFromUrl(iframeSrc) : null;
  if (siteRel !== null) {
    const src = siteSourceOf(el);
    if (src) {
      const suffix = src.hops > 0
        ? ` (ancestor +${src.hops} — this element was created at runtime)`
        : '';
      lines.push(`[Source] ${siteRel}:${src.at}${suffix}`);
    } else {
      lines.push(`[Page] ${siteRel}`);
    }
  } else if (iframeSrc) {
    lines.push(`[IFrame] ${iframeSrc}`);
  }

  const rx = getReactInfo(el);
  const text = getInnerText(el);

  // Tier A — React + dev source.
  if (rx && rx.source) {
    lines.push(`[Source] ${relativizePath(rx.source.fileName)}:${rx.source.lineNumber}`);
    const propsStr = formatProps(rx.props);
    lines.push(`[Component] <${rx.name}${propsStr ? ' ' + propsStr : ''}>`);
    if (text) lines.push(`[Text] "${text}"`);
    lines.push(`[Hint] Read source file for full context.`);
    return lines.join('\n');
  }

  // Tier B — React, no source.
  if (rx) {
    const propsStr = formatProps(rx.props);
    lines.push(`[Component] <${rx.name}${propsStr ? ' ' + propsStr : ''}>`);
    if (text) lines.push(`[Text] "${text}"`);

    const propKeys = new Set(Object.keys(rx.props ?? {}).map((k) => k.toLowerCase()));
    const skip = new Set<string>();
    for (const a of Array.from(el.attributes)) {
      if (!a.name.startsWith('data-')) continue;
      const camel = a.name.substring(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      if (propKeys.has(camel.toLowerCase())) skip.add(a.name);
    }
    const attrs = buildAttrs(el, skip);
    if (attrs) lines.push(`[Attrs] ${attrs}`);
    lines.push(`[Path] ${buildShortPath(el)}`);
    return lines.join('\n');
  }

  // Tier C — no framework.
  const tag = el.tagName.toLowerCase();
  let tagLine = `[Tag] <${tag}`;
  if (el.id) tagLine += `#${el.id}`;
  tagLine += '>';
  lines.push(tagLine);
  if (text) lines.push(`[Text] "${text}"`);
  const attrs = buildAttrs(el, new Set(['id']));
  if (attrs) lines.push(`[Attrs] ${attrs}`);
  lines.push(`[Path] ${buildShortPath(el)}`);
  if (siteRel !== null) lines.push('[Hint] Read source file for full context.');
  return lines.join('\n');
}

