import { useCallback, useRef, useSyncExternalStore } from 'react';
import { useStoreApi } from '@xyflow/react';
import type { MaskCircle } from './edgeMaskGeometry.js';
import { curveBox, occludersFor, type CubicCurve } from './edgeOcclusion.js';

/**
 * §5.4 #31 (K) — 선을 가리는 버블 원 목록의 게시판. **React Flow 인스턴스마다 하나**다.
 *
 * 한 화면에 React Flow 가 둘 이상 선다(캔버스 · IDE 무대 지도 · 디버그 패널 그래프 — §5.5 #17-17 ㉖).
 * 그래서 전역 하나로 두지 않고 인스턴스마다 갈라 둔다 — 게시하는 쪽(`EdgeMask`)과 읽는 선은 같은
 * `<ReactFlow>` 안에 있다. 게시판이 없는 캔버스의 선은 아무것도 가리지 않는다(종전에 마스크가 그
 * 캔버스에만 걸리던 것과 같다).
 *
 * 선은 **자기 곡선에 닿는 원만** 구독한다. 원이 그대로인 갱신(초점처럼 클래스만 바꾼 재포장)에서는
 * 어느 선도 깨어나지 않고, 버블 하나가 움직이면 그 원이 지나는 선만 다시 잘린다.
 */

interface OccluderBoard {
  circles: readonly MaskCircle[];
  listeners: Set<() => void>;
}

const NO_CIRCLES: readonly MaskCircle[] = [];
const boards = new WeakMap<object, OccluderBoard>();

/**
 * 이 `<ReactFlow>` 의 열쇠. `useStoreApi()` 가 돌려주는 객체는 **부르는 자리마다 새로 감싼 것**이라
 * 그 객체를 열쇠로 쓰면 게시하는 쪽과 읽는 선이 서로 다른 게시판을 본다(선이 하나도 안 잘린다).
 * 감싼 속의 `getState` 는 인스턴스마다 하나다.
 */
export function useOccluderInstance(): object {
  return useStoreApi().getState;
}

function boardOf(instance: object): OccluderBoard {
  let board = boards.get(instance);
  if (!board) {
    board = { circles: NO_CIRCLES, listeners: new Set() };
    boards.set(instance, board);
  }
  return board;
}

/**
 * 값이 같은 원은 지난번 객체를 그대로 쓴다 — 선은 고른 원들이 **같은 객체인가**로 다시 그릴지를
 * 정하므로, 움직이지 않은 버블의 원이 새 객체가 되면 그 원에 닿는 선이 전부 헛되이 깨어난다.
 * 하나도 안 바뀌었으면 지난 배열 자체를 돌려준다.
 */
export function reuseUnchangedCircles(prev: readonly MaskCircle[], next: readonly MaskCircle[]): readonly MaskCircle[] {
  const byId = new Map<string, MaskCircle>();
  for (const circle of prev) byId.set(circle.id, circle);
  let changed = prev.length !== next.length;
  const merged = next.map((circle, index) => {
    const old = byId.get(circle.id);
    const kept = old && old.cx === circle.cx && old.cy === circle.cy && old.r === circle.r ? old : circle;
    if (kept !== prev[index]) changed = true;
    return kept;
  });
  return changed ? merged : prev;
}

/** `EdgeMask` 가 부른다. 원이 그대로면 아무에게도 알리지 않는다. */
export function publishOccluders(instance: object, circles: readonly MaskCircle[]): void {
  const board = boardOf(instance);
  const next = reuseUnchangedCircles(board.circles, circles);
  if (next === board.circles) return;
  board.circles = next;
  for (const notify of [...board.listeners]) notify();
}

function sameCircles(a: readonly MaskCircle[], b: readonly MaskCircle[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** 이 곡선을 가릴 수 있는 원들(출발 버블 제외). 고른 원이 그대로면 같은 배열을 돌려준다. */
export function useEdgeOccluders(curve: CubicCurve, sourceId: string): readonly MaskCircle[] {
  const board = boardOf(useOccluderInstance());
  const lastRef = useRef<readonly MaskCircle[]>(NO_CIRCLES);
  const subscribe = useCallback((notify: () => void) => {
    board.listeners.add(notify);
    return () => { board.listeners.delete(notify); };
  }, [board]);
  const getSnapshot = (): readonly MaskCircle[] => {
    const picked = board.circles.length === 0 ? NO_CIRCLES : occludersFor(board.circles, curveBox(curve), sourceId);
    if (sameCircles(picked, lastRef.current)) return lastRef.current;
    lastRef.current = picked;
    return picked;
  };
  return useSyncExternalStore(subscribe, getSnapshot);
}
