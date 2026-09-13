// §5.4 #14-2 / §5.5 #16-1 (E) — **꾹 눌러 자리를 옮기는 손짓 한 벌.**
//
// 활동바(세로)가 먼저 세운 손맛을 프로젝트 탭·IDE 세션 탭(가로)이 그대로 쓴다. 종전 두 탭바는
// HTML5 네이티브 DnD 였다 — 살짝만 밀어도 탭이 즉시 "뚝 떨어져" 반투명 유령이 되고, 손에 붙어
// 오는 것은 탭이 아니라 브라우저가 찍은 스크린샷이며, 놓을 때는 되돌아가는 연출이 한 번 더
// 끼어든다(사용자 지적: "때서 붙이는 느낌이 너무 어색해"). 그 셋은 전부 네이티브 DnD 가 정하는
// 것이라 CSS 로는 손댈 수 없다. 그래서 제스처를 통째로 포인터 이벤트로 옮긴다.
//
// 이 훅이 책임지는 것 — ① 길게 누르기 게이트, ② 커서에 붙는 고스트의 자리, ③ 중앙선 밀어내기
// (`tabPushGeom` 재사용), ④ 가장자리 자동 스크롤, ⑤ 끌고 난 직후의 `click` 삼킴, ⑥ `Esc` 되돌리기.
// **그리지는 않는다** — 고스트의 모양은 줄마다 다르므로(활동바는 40px 글리프, 탭바는 라벨 달린
// 탭) 호출부가 `ghostRef` 를 단 DOM 을 직접 그린다.
//
// **손을 따라가는 것은 창(window)이지 그 항목이 아니다.** 자리가 한 번 갈리면 React 가 그 줄의
// DOM 노드를 옮기고(`insertBefore` 는 옛 부모에서 먼저 떼어 낸다) 그 찰나에 브라우저가 포인터
// 캡처를 자동으로 푼다(`lostpointercapture`). 항목에 리스너를 걸면 위아래로 한 번 오간 것만으로
// 끌던 것이 손에서 사라진다 — §5.5 #16-1 (E) 가 고친 바로 그 문제라 여기서도 같은 규약이다.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  POINTER_DRAG,
  autoScrollDirection,
  ghostOffset,
  pressSurvivesMove,
  slotAtPointer,
  type DragSlot,
} from './pointerDragGeom.js';
import { resolveAxisReorder, sameOrder, type PushAxis } from './tabPushGeom.js';

/**
 * 끄는 동안 `<body>` 에 붙는 표식 — 커서·선택·**창 이동 영역**을 한꺼번에 바꾼다.
 * 규칙은 `index.css` 한 곳에 있다(컴포넌트마다 인라인 style 을 만지면 겹칠 때 서로 덮는다).
 */
const DRAG_BODY_CLASS = 'vib-pointer-drag';

/** 컨테이너는 ref 로 받든 element 로 받든 상관없다(`useTabPushAnimation` 과 같은 규약). */
export type DragContainer = HTMLElement | null | { readonly current: HTMLElement | null };

/** 손이 지금 어디 있는가 — 뷰포트 좌표와 **화면(screen) 좌표**를 함께 준다. */
export interface PointerDragPoint {
  x: number;
  y: number;
  /** 별창 분리는 BrowserWindow 좌상단 기준 좌표가 필요하다(§5.4 #14-1). */
  screenX: number;
  screenY: number;
}

export interface PointerDragReorderOptions {
  /** 항목이 늘어선 방향. 가로로 선 줄(탭바)은 `'x'`, 세로로 선 줄(활동바)은 `'y'`. */
  axis: PushAxis;
  /** 항목들이 담긴 **스크롤 컨테이너**. 각 항목은 이 칸의 직속 자식이어야 한다. */
  container: DragContainer;
  /** 항목 자식을 가려내는 data 속성 — 이게 없는 자식(끝의 [+] 버튼 등)은 대상이 아니다. */
  keyAttribute: string;
  /** 지금 화면에 그려진 순서. 손을 뗐을 때 "바뀐 게 있나"를 이것과 견준다. */
  order: readonly string[];
  /**
   * 손을 뗐다. `next` 는 순서가 실제로 달라졌을 때만 배열이고, 제자리면 `null` 이다
   * (그래도 부른다 — 탭바는 **순서가 그대로여도** 놓은 자리에 따라 별창으로 분리한다).
   * `key` 는 방금까지 손에 들려 있던 항목 — 이 시점에 `dragKey` 는 이미 비었다.
   */
  onCommit: (next: string[] | null, point: PointerDragPoint, key: string) => void;
  /** 길게 누르기가 성립해 항목이 손에 들린 순간. */
  onDragStart?: (key: string, point: PointerDragPoint) => void;
  /** 끄는 동안 매 움직임. 별창 분리 힌트·분할 미리보기처럼 **줄 밖의 일**은 호출부가 판단한다. */
  onDragMove?: (key: string, point: PointerDragPoint) => void;
  /** `Esc`·창 포커스 상실·브라우저 취소. 순서는 이미 되돌아간 뒤에 불린다. */
  onCancel?: (key: string) => void;
  /** 여기에 걸리는 곳에서 시작된 누르기는 무시한다(닫기 버튼·이름 편집 입력 등). */
  ignoreSelector?: string;
  /** 길게 누르기 시간(ms). 기본 `POINTER_DRAG.longPressMs`. */
  longPressMs?: number;
  /** 취소 판정 거리(px). 기본 `POINTER_DRAG.slopPx`. */
  slopPx?: number;
  /** 목록이 창보다 길 때 가장자리에서 따라 흐를지. 기본 `true`. */
  autoScroll?: boolean;
}

