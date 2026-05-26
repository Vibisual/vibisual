import { useState, useEffect, useRef } from 'react';
import {
  INSPECTOR_OVERLAY_ID,
  getClassString,
  getAdjustedRect,
  buildClipboardText,
  buildRegionClipboardText,
  type RegionInfo,
} from '../utils/inspector.js';

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
}

/**
 * 마우스 좌표가 iframe 영역 안에 있으면 contentDocument에서 요소를 찾는다.
 * pointer-events: none 상태이므로 elementFromPoint가 iframe을 반환하지 않아
 * bounding rect로 수동 판별한다.
 */
function probeIframes(
  cx: number,
  cy: number,
): { el: Element; iframeEl: HTMLIFrameElement } | null {
  const iframes = document.querySelectorAll('iframe');
  for (const iframe of iframes) {
    const ir = iframe.getBoundingClientRect();
    if (cx < ir.left || cx > ir.right || cy < ir.top || cy > ir.bottom) continue;
    try {
      const doc = iframe.contentDocument;
      if (!doc) continue;
      const inner = doc.elementFromPoint(cx - ir.left, cy - ir.top);
      if (inner) return { el: inner, iframeEl: iframe };
    } catch {
      // cross-origin — skip
    }
  }
  return null;
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

  // ── Alt/Shift key tracking ──────────────────────────
  // iframe 내부 포커스에서도 keydown을 받으려면 각 iframe contentDocument에도 리스너를 건다.
  useEffect(() => {
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
      }
      if (e.key === 'Shift') setShiftHeld(false);
    };
    const blur = (): void => {
      setActive(false);
      setShiftHeld(false);
      setInfo(null);
      setCopied(false);
      setRegion(null);
      lastElRef.current = null;
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
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
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

    const target: Target = { el: null, iframeEl: null, depthOffset: 0, innermost: null };
    const prevRect = { top: 0, left: 0, width: 0, height: 0 };
    let rafId = 0;

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

      // 1) iframe 영역 안인지 수동 체크
      const iframeHit = probeIframes(e.clientX, e.clientY);
      if (iframeHit) {
        if (iframeHit.el === lastElRef.current) return;
        lastElRef.current = iframeHit.el;
        target.innermost = iframeHit.el;
        target.iframeEl = iframeHit.iframeEl;
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
        target.depthOffset = 0;
        lastElRef.current = null;
        return;
      }

      if (el === lastElRef.current) return;
      lastElRef.current = el;
      target.innermost = el;
      target.iframeEl = null;
      target.depthOffset = 0;
      refreshTargetFromInnermost();
    };

    // 스크롤 휠 → 부모/자식 체인 이동 (A 기능)
    const handleWheel = (e: WheelEvent): void => {
      if (!target.innermost) return;
      e.preventDefault();
      e.stopPropagation();
      const direction = e.deltaY > 0 ? -1 : 1;  // 휠 위로 = 부모로 (+1)
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

      // 기존: 요소 클릭 → 복사
      if (!target.el) {
        const iframeHit = probeIframes(e.clientX, e.clientY);
        if (iframeHit) {
          target.innermost = iframeHit.el;
          target.iframeEl = iframeHit.iframeEl;
          target.depthOffset = 0;
          refreshTargetFromInnermost();
        }
      }
      if (!target.el) return;

      const iframeSrc = target.iframeEl?.src;
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
