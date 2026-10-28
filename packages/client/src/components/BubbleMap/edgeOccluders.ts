import { useCallback, useRef, useSyncExternalStore } from 'react';
import { useStoreApi } from '@xyflow/react';
import type { MaskCircle } from './edgeMaskGeometry.js';
import { curveBox, occludersFor, type CubicCurve } from './edgeOcclusion.js';

/**
 * §5.4 #31 (K) — 가림 원 게시판, React Flow 인스턴스마다 하나(한 화면에 RF 가 여럿 선다 — §5.5 #17-17 ㉖). 게시판 없는 캔버스의 선은 아무것도 안 가린다.
 * 선은 자기 곡선에 닿는 원만 구독해, 버블 하나가 움직이면 그 원이 지나는 선만 다시 잘린다.
 */

interface OccluderBoard {
  circles: readonly MaskCircle[];
  listeners: Set<() => void>;
}

const NO_CIRCLES: readonly MaskCircle[] = [];
const boards = new WeakMap<object, OccluderBoard>();

/** `useStoreApi()` 는 부를 때마다 새로 감싼 객체라 열쇠로 쓰면 게시와 읽기가 다른 판을 본다(선이 안 잘린다) — 인스턴스마다 하나인 `getState` 를 쓴다. */
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

/** 값이 같은 원은 지난 객체를 재사용한다 — 선은 객체 동일성으로 다시 그릴지 정해, 새 객체면 닿는 선이 전부 헛되이 깬다. 다 같으면 지난 배열 그대로. */
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
