import { useState, useEffect, useRef } from 'react';
import { PREVIEW_ALT_MESSAGE, PREVIEW_PICK_SOURCE } from '@vibisual/shared';
import {
  INSPECTOR_OVERLAY_ID,
  getClassString,
  getAdjustedRect,
  buildClipboardText,
  buildRegionClipboardText,
  type RegionInfo,
} from '../utils/inspector.js';
import {
  buildSiteClipboardText,
  probeWorkspaceSite,
  siteHitSummary,
  type SiteProbeResult,
} from '../utils/inspectorSite.js';
import { createInspectorHitTest, type InspectorHitTest } from '../utils/inspectorHitTest.js';
import {
  inspectorPickerAt,
  isPromiseLike,
  type InspectorPickLevel,
  type InspectorPickLevels,
  type InspectorPickPoint,
  type InspectorPicker,
} from '../utils/inspectorPick.js';

export interface InspectorInfo {
  rect: DOMRect;
  tag: string;
  id: string;
  classStr: string;
  size: string;
  text: string;
}

export interface RegionDragState {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Target {
  el: Element | null;
  iframeEl: HTMLIFrameElement | null;
  /** parent chain offset (wheel로 조절). 0 = 현재 hover 요소, +1 = 부모, +2 = 조부모 … */
  depthOffset: number;
  /** depthOffset 적용 전, hover로 결정된 가장 안쪽 요소 (offset 기준점) */
  innermost: Element | null;
  /**
   * §5.5 #17-27 ⑮ (i) — **다른 오리진** iframe(편집창의 페이지 미리보기)이 답해 준 요소.
   * 그 문서는 우리가 못 읽으므로 `el` 이 없다 — 대신 페이지에 물어 받은 이 값이 그 자리를 대신한다.
   */
  remote: SiteProbeResult | null;
  /**
   * §5.4 #15 (C) — 그린 화면의 공급자가 답한 칸들(가장 안쪽이 0). 칸이 다하면 `innermost`(= 공급자를 단 판)부터 DOM 으로
   * 이어 오른다 — `depthOffset` 은 칸과 DOM 을 한 줄로 센다.
   */
  levels: InspectorPickLevels | null;
  /** 보이는 칸들의 열쇠 — 같은 것을 다시 집으면 휠로 고른 깊이를 지킨다. */
  levelsKey: string;
  /** 지금 커서가 있는 공급자 판 — 늦게 온 답이 지금 판의 것인지 가린다. */
  pickerHost: Element | null;
}

/** 칸들의 열쇠 — 같은 글자·같은 아이템을 다시 집었는가(재생 중 상자가 움직여도 같은 것이다). */
function levelsKeyOf(levels: InspectorPickLevels): string {
  return levels.map((l) => `${l.label}\u0000${l.text}`).join('\u0001');
}

/** 공급자에게 묻는 자리 — 판 안의 보이는 픽셀(CSS `zoom` 은 코어가 한 번 푼다 — §5.4 #15 (B)). */
function pickPointIn(host: Element, cx: number, cy: number): InspectorPickPoint {
  const hr = getAdjustedRect(host, null);
  return { x: cx - hr.left, y: cy - hr.top, width: hr.width, height: hr.height };
}

/** 판 안의 보이는 픽셀 상자 → 뷰포트 상자(그 판이 지금 그려진 자리 기준). */
function levelRect(host: Element, rect: InspectorPickLevel['rect']): DOMRect {
  const hr = getAdjustedRect(host, null);
  return new DOMRect(hr.left + rect.x, hr.top + rect.y, rect.width, rect.height);
}

function levelInfo(host: Element, level: InspectorPickLevel): InspectorInfo {
  const rect = levelRect(host, level.rect);
  let text = level.text.trim();
  if (text.length > 30) text = text.substring(0, 30) + '…';
  return { rect, tag: level.label, id: '', classStr: '', size: `${Math.round(rect.width)}×${Math.round(rect.height)}`, text };
}

/** 복사 알림의 짧은 이름 — `<태그#id>` 또는 `<태그.클래스.클래스>`. */
function domSummary(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const elId = (el as HTMLElement).id;
  const cls = getClassString(el).split(/\s+/).filter(Boolean).slice(0, 2).join('.');
  let summary = `<${tag}`;
  if (elId) summary += `#${elId}`;
  else if (cls) summary += `.${cls}`;
  return `${summary}>`;
}

/**
 * 브라우저가 맨 앞에서 집은 iframe 안의 요소를 찾는다.
 * 뒤에 가려진 프레임이나 영상 렌더용 프레임은 일반 UI의 선택을 가로채지 않는다.
 *
 * §5.5 #17-27 ⑮ (i) — 문서를 못 읽는(다른 오리진) iframe 도 **건너뛰지 않고** `el: null` 로
 * 돌려준다. 종전에는 여기서 조용히 넘겨, 커서가 미리보기 페이지 위에 있어도 인스펙터는 그
 * 페이지를 못 본 척하고 뒤에 있는 우리 컴포넌트를 집었다(사용자 보고). 페이지에 직접 물어보는
 * 길은 부르는 쪽이 잇는다 — 여기서는 "그 iframe 위다"까지만 말한다.
 */
function probeIframe(
  el: Element | null,
  cx: number,
  cy: number,
): { el: Element | null; iframeEl: HTMLIFrameElement } | null {
  if (el?.tagName !== 'IFRAME') return null;
  const iframe = el as HTMLIFrameElement;
  const ir = iframe.getBoundingClientRect();
  try {
    const doc = iframe.contentDocument;
    if (!doc) return { el: null, iframeEl: iframe };
    const inner = doc.elementFromPoint(cx - ir.left, cy - ir.top);
    return { el: inner, iframeEl: iframe };
  } catch {
    // cross-origin — 문서는 못 읽지만 자리는 안다. 부르는 쪽이 페이지에 물어본다.
    return { el: null, iframeEl: iframe };
  }
}

/** 포커스를 우리 문서로 되가져올 때 쓰는 보이지 않는 자리. 한 창에 하나만 만든다. */
const FOCUS_SENTINEL_ID = 'vibisual-inspector-focus-sink';

/** `postMessage` 를 보내온 창이 어느 iframe 인가 — 포커스를 되돌려 줄 상대를 찾는다. */
function frameOfWindow(win: Window | null): HTMLIFrameElement | null {
  if (!win) return null;
  const frames = document.querySelectorAll('iframe');
  for (const frame of frames) {
    try {
      if (frame.contentWindow === win) return frame;
    } catch { /* 접근이 막힌 프레임은 우리 상대가 아니다 */ }
  }
  return null;
}

/**
 * §7.11 (G) — **포커스를 우리 창으로 되가져온다.**
 *
 * 프리뷰 안에 포커스가 있으면 Alt 뒤의 모든 것(뗌·휠·클릭)이 그 페이지로 가고 인스펙터는 절반만
 * 산다. 그래서 프리뷰가 "여기서 Alt 를 눌렀다"고 알려 오면 그 즉시 우리 문서의 보이지 않는 자리로
 * 포커스를 옮긴다 — cross-origin 이라 자식이 `parent.focus()` 를 부를 수는 없지만, **부모가 자기
 * 요소를 포커스하는 것**은 어느 오리진에서도 막히지 않는다.
 */
function takeFocusFromFrame(): void {
  let sink = document.getElementById(FOCUS_SENTINEL_ID);
  if (!sink) {
    sink = document.createElement('div');
    sink.id = FOCUS_SENTINEL_ID;
    sink.tabIndex = -1;
    // 눈에도 손에도 걸리지 않는 자리 — 포커스를 받는 것 말고는 아무 일도 하지 않는다.
    sink.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;opacity:0;pointer-events:none;outline:none';
    document.body.appendChild(sink);
  }
  try {
    window.focus();
    (sink as HTMLElement).focus({ preventScroll: true });
  } catch { /* 포커스를 못 옮겨도 아래 프리뷰의 keyup 신고가 남아 있다 */ }
}

/** innermost 요소에서 depthOffset 만큼 부모로 올라간 요소 반환 (root 넘지 않음) */
function applyDepthOffset(innermost: Element, offset: number): Element {
  if (offset <= 0) return innermost;
  let cur: Element = innermost;
  for (let i = 0; i < offset; i++) {
    const parent = cur.parentElement;
    if (!parent) break;
    cur = parent;
  }
  return cur;
}

function buildInfo(el: Element, iframeEl: HTMLIFrameElement | null): InspectorInfo {
  const rect = getAdjustedRect(el, iframeEl);
  const tag = el.tagName.toLowerCase();
  const id = el.id || '';
  const classStr = getClassString(el);
  let text = el.textContent?.trim() || '';
  if (text.length > 30) text = text.substring(0, 30) + '\u2026';
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  return { rect, tag, id, classStr, size: `${w}\u00d7${h}`, text };
}

export function useInspector(): {
  active: boolean;
  shiftHeld: boolean;
  info: InspectorInfo | null;
  region: RegionDragState | null;
  copied: boolean;
  copiedSummary: string;
} {
  const [active, setActive] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [info, setInfo] = useState<InspectorInfo | null>(null);
  const [region, setRegion] = useState<RegionDragState | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState('');
  const copiedTimer = useRef(0);
  const hitTest = useRef<InspectorHitTest | null>(null);
  /** 늦은 iframe 응답이 그 뒤에 누른 요소의 복사를 덮지 않게 한다(Alt 를 떼어도 누름은 유효). */
  const pickRequest = useRef(0);
  /**
   * §7.11 (G) — Alt 를 누르는 순간 포커스를 **뺏어 온** 프리뷰. Alt 를 떼면 그 자리로 돌려준다.
   *
   * 돌려주지 않으면 그 안에서 글을 쓰던 사람은 Alt 한 번에 키보드를 잃는다 — 우리가 가져가는 것은
   * "Alt 를 누르고 있는 동안"뿐이라는 뜻이다.
   */
  const focusStolenFrom = useRef<HTMLIFrameElement | null>(null);

  // ── Alt/Shift key tracking ──────────────────────────
  // iframe 내부 포커스에서도 keydown을 받으려면 각 iframe contentDocument에도 리스너를 건다.
  useEffect(() => {
    /** Alt 를 떼었다 — 프리뷰에서 가져왔던 포커스를 돌려준다(가져온 적 없으면 아무 일도 안 한다). */
    const giveFocusBack = (): void => {
      const frame = focusStolenFrom.current;
      focusStolenFrom.current = null;
      if (!frame || !frame.isConnected) return;
      try { frame.focus({ preventScroll: true }); } catch { /* 사라진 프레임 */ }
    };
    const down = (e: KeyboardEvent): void => {
      if (e.key === 'Alt' && !e.repeat) setActive(true);
      if (e.key === 'Shift' && !e.repeat) setShiftHeld(true);
      // Alt+다른키 조합(브라우저 단축키 등)은 인스펙터 비활성화
      if (e.altKey && e.key !== 'Alt' && e.key !== 'Shift') setActive(false);
    };
    const up = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') {
        setActive(false);
        setInfo(null);
        setCopied(false);
        setRegion(null);
        giveFocusBack();
      }
      if (e.key === 'Shift') setShiftHeld(false);
    };
    /**
     * §7.11 (G) — 프리뷰가 "여기서 Alt 를 눌렀다/뗐다"고 알려 온다.
     *
     * 프록시가 넣어 준 조각(`previewPicker.ts`)이 보내는 것이라 **오리진이 달라도** 온다 —
     * 종전에는 `contentDocument` 에 리스너를 걸 수 있는 같은 오리진 프리뷰에서만 Alt 가 살아 있었고,
     * 패키지 앱(`vibproxy://`)에서는 프리뷰 안을 한 번 클릭한 순간부터 인스펙터가 통째로 죽었다.
     */
    const onPreviewMessage = (e: MessageEvent): void => {
      const d = e.data as { source?: string; type?: string; down?: boolean; shift?: boolean } | null;
      if (!d || d.source !== PREVIEW_PICK_SOURCE || d.type !== PREVIEW_ALT_MESSAGE) return;
      if (d.down === true) {
        // 포커스를 가져온다 — 뗌·휠·클릭이 전부 우리에게 오도록. 어디서 가져왔는지 적어 둔다.
        const frame = frameOfWindow(e.source as Window | null);
        if (frame) focusStolenFrom.current = frame;
        takeFocusFromFrame();
        setActive(true);
        if (d.shift === true) setShiftHeld(true);
        return;
      }
      // 포커스를 못 가져갔을 때만 오는 뗌 신고(가져갔으면 위 `up` 이 받는다) — 같은 자리로 내린다.
      setActive(false);
      setInfo(null);
      setCopied(false);
      setRegion(null);
      focusStolenFrom.current = null;
    };
    const blur = (): void => {
      setActive(false);
      setShiftHeld(false);
      setInfo(null);
      setCopied(false);
      setRegion(null);
      // 창 자체가 포커스를 잃었다 — 지금 남의 창으로 포커스를 던지면 안 되므로 표식만 버린다.
      focusStolenFrom.current = null;
    };

    const attachedDocs = new Set<Document>();
    const attachToIframes = (): void => {
      document.querySelectorAll('iframe').forEach((iframe) => {
        try {
          const doc = iframe.contentDocument;
          if (!doc || attachedDocs.has(doc)) return;
          doc.addEventListener('keydown', down, true);
          doc.addEventListener('keyup', up, true);
          attachedDocs.add(doc);
        } catch { /* cross-origin — skip */ }
      });
    };
    attachToIframes();

    const onIframeLoad = (): void => {
      attachedDocs.clear();
      attachToIframes();
    };
    const trackedIframes = new Set<HTMLIFrameElement>();
    const trackIframe = (iframe: HTMLIFrameElement): void => {
      if (trackedIframes.has(iframe)) return;
      iframe.addEventListener('load', onIframeLoad);
      trackedIframes.add(iframe);
    };
    document.querySelectorAll('iframe').forEach(trackIframe);

    const observer = new MutationObserver(() => {
      document.querySelectorAll('iframe').forEach(trackIframe);
      attachToIframes();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // 입력칸·포털 내부가 키 전파를 막아도 Alt 의 시작과 끝은 먼저 받는다.
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', blur);
    window.addEventListener('message', onPreviewMessage);
    return () => {
      pickRequest.current += 1;
      window.clearTimeout(copiedTimer.current);
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('message', onPreviewMessage);
      observer.disconnect();
      trackedIframes.forEach((iframe) => iframe.removeEventListener('load', onIframeLoad));
      attachedDocs.forEach((doc) => {
        try {
          doc.removeEventListener('keydown', down, true);
          doc.removeEventListener('keyup', up, true);
        } catch { /* doc may be gone */ }
      });
    };
  }, []);

  // ── Inspector 활성 시 iframe pointer-events 차단 ──────
  useEffect(() => {
    if (!active) return;
    const inspectorHitTest = createInspectorHitTest(document);
    hitTest.current = inspectorHitTest;
    return () => {
      hitTest.current = null;
      inspectorHitTest.dispose();
    };
  }, [active]);

  // ── Mouse tracking + region drag + wheel parent traverse ──
  useEffect(() => {
    if (!active) return;

    const target: Target = { el: null, iframeEl: null, depthOffset: 0, innermost: null, remote: null, levels: null, levelsKey: '', pickerHost: null };
    const prevRect = { top: 0, left: 0, width: 0, height: 0 };
    /** §5.4 #15 (C) 공급자에게 묻는 중인가(한 번에 하나) · 그동안 커서가 간 마지막 자리. */
    let pickerBusy = false;
    let pickerPending: { host: Element; picker: InspectorPicker; x: number; y: number } | null = null;
    /** 지금 그린 칸(열쇠#깊이) — 같은 칸을 다시 그리지 않는다(마우스 이동마다 말풍선을 다시 그리지 않게). */
    let shownLevel = '';
    let rafId = 0;
    /** 마지막 커서 자리 — 휠로 부모를 올라갈 때 **같은 자리**를 다시 묻기 위해 들고 있는다. */
    let lastPoint = { x: 0, y: 0 };
    /** 페이지에 물어본 답을 기다리는 중인가(한 번에 하나만 묻는다). */
    let remoteBusy = false;
    /** 기다리는 동안 커서가 움직였다면 그 마지막 자리 — 답이 오면 곧바로 다시 묻는다. */
    let remotePending: { x: number; y: number } | null = null;
    let disposed = false;

    // 영역 드래그 상태
    let dragStart: { x: number; y: number; iframeEl: HTMLIFrameElement | null } | null = null;

    /** innermost + depthOffset → 현재 타겟 요소 재계산, info 갱신 */
    const refreshTargetFromInnermost = (): void => {
      if (!target.innermost) return;
      // §5.4 #15 (C) 공급자가 답한 칸 안이면 그 칸을 그린다(요소가 아니라 그림 안의 자리다).
      const levels = target.levels;
      const level = levels ? levels[target.depthOffset] : undefined;
      if (level) {
        target.el = null;
        const key = `${target.levelsKey}#${target.depthOffset}`;
        const newInfo = levelInfo(target.innermost, level);
        const same = key === shownLevel && newInfo.rect.top === prevRect.top && newInfo.rect.left === prevRect.left
          && newInfo.rect.width === prevRect.width && newInfo.rect.height === prevRect.height;
        shownLevel = key;
        prevRect.top = newInfo.rect.top;
        prevRect.left = newInfo.rect.left;
        prevRect.width = newInfo.rect.width;
        prevRect.height = newInfo.rect.height;
        if (!same) setInfo(newInfo);
        return;
      }
      shownLevel = '';
      const resolved = applyDepthOffset(target.innermost, target.depthOffset - (levels?.length ?? 0));
      target.el = resolved;
      const newInfo = buildInfo(resolved, target.iframeEl);
      prevRect.top = newInfo.rect.top;
      prevRect.left = newInfo.rect.left;
      prevRect.width = newInfo.rect.width;
      prevRect.height = newInfo.rect.height;
      setInfo(newInfo);
    };

    /**
     * ⑮ (i) — 다른 오리진 페이지에 좌표를 묻고, 온 답으로 강조 상자를 그린다.
     *
     * 한 번에 하나만 묻는다 — 마우스 이동은 초당 수백 번이라 그대로 흘려보내면 답이 순서를
     * 잃고 상자가 뒤로 튄다. 기다리는 동안 온 이동은 **마지막 자리 하나**로 접어 두었다가
     * 답이 오는 즉시 다시 묻는다(사람 눈에는 그대로 따라오는 것으로 보인다).
     */
    const askPage = (iframeEl: HTMLIFrameElement, cx: number, cy: number): void => {
      if (remoteBusy) { remotePending = { x: cx, y: cy }; return; }
      remoteBusy = true;
      const ir = iframeEl.getBoundingClientRect();
      void probeWorkspaceSite(iframeEl, cx - ir.left, cy - ir.top, target.depthOffset).then((res) => {
        if (disposed) return;
        remoteBusy = false;
        // 그 사이 Alt 를 떼었거나 다른 곳으로 갔으면 옛 답이다 — 버린다.
        if (target.iframeEl === iframeEl) {
          target.remote = res;
          if (!res) setInfo(null);
        }
        if (res && target.iframeEl === iframeEl) {
          const now = iframeEl.getBoundingClientRect();
          const rect = new DOMRect(
            now.left + res.hit.rect.x,
            now.top + res.hit.rect.y,
            res.hit.rect.width,
            res.hit.rect.height,
          );
          const w = Math.round(rect.width);
          const h = Math.round(rect.height);
          let text = res.hit.text;
          if (text.length > 30) text = text.substring(0, 30) + '\u2026';
          setInfo({ rect, tag: res.hit.tag, id: res.hit.id, classStr: res.hit.cls, size: `${w}\u00d7${h}`, text });
        }
        const next = remotePending;
        remotePending = null;
        if (next && target.iframeEl === iframeEl) askPage(iframeEl, next.x, next.y);
      });
    };

    /** 지금 그린 상자의 지금 자리 — 요소면 그 요소, 공급자 칸이면 판이 지금 그려진 자리 기준. */
    const shownRect = (): DOMRect | null => {
      if (target.el) return getAdjustedRect(target.el, target.iframeEl);
      const level = target.levels && target.innermost ? target.levels[target.depthOffset] : undefined;
      return level && target.innermost ? levelRect(target.innermost, level.rect) : null;
    };

    const syncRect = (): void => {
      const rect = shownRect();
      if (rect) {
        if (
          rect.top !== prevRect.top ||
          rect.left !== prevRect.left ||
          rect.width !== prevRect.width ||
          rect.height !== prevRect.height
        ) {
          prevRect.top = rect.top;
          prevRect.left = rect.left;
          prevRect.width = rect.width;
          prevRect.height = rect.height;
          const w = Math.round(rect.width);
          const h = Math.round(rect.height);
          setInfo((prev) => (prev ? { ...prev, rect, size: `${w}\u00d7${h}` } : null));
        }
      }
      rafId = requestAnimationFrame(syncRect);
    };
    rafId = requestAnimationFrame(syncRect);

    /** §5.4 #15 (C) 공급자 판에서 벗어났다 — 그 판의 칸들을 잊는다(다음 판정이 요소로 다시 세운다). */
    const leavePicker = (): void => {
      target.pickerHost = null;
      target.levels = null;
      target.levelsKey = '';
      pickerPending = null;
    };

    /** 공급자 판에 들어섰다 — 답이 오기 전까지 다른 곳의 옛 상자(대개 큰 상자)를 남기지 않는다. */
    const enterPicker = (host: Element): void => {
      if (target.pickerHost === host) return;
      target.pickerHost = host;
      target.iframeEl = null;
      target.remote = null;
      target.innermost = host;
      target.levels = null;
      target.levelsKey = '';
      target.depthOffset = 0;
      target.el = null;
      shownLevel = '';
      setInfo(null);
    };

    /** 공급자의 답을 세운다. 같은 칸들을 다시 집었으면 휠로 고른 깊이를 지키고, 빈 답이면 판 그대로(DOM). */
    const applyLevels = (host: Element, levels: InspectorPickLevels): void => {
      target.pickerHost = host;
      target.innermost = host;
      target.iframeEl = null;
      target.remote = null;
      if (levels.length === 0) {
        if (target.levels !== null) target.depthOffset = 0;
        target.levels = null;
        target.levelsKey = '';
        refreshTargetFromInnermost();
        return;
      }
      const key = levelsKeyOf(levels);
      if (key !== target.levelsKey) target.depthOffset = 0;
      target.levels = levels;
      target.levelsKey = key;
      refreshTargetFromInnermost();
    };

    /**
     * 공급자에게 묻는다 — 바로 답하면 바로 세우고, 약속으로 답하면 한 번에 하나만 묻는다(원격 페이지와 같은 규율). 기다리는
     * 동안 커서가 움직였으면 그 답은 옛 자리의 것이라 그리지 않고 마지막 자리를 다시 묻는다.
     */
    const askPicker = (host: Element, picker: InspectorPicker, cx: number, cy: number): void => {
      if (pickerBusy) { pickerPending = { host, picker, x: cx, y: cy }; return; }
      let answer: InspectorPickLevels | PromiseLike<InspectorPickLevels>;
      try { answer = picker(pickPointIn(host, cx, cy)); } catch { answer = []; }
      if (!isPromiseLike(answer)) { applyLevels(host, answer); return; }
      pickerBusy = true;
      void Promise.resolve(answer).then((levels) => levels, () => [] as InspectorPickLevels).then((levels) => {
        if (disposed) return;
        pickerBusy = false;
        const next = pickerPending;
        pickerPending = null;
        if (next) {
          if (target.pickerHost === next.host) askPicker(next.host, next.picker, next.x, next.y);
          return;
        }
        if (target.pickerHost === host) applyLevels(host, levels);
      });
    };

    /**
     * 호버와 클릭은 같은 좌표 판정을 쓴다. 이동 이벤트가 누락되거나 Alt 직후 바로 눌러도
     * 예전 헤더 전체를 복사하지 않는다. 같은 최하위 요소라면 휠로 고른 부모는 유지한다.
     */
    const updateTargetAtPoint = (cx: number, cy: number, probeRemote = true): void => {
      lastPoint = { x: cx, y: cy };

      const el = hitTest.current?.elementFromPoint(cx, cy) ?? null;
      // 1) 실제로 맨 앞에 보이는 iframe만 안쪽을 묻는다.
      const iframeHit = probeIframe(el, cx, cy);
      if (iframeHit) {
        leavePicker();
        // 1-a) 문서를 못 읽는 iframe(미리보기 페이지) — 페이지에 물어본다(⑮ (i)).
        if (iframeHit.el === null) {
          if (target.iframeEl !== iframeHit.iframeEl || target.innermost !== null) {
            target.iframeEl = iframeHit.iframeEl;
            target.depthOffset = 0;
            target.remote = null;
            target.el = null;
            target.innermost = null;
            setInfo(null);
          }
          if (probeRemote) askPage(iframeHit.iframeEl, cx, cy);
          return;
        }
        if (iframeHit.el === target.innermost && iframeHit.iframeEl === target.iframeEl) return;
        target.innermost = iframeHit.el;
        target.iframeEl = iframeHit.iframeEl;
        target.remote = null;
        target.depthOffset = 0;  // 새 요소로 이동 시 offset 리셋
        refreshTargetFromInnermost();
        return;
      }

      // 2) 일반 요소
      if (!el || (el as HTMLElement).closest?.(`#${INSPECTOR_OVERLAY_ID}`)) {
        leavePicker();
        setInfo(null);
        target.el = null;
        target.iframeEl = null;
        target.innermost = null;
        target.remote = null;
        target.depthOffset = 0;
        return;
      }

      // 3) 그린 화면의 판(§5.4 #15 (C)) — 판이 아니라 그 자리에 그려진 것을 그린 쪽에게 묻는다(SVG 판은 안쪽 도형이 집혀도).
      const drawn = inspectorPickerAt(el);
      if (drawn) {
        enterPicker(drawn.host);
        if (probeRemote) askPicker(drawn.host, drawn.picker, cx, cy);
        return;
      }
      leavePicker();

      if (el === target.innermost && target.iframeEl === null) return;
      target.innermost = el;
      target.iframeEl = null;
      target.remote = null;
      target.depthOffset = 0;
      refreshTargetFromInnermost();
    };

    const move = (e: MouseEvent): void => {
      // 드래그 중이면 region만 갱신
      if (dragStart) {
        const x = Math.min(dragStart.x, e.clientX);
        const y = Math.min(dragStart.y, e.clientY);
        const width = Math.abs(e.clientX - dragStart.x);
        const height = Math.abs(e.clientY - dragStart.y);
        setRegion({ x, y, width, height });
        return;
      }
      updateTargetAtPoint(e.clientX, e.clientY);
    };

    // 스크롤 휠 → 부모/자식 체인 이동 (A 기능)
    const handleWheel = (e: WheelEvent): void => {
      // 세로 굴림만 오르내린다 — 가로 굴림·기울임(터치패드)이 `deltaY === 0` 으로 와도 부모로 튀지 않게(종전에는 0 이 "위로"였다).
      if (e.deltaY === 0) return;
      const direction = e.deltaY > 0 ? -1 : 1;  // 휠 위로 = 부모로 (+1)

      // ⑮ (i) — 페이지 요소도 같은 손짓으로 부모를 거슬러 올라간다. 더 올라갈 조상이 없다고
      //   페이지가 말했으면 거기서 멈춘다(헛도는 휠 ❌).
      if (target.remote && target.iframeEl) {
        e.preventDefault();
        e.stopPropagation();
        if (direction > 0 && !target.remote.hit.hasParent) return;
        target.depthOffset = Math.max(0, target.depthOffset + direction);
        askPage(target.iframeEl, lastPoint.x, lastPoint.y);
        return;
      }

      if (!target.innermost) return;
      e.preventDefault();
      e.stopPropagation();
      target.depthOffset = Math.max(0, target.depthOffset + direction);
      refreshTargetFromInnermost();
    };

    const handlePointerDown = (e: PointerEvent): void => {
      const request = ++pickRequest.current;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      // Shift+Alt+드래그 → 영역 선택 모드 시작 (B 기능)
      if (e.shiftKey) {
        const el = hitTest.current?.elementFromPoint(e.clientX, e.clientY) ?? null;
        const iframeHit = probeIframe(el, e.clientX, e.clientY);
        dragStart = {
          x: e.clientX,
          y: e.clientY,
          iframeEl: iframeHit ? iframeHit.iframeEl : null,
        };
        setRegion({ x: e.clientX, y: e.clientY, width: 0, height: 0 });
        return;
      }

      // §5.4 #15 (C) 그린 화면의 판이면 누른 자리를 그린 쪽에게 새로 묻고 그 답을 복사한다(호버 답을 복사하지 않는다).
      const pressed = hitTest.current?.elementFromPoint(e.clientX, e.clientY) ?? null;
      const drawn = inspectorPickerAt(pressed);
      if (drawn) {
        lastPoint = { x: e.clientX, y: e.clientY };
        enterPicker(drawn.host);
        pickAndCopy(drawn.host, drawn.picker, e.clientX, e.clientY, request);
        return;
      }

      updateTargetAtPoint(e.clientX, e.clientY, false);

      // 다른 오리진 페이지도 클릭 좌표를 새로 묻는다 — 이전 호버 응답을 복사하지 않는다.
      if (!target.el && target.iframeEl) {
        const iframe = target.iframeEl;
        const ir = iframe.getBoundingClientRect();
        void probeWorkspaceSite(iframe, e.clientX - ir.left, e.clientY - ir.top, target.depthOffset)
          .then((res) => {
            if (!res || request !== pickRequest.current) return;
            void copyAndFlash(buildSiteClipboardText(res.hit, res.url), siteHitSummary(res.hit));
          });
        return;
      }
      if (!target.el) return;

      // 페이지가 링크를 타고 옮겨 갔으면 첫 `src` 는 옛 파일을 가리킨다 — 읽을 수 있으면
      //   **지금 보고 있는 주소**를 쓴다(⑮ (i) 의 원격 갈래도 답에 실려 온 주소를 쓴다).
      let iframeSrc = target.iframeEl?.src;
      try {
        const here = target.iframeEl?.contentWindow?.location.href;
        if (here) iframeSrc = here;
      } catch { /* cross-origin — 첫 src 로 둔다 */ }
      const clipText = buildClipboardText(target.el, iframeSrc);
      // Token-budget telemetry — Tier A should be ≤200 chars, Tier C ≤400.
      // Anything over ~800 means a list is exploding somewhere.
      if (import.meta.env.DEV) {
        console.debug(
          `[Inspector] payload: ${clipText.length} chars, ~${Math.ceil(clipText.length / 4)} tokens`,
        );
      }

      void copyAndFlash(clipText, domSummary(target.el));
    };

    /**
     * §5.4 #15 (C) — 누른 자리를 공급자에게 묻고 복사한다. 같은 칸들을 다시 집었으면 휠로 고른 깊이를 지키고, 칸이 다한 깊이면
     * 판부터의 DOM 요소를 복사한다. 늦게 온 답은 그 뒤에 누른 것을 덮지 않고(`pickRequest`), Alt 를 뗀 뒤에 와도 누름은 유효하다.
     */
    const pickAndCopy = (host: Element, picker: InspectorPicker, cx: number, cy: number, request: number): void => {
      let answer: InspectorPickLevels | PromiseLike<InspectorPickLevels>;
      try { answer = picker(pickPointIn(host, cx, cy)); } catch { answer = []; }
      const finish = (levels: InspectorPickLevels): void => {
        const sameLevels = levels.length > 0 ? levelsKeyOf(levels) === target.levelsKey : target.levels === null;
        const depth = sameLevels && target.innermost === host ? target.depthOffset : 0;
        if (!disposed && target.pickerHost === host) {
          applyLevels(host, levels);
          if (target.depthOffset !== depth) { target.depthOffset = depth; refreshTargetFromInnermost(); }
        }
        if (request !== pickRequest.current) return;
        const level = levels[depth];
        if (level) {
          void copyAndFlash(level.clipboard, level.label);
          return;
        }
        const el = applyDepthOffset(host, depth - levels.length);
        void copyAndFlash(buildClipboardText(el), domSummary(el));
      };
      if (isPromiseLike(answer)) void Promise.resolve(answer).then((levels) => levels, () => [] as InspectorPickLevels).then(finish);
      else finish(answer);
    };

    const handlePointerUp = (e: PointerEvent): void => {
      if (!dragStart) return;
      e.preventDefault();
      e.stopPropagation();

      const x = Math.min(dragStart.x, e.clientX);
      const y = Math.min(dragStart.y, e.clientY);
      const width = Math.abs(e.clientX - dragStart.x);
      const height = Math.abs(e.clientY - dragStart.y);
      const iframeEl = dragStart.iframeEl;
      dragStart = null;

      // 드래그 거리가 4px 미만이면 무시 (오클릭 방지)
      if (width < 4 || height < 4) {
        setRegion(null);
        return;
      }

      // iframe 로컬 좌표 계산
      let iframeRect: RegionInfo['iframeRect'];
      if (iframeEl) {
        const ir = iframeEl.getBoundingClientRect();
        iframeRect = {
          x: x - ir.left,
          y: y - ir.top,
          width,
          height,
        };
      }

      const info: RegionInfo = { x, y, width, height, iframeEl, iframeRect };
      const clipText = buildRegionClipboardText(info);
      const summary = `region ${Math.round(width)}×${Math.round(height)}`;

      void copyAndFlash(clipText, summary);
      setRegion(null);
    };

    const copyAndFlash = (text: string, summary: string): Promise<void> => {
      return navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setCopiedSummary(summary);
        window.clearTimeout(copiedTimer.current);
        copiedTimer.current = window.setTimeout(() => {
          setCopied(false);
          setCopiedSummary('');
        }, 400);
      });
    };

    const blockClick = (e: MouseEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };

    document.addEventListener('mousemove', move, true);
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('pointerup', handlePointerUp, true);
    document.addEventListener('click', blockClick, true);
    document.addEventListener('wheel', handleWheel, { capture: true, passive: false });
    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('pointerup', handlePointerUp, true);
      document.removeEventListener('click', blockClick, true);
      document.removeEventListener('wheel', handleWheel, { capture: true } as EventListenerOptions);
    };
  }, [active]);

  return { active, shiftHeld, info, region, copied, copiedSummary };
}