export interface PointerDragReorderApi {
  /** 지금 손에 들려 있는 항목. 이 하나로 화면이 갈린다(원래 자리는 빈 홈 · 본체는 고스트로). */
  dragKey: string | null;
  /** 끄는 동안의 로컬 순서. `null` 이면 호출부가 들고 있는 순서를 그대로 그리면 된다. */
  localOrder: string[] | null;
  /** 고스트 DOM 에 달 ref — 자리는 이 훅이 `transform` 으로 준다(프레임마다 리렌더 ❌). */
  ghostRef: MutableRefObject<HTMLDivElement | null>;
  /**
   * **집어 든 그 순간 원본이 차지하던 치수.** 끌고 있지 않으면 `null`.
   *
   * 고스트가 이걸 그대로 입지 않으면 손에 드는 순간 크기가 튄다 — 원본을 흉내 낸 미니어처는
   * 안에 든 것(라벨 폭·닫기 버튼 자리·핀/기본/루프 글리프)이 조금만 달라도 폭이 어긋나고,
   * 그 어긋남은 "뚝 떼서 붙이는" 느낌의 정체 그 자체다(사용자 지적 — 세션 탭이 절반으로 줄었다).
   * 활동바가 안 어긋났던 것은 원본이 `h-10 w-10` 고정이라 **우연히** 맞았기 때문이지 규율이
   * 있어서가 아니었다 — 그래서 치수는 흉내 내지 않고 **재서 물려준다**.
   */
  dragSize: { width: number; height: number } | null;
  /** 항목에 다는 유일한 핸들러. 그 뒤의 이동·놓기·취소는 **창**이 받는다. */
  onPointerDown: (e: React.PointerEvent<HTMLElement>, key: string) => void;
  /**
   * 이 `click` 을 삼켜야 하는가 — 끌고 난 직후의 클릭은 그 항목을 여는 뜻이 아니다.
   * 표는 **다음 `pointerdown` 에서 턴다**(줄 밖에서 놓으면 그 `click` 이 아예 오지 않아,
   * 안 그러면 다음 클릭 한 번이 이유 없이 먹힌다).
   */
  consumeClick: () => boolean;
  /** 바깥에서 강제로 끝낸다(컨텍스트 메뉴·탭 닫힘 등). 저장하지 않는다. */
  cancel: () => void;
}

function resolveContainer(container: DragContainer): HTMLElement | null {
  if (!container) return null;
  return 'current' in container ? container.current : container;
}

