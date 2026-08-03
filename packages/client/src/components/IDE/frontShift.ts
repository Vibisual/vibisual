/**
 * frontShift — 가상 리스트(react-virtuoso) 앞쪽 절단(shift) 신고용 firstItemIndex 계산 (v3.13).
 *
 * 왜 필요한가: 클라 스트림 버퍼는 누적 부하 완화를 위해 상한(STREAM_EVENTS_MAX_PER_SESSION + slack)을
 * 넘기면 **앞쪽(가장 오래된 것)부터 일괄 절단**된다. 그런데 virtuoso 의 항목 높이 기억(sizeTree)과
 * offsetTree 는 **인덱스 기반**이라, 데이터 앞이 K개 잘리면 전 항목의 인덱스가 K 만큼 밀려 측정 모델
 * 전체가 실제 DOM 과 어긋난다 → 그 순간 scrollToIndex(LAST) pin·followOutput·restoreState·atBottom
 * 판정이 전부 틀린 좌표로 계산돼 화면이 "위로 말려 올라가고" 최신이 안 보인다(긴 세션 한정, 새 이벤트
 * 유입 = 절단 시점에 발생).
 *
 * 해법은 라이브러리 공식 프로토콜: `firstItemIndex` 를 **누적 앞쪽 제거 수**만큼 늘려 주면 virtuoso 가
 * shift 경로(shiftWith/shiftWithOffset)로 sizeTree 키를 재정렬하고 scrollTop 을 제거분 높이만큼
 * 보정한다(절단이 스크롤에 무영향). 판정은 순수 함수로 분리해 Vitest 로 결정론적 검증(frontShift.test).
 */
import { useMemo, useRef } from 'react';

/**
 * 직전 렌더의 id 목록(prevIds) 대비, 새 목록(nextIds)에서 **앞쪽이 몇 개 제거됐는지** 센다.
 *
 * - 선두부터 "새 목록에 더 이상 존재하지 않는 id" 가 이어지는 길이 = 제거 수. (부분 절단으로 첫 항목의
 *   id 자체가 바뀐 경우도 옛 id 가 사라지므로 함께 잡힌다.)
 * - 교집합이 0인 전량 교체(세션 리하이드레이트 등)는 shift 가 아니라 새 리스트다 — 0 을 반환해
 *   firstItemIndex 를 움직이지 않는다(잘못된 대규모 scrollBy 보정 방지, 재측정이 알아서 정착).
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

/**
 * items 가 바뀔 때마다 앞쪽 제거 수를 누적해 virtuoso 에 넘길 `firstItemIndex` 를 돌려준다.
 * getId 는 렌더 간 안정된 참조여야 한다(모듈 상수 또는 useCallback).
 *
 * §5.5 #17-12 — `resetKey` 는 "리스트를 다르게 접는 방식으로 바꿨다"는 신호(표시 밀도 전환 등)다.
 * 밀도가 바뀌면 앞쪽 항목의 id 가 통째로 갈리는데(`e1` ↔ `toolgroup-e1`), 그걸 절단으로 오인하면
 * virtuoso 가 있지도 않은 제거분만큼 스크롤을 보정해 화면이 튄다. 키가 바뀐 렌더에서는 **세지 않고
 * 기준선만 새 목록으로 교체**한다(다음 렌더부터 다시 정상 감지).
 */
export function useVirtuosoFrontShift<T>(items: readonly T[], getId: (item: T) => string, resetKey?: string): number {
  const stateRef = useRef<FrontShiftState>({ base: 0, prevIds: [], prevKey: resetKey });
  return useMemo(() => {
    stateRef.current = advanceFrontShift(stateRef.current, items.map(getId), resetKey);
    return stateRef.current.base;
  }, [items, getId, resetKey]);
}

/** 훅이 렌더 간 들고 가는 상태(누적 shift + 직전 id 목록 + 직전 리셋 키). 순수 함수로 검증하기 위해 분리. */
export interface FrontShiftState {
  base: number;
  prevIds: readonly string[];
  prevKey?: string | undefined;
}

/**
 * 한 렌더분 상태 전이(순수). `key` 가 직전과 다르면 **세지 않고 기준선만 교체**한다 — 밀도 전환처럼
 * 접는 방식이 통째로 바뀐 렌더를 절단으로 오인하지 않기 위함.
 */
export function advanceFrontShift(state: FrontShiftState, nextIds: readonly string[], key?: string): FrontShiftState {
  const reset = state.prevKey !== key;
  const base = reset ? state.base : state.base + countRemovedFromFront(state.prevIds, nextIds);
  return { base, prevIds: nextIds, prevKey: key };
}
