/**
 * §5.11 — 내용이 그대로면 같은 배열을 돌려준다. `bashHistory`·`taskEdges`·`captureBubbles` 는 통짜로 읽혀 아무 세션의 Bash 하나에도
 * 모든 버블의 카드 `match`·`render` 가 다시 돈다 — 이 버블 몫만 잘라 지난번과 같으면 지난 배열을 준다.
 * 얕은 비교로 충분하다 — 항목은 제자리에서 고쳐지지 않고 교체된다(§3.2).
 */
import { useRef } from 'react';

function sameItems(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** 판단은 순수 함수, 훅은 기억만 — 클라엔 훅을 렌더해 볼 jsdom 이 없다. `undefined` = 아무도 요청하지 않은 축(그대로 통과). */
export function pickStable<T>(prev: T[] | undefined, next: T[] | undefined): T[] | undefined {
  if (next === undefined) return undefined;
  if (prev !== undefined && sameItems(prev, next)) return prev;
  return next;
}

/** `next` 가 지난 값과 항목까지 같으면 **지난 값을 그대로** 돌려준다. */
export function useStableSlice<T>(next: T[] | undefined): T[] | undefined {
  const prev = useRef<T[] | undefined>(undefined);
  prev.current = pickStable(prev.current, next);
  return prev.current;
}

/** 훅 밖에서도 쓰도록 비교만 떼어 둔다(테스트가 규칙을 직접 확인한다). */
export const sameSliceItems = sameItems;
