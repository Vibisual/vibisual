import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLongPress } from '../../hooks/useIsMobile.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { useRefLinkDragStore } from '../../stores/refLinkDrag.js';
import type { ClosestTarget } from './canvasSurface.js';

/**
 * §4 v3.16 · §5.4 #34 — **버블·노드 위 길게 누르기 = 그 버블의 우클릭 메뉴.**
 *
 * 터치에는 우클릭이 없다. 캔버스 빈 곳은 길게 누르기로 생성 메뉴를 열었지만(`BubbleMap` 의 `canvasLongPress`),
 * 버블·노드 위에는 그 길이 없었다 — iOS Safari 처럼 길게 눌러도 `contextmenu` 를 주지 않는 브라우저에서는 버블
 * 메뉴(휴지통으로 이동·삭제·자물쇠·말풍선 전환)와 앱·선반·플레이·랩·스펙 노드의 메뉴에 닿을 수 없었다.
 *
 * **노드마다 손을 달지 않는다.** 캔버스 컨테이너가 **캡처 단계**에서 한 번 받고(노드 래퍼의 d3-drag 가 버블 단계
 * 터치를 `stopImmediatePropagation` 으로 삼키므로 캡처여야 닿는다), 길게 누른 바로 그 자리에 `contextmenu` 를
 * 쏜다. 그러면 우클릭과 **같은 길**을 그대로 탄다 — 각 노드의 `onContextMenu`, 묶음 메뉴, 우클릭이 누름을 접는
 * `bubbleSelectGesture`(손을 떼도 선택되지 않는다). 메뉴를 여는 규칙이 두 벌이 되지 않는다.
 *
 * 세 가지를 지킨다.
 *  ① **브라우저가 준 메뉴 요청과 겹치지 않는다** — 안드로이드 Chrome 은 길게 누르면 스스로 `contextmenu` 를 준다.
 *     그게 먼저 왔으면 쏘지 않고, 우리가 먼저 쐈으면 뒤늦게 온 것을 삼킨다(두 번 오면 우더블클릭 = 휴지통 진입으로
 *     읽는 버블이 있다 — `BubbleNode` `RIGHT_DBLCLICK_MS`).
 *  ② **손을 뗀 뒤 브라우저가 흉내 내는 마우스 이벤트를 삼킨다** — 메뉴는 손가락 바로 그 자리에 열리므로, 뗄 때 오는
 *     mousedown 이 메뉴를 곧바로 닫고 click 이 메뉴 첫 줄을 눌러 버린다(캔버스 생성 메뉴가 `touchOpenGraceMs` 로
 *     피하던 그 자리). 길게 누른 자리 근처에서, 다음 누름이 오기 전까지만(상한 `NODE_LONG_PRESS_GHOST_MS`) 삼킨다.
 *  ③ **제 손짓이 있는 자리는 건드리지 않는다** — 입력칸(글자 고르기)·`nodrag`(슬라이더·재생 위치·위성 손잡이·원격
 *     조작면) 위, 그리고 연결선을 끄는 중에는 길게 눌러도 메뉴를 열지 않는다(우클릭은 끌기를 취소하는 손이다).
 *
 * 마우스·펜에는 아무 일도 하지 않는다 — 터치 이벤트에만 걸린다.
 */

/** 손을 뗀 뒤 흉내 마우스 이벤트(mousedown·mouseup·click)를 삼키는 최대 시간(ms). */
export const NODE_LONG_PRESS_GHOST_MS = 600;
/** 그 이벤트가 길게 누른 자리에서 이만큼 안일 때만 삼킨다(px) — 길게 누르기가 견디는 움직임(12px)의 두 배. */
export const NODE_LONG_PRESS_GHOST_RADIUS = 24;

/**
 * 길게 눌러도 메뉴를 열지 않는 자리 — 제 손짓이 있는 곳. 마지막 하나는 **이미 끌리고 있는 노드**다: 노드 끌기는
 * 5px(`nodeDragThreshold`)에서 시작하고 길게 누르기는 12px 까지 견디므로, 그 사이에서 멈칫한 손이 끄는 도중에
 * 메뉴를 부르지 않게 React Flow 가 끄는 노드에 다는 `dragging` 표식을 본다.
 */
export const NODE_LONG_PRESS_SKIP_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .nodrag, [data-capture-control="on"], .react-flow__node.dragging';
/** 메뉴를 가진 자리 — 노드, 그리고 여럿을 고르면 그 위에 덮이는 묶음 상자(`onSelectionContextMenu`). */
export const NODE_LONG_PRESS_SELECTOR = '.react-flow__node, .react-flow__nodesselection';

/**
 * 이 자리를 길게 누르면 메뉴를 열어도 되는가. DOM 없이 시험할 수 있게 `closest` 하나만 요구한다(`canvasSurface` 와 같은 꼴).
 * 판정할 수 없는 대상은 `false` — 애매하면 열지 않는다.
 */
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
