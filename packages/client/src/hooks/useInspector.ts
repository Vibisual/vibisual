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
}

/**
 * 마우스 좌표가 iframe 영역 안에 있으면 contentDocument에서 요소를 찾는다.
 * pointer-events: none 상태이므로 elementFromPoint가 iframe을 반환하지 않아
 * bounding rect로 수동 판별한다.
 *
 * §5.5 #17-27 ⑮ (i) — 문서를 못 읽는(다른 오리진) iframe 도 **건너뛰지 않고** `el: null` 로
 * 돌려준다. 종전에는 여기서 조용히 넘겨, 커서가 미리보기 페이지 위에 있어도 인스펙터는 그
 * 페이지를 못 본 척하고 뒤에 있는 우리 컴포넌트를 집었다(사용자 보고). 페이지에 직접 물어보는
 * 길은 부르는 쪽이 잇는다 — 여기서는 "그 iframe 위다"까지만 말한다.
 */
function probeIframes(
  cx: number,
  cy: number,
): { el: Element | null; iframeEl: HTMLIFrameElement } | null {
  const iframes = document.querySelectorAll('iframe');
  for (const iframe of iframes) {
    const ir = iframe.getBoundingClientRect();
    if (cx < ir.left || cx > ir.right || cy < ir.top || cy > ir.bottom) continue;
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
  return null;
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
  const lastElRef = useRef<Element | null>(null);
  const copiedTimer = useRef(0);
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
        lastElRef.current = null;
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
      lastElRef.current = null;
      focusStolenFrom.current = null;
    };
    const blur = (): void => {
      setActive(false);
      setShiftHeld(false);
      setInfo(null);
      setCopied(false);
      setRegion(null);
      lastElRef.current = null;
      // 창 자체가 포커스를 잃었다 — 지금 남의 창으로 포커스를 던지면 안 되므로 표식만 버린다.
      focusStolenFrom.current = null;
    };

    const attachedDocs = new Set<Document>();
    const attachToIframes = (): void => {
      document.querySelectorAll('iframe').forEach((iframe) => {
        try {
          const doc = iframe.contentDocument;
          if (!doc || attachedDocs.has(doc)) return;
          doc.addEventListener('keydown', down);
          doc.addEventListener('keyup', up);
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

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    window.addEventListener('message', onPreviewMessage);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      window.removeEventListener('message', onPreviewMessage);
      observer.disconnect();
      trackedIframes.forEach((iframe) => iframe.removeEventListener('load', onIframeLoad));
      attachedDocs.forEach((doc) => {
        try {
          doc.removeEventListener('keydown', down);
          doc.removeEventListener('keyup', up);
        } catch { /* doc may be gone */ }
      });
    };
  }, []);

  // ── Inspector 활성 시 iframe pointer-events 차단 ──────
  useEffect(() => {
    if (!active) return;
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach((f) => { f.style.pointerEvents = 'none'; });
    return () => {
      iframes.forEach((f) => { f.style.pointerEvents = ''; });
    };
  }, [active]);

  // ── Mouse tracking + region drag + wheel parent traverse ──
  useEffect(() => {
    if (!active) return;

    const target: Target = { el: null, iframeEl: null, depthOffset: 0, innermost: null, remote: null };
    const prevRect = { top: 0, left: 0, width: 0, height: 0 };
    let rafId = 0;
    /** 마지막 커서 자리 — 휠로 부모를 올라갈 때 **같은 자리**를 다시 묻기 위해 들고 있는다. */
    let lastPoint = { x: 0, y: 0 };
    /** 페이지에 물어본 답을 기다리는 중인가(한 번에 하나만 묻는다). */
    let remoteBusy = false;
    /** 기다리는 동안 커서가 움직였다면 그 마지막 자리 — 답이 오면 곧바로 다시 묻는다. */
    let remotePending: { x: number; y: number } | null = null;

    // 영역 드래그 상태
    let dragStart: { x: number; y: number; iframeEl: HTMLIFrameElement | null } | null = null;

    /** innermost + depthOffset → 현재 타겟 요소 재계산, info 갱신 */
    const refreshTargetFromInnermost = (): void => {
      if (!target.innermost) return;
      const resolved = applyDepthOffset(target.innermost, target.depthOffset);
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
        remoteBusy = false;
        // 그 사이 Alt 를 떼었거나 다른 곳으로 갔으면 옛 답이다 — 버린다.
        if (res && target.iframeEl === iframeEl) {
          target.remote = res;
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

    const syncRect = (): void => {
      if (target.el) {
        const rect = getAdjustedRect(target.el, target.iframeEl);
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

      lastPoint = { x: e.clientX, y: e.clientY };

      // 1) iframe 영역 안인지 수동 체크
      const iframeHit = probeIframes(e.clientX, e.clientY);
      if (iframeHit) {
        // 1-a) 문서를 못 읽는 iframe(미리보기 페이지) — 페이지에 물어본다(⑮ (i)).
        if (iframeHit.el === null) {
          if (target.iframeEl !== iframeHit.iframeEl) {
            target.iframeEl = iframeHit.iframeEl;
            target.depthOffset = 0;
            target.remote = null;
            target.el = null;
            target.innermost = null;
            lastElRef.current = null;
          }
          askPage(iframeHit.iframeEl, e.clientX, e.clientY);
          return;
        }
        if (iframeHit.el === lastElRef.current) return;
        lastElRef.current = iframeHit.el;
        target.innermost = iframeHit.el;
        target.iframeEl = iframeHit.iframeEl;
        target.remote = null;
        target.depthOffset = 0;  // 새 요소로 이동 시 offset 리셋
        refreshTargetFromInnermost();
        return;
      }

      // 2) 일반 요소
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || (el as HTMLElement).closest?.(`#${INSPECTOR_OVERLAY_ID}`)) {
        setInfo(null);
        target.el = null;
        target.iframeEl = null;
        target.innermost = null;
        target.remote = null;
        target.depthOffset = 0;
        lastElRef.current = null;
        return;
      }

      if (el === lastElRef.current) return;
      lastElRef.current = el;
      target.innermost = el;
      target.iframeEl = null;
      target.remote = null;
      target.depthOffset = 0;
      refreshTargetFromInnermost();
    };

    // 스크롤 휠 → 부모/자식 체인 이동 (A 기능)
    const handleWheel = (e: WheelEvent): void => {
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
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      // Shift+Alt+드래그 → 영역 선택 모드 시작 (B 기능)
      if (e.shiftKey) {
        const iframeHit = probeIframes(e.clientX, e.clientY);
        dragStart = {
          x: e.clientX,
          y: e.clientY,
          iframeEl: iframeHit ? iframeHit.iframeEl : null,
        };
        setRegion({ x: e.clientX, y: e.clientY, width: 0, height: 0 });
        return;
      }

      // ⑮ (i) — 페이지 요소를 이미 집어 두었으면 그 답을 그대로 쓴다(왕복 없이 즉시 복사).
      if (target.remote) {
        void copyAndFlash(
          buildSiteClipboardText(target.remote.hit, target.remote.url),
          siteHitSummary(target.remote.hit),
        );
        return;
      }

      // 기존: 요소 클릭 → 복사
      if (!target.el) {
        const iframeHit = probeIframes(e.clientX, e.clientY);
        if (iframeHit && iframeHit.el === null) {
          // Alt 를 누르자마자 움직이지 않고 눌렀다 — 답을 받고 나서 복사한다(⑮ (i)).
          const ir = iframeHit.iframeEl.getBoundingClientRect();
          void probeWorkspaceSite(iframeHit.iframeEl, e.clientX - ir.left, e.clientY - ir.top, 0)
            .then((res) => {
              if (!res) return;
              void copyAndFlash(buildSiteClipboardText(res.hit, res.url), siteHitSummary(res.hit));
            });
          return;
        }
        if (iframeHit?.el) {
          target.innermost = iframeHit.el;
          target.iframeEl = iframeHit.iframeEl;
          target.depthOffset = 0;
          refreshTargetFromInnermost();
        }
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

      const tag = target.el.tagName.toLowerCase();
      const elId = (target.el as HTMLElement).id;
      const cls = getClassString(target.el).split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      let summary = `<${tag}`;
      if (elId) summary += `#${elId}`;
      else if (cls) summary += `.${cls}`;
      summary += '>';

      void copyAndFlash(clipText, summary);
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

    document.addEventListener('mousemove', move);
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('pointerup', handlePointerUp, true);
    document.addEventListener('click', blockClick, true);
    document.addEventListener('wheel', handleWheel, { capture: true, passive: false });
    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('pointerup', handlePointerUp, true);
      document.removeEventListener('click', blockClick, true);
      document.removeEventListener('wheel', handleWheel, { capture: true } as EventListenerOptions);
    };
  }, [active]);

  return { active, shiftHeld, info, region, copied, copiedSummary };
}
