/** DOM Inspector utilities — element info extraction & AI-friendly clipboard format */

export const INSPECTOR_OVERLAY_ID = 'vibisual-inspector-overlay';

/**
 * Normalize className across iframe boundaries.
 * `instanceof HTMLElement` fails for cross-window elements, so we use typeof check.
 */
export function getClassString(el: Element): string {
  if (typeof el.className === 'string') return el.className;
  return el.getAttribute('class') || '';
}

/** Adjust an element's rect by adding the iframe's viewport offset */
export function getAdjustedRect(
  el: Element,
  iframeEl: HTMLIFrameElement | null,
): DOMRect {
  const r = el.getBoundingClientRect();
  if (!iframeEl) return r;
  const ir = iframeEl.getBoundingClientRect();
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
  if (iframeSrc) lines.push(`[IFrame] ${iframeSrc}`);

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
  return lines.join('\n');
}