export function usePointerDragReorder(options: PointerDragReorderOptions): PointerDragReorderApi {
  const {
    axis,
    container,
    keyAttribute,
    order,
    onCommit,
    onDragStart,
    onDragMove,
    onCancel,
    ignoreSelector,
    longPressMs = POINTER_DRAG.longPressMs,
    slopPx = POINTER_DRAG.slopPx,
    autoScroll = true,
  } = options;

  const [dragKey, setDragKey] = useState<string | null>(null);
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  // 집어 든 순간 한 번만 정해진다 — 끄는 내내 변하지 않으므로 상태로 들어도 리렌더가 늘지 않는다
  //   (어차피 `setDragKey` 로 한 번 그려진다).
  const [dragSize, setDragSize] = useState<{ width: number; height: number } | null>(null);

  // 프레임마다 도는 자리라 판정용 사본은 ref 로 든다(핸들러가 낡은 값을 물지 않게).
  const dragKeyRef = useRef<string | null>(null);
  const localOrderRef = useRef<string[] | null>(null);
  // 타이머·시작 좌표는 렌더에 쓰이지 않으므로 ref 다(상태로 두면 누를 때마다 줄이 다시 그려진다).
  const pressRef = useRef<{ timer: number; key: string; x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const autoScrollRef = useRef<-1 | 0 | 1>(0);
  const lastPointRef = useRef<PointerDragPoint>({ x: 0, y: 0, screenX: 0, screenY: 0 });
  // 항목 안에서 **잡은 지점**. 이걸 빼야 고스트가 손에서 튀지 않고 "잡은 그 자리 그대로" 붙어 온다.
  const grabRef = useRef({ x: 0, y: 0 });
  const ghostRef = useRef<HTMLDivElement | null>(null);

  // 최신 옵션을 창 리스너가 늘 보게 한다 — 리스너를 매번 다시 거는 것보다 싸고 새는 자리가 없다.
  const optionsRef = useRef({ order, onCommit, onDragStart, onDragMove, onCancel, axis, keyAttribute, autoScroll, slopPx });
  optionsRef.current = { order, onCommit, onDragStart, onDragMove, onCancel, axis, keyAttribute, autoScroll, slopPx };
  const containerRef = useRef<DragContainer>(container);
  containerRef.current = container;

  const clearPress = useCallback(() => {
    if (pressRef.current) {
      window.clearTimeout(pressRef.current.timer);
      pressRef.current = null;
    }
  }, []);

  /**
   * 지금 화면에 선 항목들의 자리(뷰포트 기준 축 방향 시작·길이).
   *
   * `getBoundingClientRect()` 를 쓰지 않는다 — 밀림 재생이 도는 동안 그 값은 **애니메이션 중인
   * 좌표**라, 그걸로 중앙선을 재면 밀린 항목이 곧바로 되밀리는 떨림이 생긴다. 대신 스크롤·
   * transform 과 무관한 레이아웃 좌표(`offsetLeft`/`offsetTop`)를 컨테이너의 rect 로 옮긴다.
   */
  const measureSlots = useCallback((): DragSlot[] => {
    const el = resolveContainer(containerRef.current);
    if (!el) return [];
    const { axis: ax, keyAttribute: attr } = optionsRef.current;
    const rect = el.getBoundingClientRect();
    const base = ax === 'y' ? rect.top - el.scrollTop : rect.left - el.scrollLeft;
    const out: DragSlot[] = [];
    for (const child of Array.from(el.children)) {
      if (!(child instanceof HTMLElement)) continue;
      const key = child.getAttribute(attr);
      if (!key) continue;
      out.push({
        key,
        start: base + (ax === 'y' ? child.offsetTop : child.offsetLeft),
        size: ax === 'y' ? child.offsetHeight : child.offsetWidth,
      });
    }
    return out;
  }, []);

  /** 커서가 이웃의 중앙선을 넘었으면 그 자리를 내준다(넘기 전엔 아무 일도 없다 — 떨림 방지). */
  const reorderAt = useCallback((pointer: number): void => {
    const moved = dragKeyRef.current;
    if (!moved) return;
    const slots = measureSlots();
    const hit = slotAtPointer(slots, pointer);
    if (!hit || hit.key === moved) return;
    const current = localOrderRef.current ?? slots.map((s) => s.key);
    const next = resolveAxisReorder({
      order: current,
      movedKey: moved,
      targetKey: hit.key,
      pointer,
      targetStart: hit.start,
      targetSize: hit.size,
    });
    if (!next) return;
    localOrderRef.current = next;
    setLocalOrder(next);
  }, [measureSlots]);

  /** 고스트를 커서에 붙인다. 렌더를 태우지 않고 transform 한 줄만 쓴다. */
  const moveGhost = useCallback((): void => {
    const el = ghostRef.current;
    if (!el) return;
    const { x, y } = ghostOffset(lastPointRef.current, grabRef.current);
    el.style.transform = `translate3d(${String(x)}px, ${String(y)}px, 0)`;
  }, []);

  /** 끌던 상태를 전부 원위치(저장 여부는 부르는 쪽이 정한다). */
  const endDrag = useCallback((): void => {
    dragKeyRef.current = null;
    localOrderRef.current = null;
    setDragKey(null);
    setLocalOrder(null);
    setDragSize(null);
    autoScrollRef.current = 0;
  }, []);

  const trackingRef = useRef<(() => void) | null>(null);
  const handlersRef = useRef<{ move: (e: PointerEvent) => void; up: () => void; cancel: () => void }>({
    move: () => { /* 아직 없음 */ },
    up: () => { /* 아직 없음 */ },
    cancel: () => { /* 아직 없음 */ },
  });

  const stopTracking = useCallback((): void => {
    trackingRef.current?.();
    trackingRef.current = null;
  }, []);

  /** 누르는 그 순간부터 손을 놓을 때까지 창이 포인터를 따라간다. */
  const startTracking = useCallback((): void => {
    stopTracking();
    const onMove = (e: PointerEvent): void => { handlersRef.current.move(e); };
    const onUp = (): void => { handlersRef.current.up(); };
    const onCancelEvt = (): void => { handlersRef.current.cancel(); };
    // 벗어나기로는 취소되지 않으므로 **되돌리는 손잡이 하나**는 있어야 한다.
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') handlersRef.current.cancel(); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancelEvt);
    // 창이 포커스를 잃으면 `pointerup` 이 영영 안 온다 — 고스트가 화면에 남지 않게.
    window.addEventListener('blur', onCancelEvt);
    window.addEventListener('keydown', onKey, true);
    trackingRef.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancelEvt);
      window.removeEventListener('blur', onCancelEvt);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [stopTracking]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>, key: string): void => {
    // 왼쪽 버튼(또는 터치·펜)만. 우클릭은 컨텍스트 메뉴가 받는다.
    if (e.button !== 0) return;
    // 닫기 버튼·이름 편집 입력 위에서 시작된 누르기는 그 위젯의 것이다.
    if (ignoreSelector && e.target instanceof Element && e.target.closest(ignoreSelector)) return;
    // 지난 끌기가 줄 **밖에서** 끝났으면 그 항목의 `click` 은 아예 오지 않는다 — 삼킴 표를
    //   여기서 턴다. `click` 은 언제나 다음 `pointerdown` 보다 먼저 도착하므로 이 자리에서
    //   지워도 삼켜야 할 것을 놓치지 않는다.
    suppressClickRef.current = false;
    const target = e.currentTarget;
    const { pointerId } = e;
    clearPress();
    lastPointRef.current = { x: e.clientX, y: e.clientY, screenX: e.screenX, screenY: e.screenY };
    startTracking();
    const timer = window.setTimeout(() => {
      pressRef.current = null;
      // 항목 안에서 잡은 지점을 그대로 물려준다 — 고스트가 손 아래에서 순간이동하지 않게.
      const rect = target.getBoundingClientRect();
      const point = lastPointRef.current;
      grabRef.current = { x: point.x - rect.left, y: point.y - rect.top };
      // 고스트가 입을 옷의 치수. `rect` 는 이미 위에서 잡은 지점을 재려고 구한 것이라 덤이다.
      setDragSize({ width: rect.width, height: rect.height });
      // 보조 장치다(터치에서 스크롤 가로채기를 줄인다) — 풀려도 끌기는 창 리스너로 계속된다.
      try { target.setPointerCapture(pointerId); } catch { /* 이미 놓친 포인터는 무시 */ }
      dragKeyRef.current = key;
      localOrderRef.current = null;
      setDragKey(key);
      setLocalOrder(null);
      optionsRef.current.onDragStart?.(key, point);
    }, longPressMs);
    pressRef.current = { timer, key, x: e.clientX, y: e.clientY };
  }, [clearPress, startTracking, ignoreSelector, longPressMs]);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const point: PointerDragPoint = { x: e.clientX, y: e.clientY, screenX: e.screenX, screenY: e.screenY };
    const press = pressRef.current;
    if (press) {
      // 아직 길게 누르기 전. 취소는 **그 줄이 스크롤되는 축만** 본다(직교축은 재지 않는다).
      const alive = pressSurvivesMove({
        axis: optionsRef.current.axis,
        startX: press.x,
        startY: press.y,
        x: point.x,
        y: point.y,
        slopPx: optionsRef.current.slopPx,
      });
      if (!alive) clearPress();
      lastPointRef.current = point;
      return;
    }
    const key = dragKeyRef.current;
    if (!key) return;
    lastPointRef.current = point;
    moveGhost();
    // 스크롤되는 줄에서는 화면 밖 자리로도 옮길 수 있어야 한다 — 가장자리에 닿으면 흐른다.
    const el = resolveContainer(containerRef.current);
    if (el && optionsRef.current.autoScroll) {
      const r = el.getBoundingClientRect();
      const vertical = optionsRef.current.axis === 'y';
      autoScrollRef.current = autoScrollDirection({
        pointer: vertical ? point.y : point.x,
        viewStart: vertical ? r.top : r.left,
        viewEnd: vertical ? r.bottom : r.right,
      });
    }
    reorderAt(optionsRef.current.axis === 'y' ? point.y : point.x);
    optionsRef.current.onDragMove?.(key, point);
  }, [clearPress, moveGhost, reorderAt]);

  /** 손을 놓으면 **어디서 놓았든** 지금 순서 그대로 앉힌다(줄 밖도 마찬가지). */
  const handlePointerUp = useCallback(() => {
    clearPress();
    stopTracking();
    const key = dragKeyRef.current;
    if (key === null) return;
    const next = localOrderRef.current;
    const point = lastPointRef.current;
    endDrag();
    suppressClickRef.current = true;
    const changed = next && !sameOrder(next, optionsRef.current.order) ? next : null;
    optionsRef.current.onCommit(changed, point, key);
  }, [clearPress, stopTracking, endDrag]);

  /**
   * 되돌리고 끝낸다 — `Esc` · 브라우저 취소(터치에서 스크롤로 가로챌 때) · 창 포커스 상실.
   * **벗어나기·자리 바뀜은 여기 없다** — 그 둘이 취소이던 것이 §5.5 #16-1 (E) 가 고친 문제다.
   */
  const handleDragCancel = useCallback(() => {
    clearPress();
    stopTracking();
    const key = dragKeyRef.current;
    if (!key) return;
    // 로컬 순서를 비우면 화면은 원래 순서로 되돌아간다(저장 ❌ — 되돌리기가 곧 취소다).
    endDrag();
    suppressClickRef.current = true;
    optionsRef.current.onCancel?.(key);
  }, [clearPress, stopTracking, endDrag]);

  handlersRef.current = { move: handlePointerMove, up: handlePointerUp, cancel: handleDragCancel };

  // 창이 사라지거나 컴포넌트가 내려가도 타이머·리스너는 남는다 — 붙잡아 둔 것은 반드시 푼다.
  useEffect(() => () => { clearPress(); stopTracking(); }, [clearPress, stopTracking]);

  const isDragging = dragKey !== null;

  // 고스트는 뜨는 그 프레임에 이미 커서 위에 있어야 한다(안 그러면 한 번 좌상단에서 날아온다).
  useLayoutEffect(() => {
    if (isDragging) moveGhost();
  }, [isDragging, moveGhost]);

  /*
   * 끄는 **동안만** 문서 전체의 성격이 바뀐다(규칙은 `index.css` 의 `body.vib-pointer-drag`).
   *
   * 커서가 쥔 손이 되고 지나는 글자가 선택되지 않는 것이 하나, **창 이동 영역(OS 캡션)이 잠깐
   * 비켜서는** 것이 둘이다. 뒤엣것이 없으면 탭을 헤더 쪽으로 가져가는 순간 손짓이 렌더러에
   * 도착하지 않아 고스트가 얼어붙고, 거기서 손을 떼면 `pointerup` 마저 오지 않아 끌던 것이 화면에
   * 남는다(네이티브 DnD 에는 없던 자리 — 그쪽은 OS 드래그 루프였다).
   */
  useEffect(() => {
    if (!isDragging || typeof document === 'undefined') return;
    const { body } = document;
    body.classList.add(DRAG_BODY_CLASS);
    return () => { body.classList.remove(DRAG_BODY_CLASS); };
  }, [isDragging]);

  /*
   * 가장자리에서 흐르는 동안에도 자리가 계속 갈려야 한다.
   *
   * `pointermove` 만으로는 안 된다 — 손을 가장자리에 **대고 멈추면** 이벤트가 끊겨 줄만 흐르고
   * 순서는 그 자리에 굳는다. 그래서 프레임마다 마지막 커서 자리로 다시 잰다.
   * 조건은 `isDragging`(boolean) 하나라 끄는 내내 루프가 다시 서지 않는다.
   */
  useEffect(() => {
    if (!isDragging) return;
    let raf = 0;
    const step = (): void => {
      const el = resolveContainer(containerRef.current);
      const dir = autoScrollRef.current;
      if (el && dir !== 0) {
        const vertical = optionsRef.current.axis === 'y';
        if (vertical) el.scrollTop += dir * POINTER_DRAG.autoScrollStepPx;
        else el.scrollLeft += dir * POINTER_DRAG.autoScrollStepPx;
        reorderAt(vertical ? lastPointRef.current.y : lastPointRef.current.x);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      autoScrollRef.current = 0;
    };
  }, [isDragging, reorderAt]);

  const consumeClick = useCallback((): boolean => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }, []);

  const cancel = useCallback((): void => { handleDragCancel(); }, [handleDragCancel]);

  return { dragKey, localOrder, dragSize, ghostRef, onPointerDown, consumeClick, cancel };
}
