import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLongPress } from '../../hooks/useIsMobile.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { useRefLinkDragStore } from '../../stores/refLinkDrag.js';
import type { ClosestTarget } from './canvasSurface.js';

/**
 * §4 · §5.4 #34 — 버블·노드 위 길게 누르기 = 우클릭 메뉴(터치에만 — iOS Safari 는 길게 눌러도 `contextmenu` 를 주지 않는다).
 * 노드마다 달지 않는다: 캔버스가 **캡처 단계**에서 받아(d3-drag 가 버블 단계 터치를 삼킨다) 그 자리에 `contextmenu` 를 쏴 우클릭과 같은 길을 탄다.
 * ① 안드로이드 Chrome 이 스스로 준 `contextmenu` 와 겹치지 않게 한다 — 두 번이면 우더블클릭(휴지통 진입, `RIGHT_DBLCLICK_MS`)으로 읽힌다.
 * ② 뗀 뒤 흉내 mousedown·click 을 그 자리 근처·다음 누름 전까지(`NODE_LONG_PRESS_GHOST_MS`) 삼킨다 — 안 그러면 메뉴가 닫히거나 첫 줄이 눌린다.
 * ③ 입력칸·`nodrag` 위와 연결선을 끄는 중에는 열지 않는다(우클릭은 끌기 취소다).
 */

/** 손을 뗀 뒤 흉내 마우스 이벤트(mousedown·mouseup·click)를 삼키는 최대 시간(ms). */
export const NODE_LONG_PRESS_GHOST_MS = 600;
/** 그 이벤트가 길게 누른 자리에서 이만큼 안일 때만 삼킨다(px) — 길게 누르기가 견디는 움직임(12px)의 두 배. */
export const NODE_LONG_PRESS_GHOST_RADIUS = 24;

/** `.dragging` — 끌기는 5px(`nodeDragThreshold`)에서 시작하고 길게 누르기는 12px 까지 견디므로, 끄는 도중 멈칫해도 메뉴를 부르지 않게. */
export const NODE_LONG_PRESS_SKIP_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .nodrag, [data-capture-control="on"], .react-flow__node.dragging';
/** 메뉴를 가진 자리 — 노드, 그리고 여럿을 고르면 그 위에 덮이는 묶음 상자(`onSelectionContextMenu`). */
export const NODE_LONG_PRESS_SELECTOR = '.react-flow__node, .react-flow__nodesselection';

/** DOM 없이 시험하려고 `closest` 하나만 요구한다(`canvasSurface` 와 같은 꼴). 판정할 수 없으면 `false`. */
export function isNodeLongPressTarget(target: unknown): boolean {
  const el = target as ClosestTarget | null | undefined;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.closest(NODE_LONG_PRESS_SKIP_SELECTOR)) return false;
  return !!el.closest(NODE_LONG_PRESS_SELECTOR);
}

/** 흉내 이벤트를 삼킬 자리와 시한. */
export interface NodeLongPressGhostGuard {
  x: number;
  y: number;
  until: number;
}

/** 이 마우스 이벤트가 방금 끝난 길게 누르기의 흉내인가. */
export function isNodeLongPressGhost(
  guard: NodeLongPressGhostGuard | null,
  x: number,
  y: number,
  now: number,
): boolean {
  if (!guard || now > guard.until) return false;
  return Math.hypot(x - guard.x, y - guard.y) <= NODE_LONG_PRESS_GHOST_RADIUS;
}

/** 손을 뗀 뒤 흉내로 오는 마우스 이벤트들. */
const GHOST_EVENTS = ['mousedown', 'mouseup', 'click'] as const;

export interface NodeLongPressCaptureHandlers {
  onTouchStartCapture: (e: React.TouchEvent) => void;
  onTouchMoveCapture: (e: React.TouchEvent) => void;
  onTouchEndCapture: (e: React.TouchEvent) => void;
  onTouchCancelCapture: (e: React.TouchEvent) => void;
}

