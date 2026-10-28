/**
 * frontShift — virtuoso 앞쪽 절단 신고용 firstItemIndex. 스트림 버퍼는 상한(STREAM_EVENTS_MAX_PER_SESSION + slack)을 넘으면 앞부터 잘리고, virtuoso 측정은 인덱스 기반이라
 * 그대로면 화면이 위로 말린다 — 누적 제거 수만큼 `firstItemIndex` 를 늘린다(공식 shift 프로토콜).
 */
import { useMemo, useRef } from 'react';

/**
 * 직전 대비 앞쪽에서 사라진 id 수(선두부터 새 목록에 없는 id 의 길이 — 첫 id 가 바뀐 부분 절단도 잡힌다).
 * 교집합 0(전량 교체·리하이드레이트)은 0 — 움직이면 엉뚱한 대규모 scrollBy 가 난다.
 */
export function countRemovedFromFront(prevIds: readonly string[], nextIds: readonly string[]): number {
  if (prevIds.length === 0 || nextIds.length === 0) return 0;
  const nextSet = new Set(nextIds);
  let removed = 0;
  while (removed < prevIds.length) {
    const id = prevIds[removed];
    if (id === undefined || nextSet.has(id)) break;
    removed += 1;
  }
  if (removed === prevIds.length) return 0;
  return removed;
}

/** §5.5 #17-12 — 보고 있는 자리 앞의 늘고(+) 준(−) 수. 과거는 맨 위 명령 블록 사이로 끼어 맨 앞 기준으론 못 잡는다 — 직전 첫 항목(`viewIndex`)부터 새 목록에 남은 항목이 옮겨 간 만큼(없으면 0). */
export function shiftAroundView(prevIds: readonly string[], nextIds: readonly string[], viewIndex: number): number {
  if (prevIds.length === 0 || nextIds.length === 0) return 0;
  const v = Math.min(Math.max(0, Math.floor(viewIndex)), prevIds.length - 1);
  // 대부분의 렌더(꼬리에 줄이 붙는 스트리밍)는 보는 자리가 그대로다 — 색인을 만들지 않고 끝낸다.
  if (nextIds[v] === prevIds[v]) return 0;
  const nextIndex = new Map<string, number>();
  nextIds.forEach((id, i) => { if (!nextIndex.has(id)) nextIndex.set(id, i); });
  for (let k = v; k < prevIds.length; k++) {
    const at = nextIndex.get(prevIds[k]!);
    if (at !== undefined) return at - k;
  }
  for (let k = v - 1; k >= 0; k--) {
    const at = nextIndex.get(prevIds[k]!);
    if (at !== undefined) return at - k;
  }
  return 0;
}

/** §5.5 #17-12 — 첫 기준값. `firstItemIndex` 가 음수면 virtuoso 가 오류를 내므로 앞에 붙는 몫을 줄일 여유를 두고 크게 시작한다(차이만 쓰인다). */
export const FRONT_SHIFT_ORIGIN = 1_000_000_000;

/**
 * items 가 바뀔 때마다 virtuoso 에 넘길 `firstItemIndex`(getId·viewIndexOf 는 안정된 참조). §5.5 #17-12 — `resetKey` 가 바뀐 렌더(밀도 전환)는 기준선만 바꾼다.
 * `viewIndexOf`(직전 목록의 화면 맨 위 순번)를 주면 앞에 붙은 것까지 신고한다(`shiftAroundView` — 버퍼가 끼는 `rangeChanged` 순번 ❌). 없으면 앞쪽 절단만.
 */
export function useVirtuosoFrontShift<T>(
  items: readonly T[],
  getId: (item: T) => string,
  resetKey?: string,
  viewIndexOf?: (prevIds: readonly string[]) => number | undefined,
): number {
  const stateRef = useRef<FrontShiftState>({ base: FRONT_SHIFT_ORIGIN, prevIds: [], prevKey: resetKey });
  return useMemo(() => {
    const prev = stateRef.current;
    const view = viewIndexOf && prev.prevKey === resetKey && prev.prevIds.length > 0 ? viewIndexOf(prev.prevIds) : undefined;
    stateRef.current = advanceFrontShift(prev, items.map(getId), resetKey, view);
    return stateRef.current.base;
  }, [items, getId, resetKey, viewIndexOf]);
}

/** 훅이 렌더 간 들고 가는 상태(누적 shift + 직전 id 목록 + 직전 리셋 키). 순수 함수로 검증하기 위해 분리. */
export interface FrontShiftState {
  base: number;
  prevIds: readonly string[];
  prevKey?: string | undefined;
}

/** 한 렌더분 상태 전이(순수). `key` 가 바뀌면 세지 않고 기준선만 교체한다. `viewIndex` 를 주면 그 앞에 붙을 때 기준값이 줄고(prepend), 잘리면 는다. */
export function advanceFrontShift(state: FrontShiftState, nextIds: readonly string[], key?: string, viewIndex?: number): FrontShiftState {
  if (state.prevKey !== key) return { base: state.base, prevIds: nextIds, prevKey: key };
  const base = viewIndex === undefined
    ? state.base + countRemovedFromFront(state.prevIds, nextIds)
    : state.base - shiftAroundView(state.prevIds, nextIds, viewIndex);
  return { base, prevIds: nextIds, prevKey: key };
}