/** 지금 누르고 있는 한 손가락의 사정. */
interface TouchSession {
  /** 한 손가락으로 누르는 중인가(두 손가락이면 핀치다). */
  active: boolean;
  /** 누른 자리(화면 좌표) — 흉내 이벤트를 삼킬 자리. */
  x: number;
  y: number;
  /** 길게 누르기가 노드 위에서 다 찼다(우리가 쐈거나, 브라우저가 이미 줬다). */
  fired: boolean;
  /** 브라우저가 스스로 `contextmenu` 를 줬다(안드로이드). */
  native: boolean;
}

const IDLE_SESSION: TouchSession = { active: false, x: 0, y: 0, fired: false, native: false };

/** 캔버스 컨테이너에 그대로 펼쳐 넣는 **캡처 단계** 터치 핸들러 묶음. */
export function useNodeLongPressMenu(): NodeLongPressCaptureHandlers {
  const session = useRef<TouchSession>({ ...IDLE_SESSION });
  const guard = useRef<NodeLongPressGhostGuard | null>(null);

  const openAt = useCallback((x: number, y: number, target: EventTarget | null): void => {
    const s = session.current;
    if (!s.active || !isNodeLongPressTarget(target)) return;
    // ③ 연결선을 끄는 중이면 그 손짓의 몫이다.
    if (useGraphStore.getState().taskEdgeDrag || useRefLinkDragStore.getState().drag) return;
    s.fired = true;
    // ① 브라우저가 이미 줬다 — 메뉴는 그쪽 요청이 열었다.
    if (s.native) return;
    target?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 2,
      clientX: x,
      clientY: y,
    }));
  }, []);
  // 넷 다 `useCallback` 으로 굳은 손잡이다(묶음 객체는 그리기마다 새로 오므로 낱개로 받는다).
  const { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel } = useLongPress(openAt);

  useEffect(() => {
    // ① 브라우저가 주는 메뉴 요청 — 먼저 오면 표시만 하고(그 요청이 메뉴를 연다), 우리가 쏜 뒤에 오면 삼킨다.
    const onContextMenu = (e: MouseEvent): void => {
      const s = session.current;
      if (!e.isTrusted || !s.active || !isNodeLongPressTarget(e.target)) return;
      if (s.fired && !s.native) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      s.native = true;
    };
    // ② 손을 뗀 뒤의 흉내 마우스 이벤트 — 다른 창 캡처 리스너(메뉴의 바깥 누르기 닫기 등)보다 먼저 받아 끊는다.
    const onGhost = (e: MouseEvent): void => {
      if (!e.isTrusted || guard.current === null) return;
      const now = Date.now();
      if (now > guard.current.until) {
        guard.current = null;
        return;
      }
      if (!isNodeLongPressGhost(guard.current, e.clientX, e.clientY, now)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('contextmenu', onContextMenu, true);
    for (const type of GHOST_EVENTS) window.addEventListener(type, onGhost, true);
    return () => {
      window.removeEventListener('contextmenu', onContextMenu, true);
      for (const type of GHOST_EVENTS) window.removeEventListener(type, onGhost, true);
    };
  }, []);

  return useMemo(() => {
    const finish = (): void => {
      const s = session.current;
      if (s.active && (s.fired || s.native)) {
        guard.current = { x: s.x, y: s.y, until: Date.now() + NODE_LONG_PRESS_GHOST_MS };
      }
      session.current = { ...IDLE_SESSION };
    };
    return {
      onTouchStartCapture: (e: React.TouchEvent): void => {
        // 새 누름이 오면 앞 누름의 흉내는 이미 지나갔다 — 이 누름이 낳는 마우스 이벤트는 삼키지 않는다.
        guard.current = null;
        const touch = e.touches[0];
        session.current = touch && e.touches.length === 1
          ? { active: true, x: touch.clientX, y: touch.clientY, fired: false, native: false }
          : { ...IDLE_SESSION };
        onTouchStart(e);
      },
      onTouchMoveCapture: onTouchMove,
      onTouchEndCapture: (e: React.TouchEvent): void => {
        finish();
        onTouchEnd(e);
      },
      onTouchCancelCapture: (e: React.TouchEvent): void => {
        finish();
        onTouchCancel(e);
      },
    };
  }, [onTouchStart, onTouchMove, onTouchEnd, onTouchCancel]);
}
