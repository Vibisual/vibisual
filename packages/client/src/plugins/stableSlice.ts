/**
 * §5.11 v4.38 — 내용이 그대로면 **같은 배열을 계속 돌려준다**.
 *
 * 세 축(`bashHistory` · `taskEdges` · `captureBubbles`)은 스토어에서 레코드를 통짜로 읽는다. 그래서
 * **아무 세션의 Bash 명령 하나가 늘어도 레코드 신원이 바뀌고**, 그러면 모든 버블의 컨텍스트가 새것이 되어
 * 켜 둔 카드 전부의 `match`·`render` 가 다시 돈다. Bash 는 자주 실행되고 버블은 여럿이므로 그대로 곱해진다.
 *
 * 통짜 구독 자체를 없애려면 스토어 구조를 건드려야 하고, 매 렌더 새 배열을 만드는 선택자는 오히려 더
 * 자주 깨운다. 그래서 **가운데를 막는다** — 이 버블 몫만 잘라 내고, 잘라 낸 결과가 지난번과 같으면
 * 지난번 배열을 그대로 돌려준다. 컨텍스트가 안 바뀌니 카드 계산도 안 돈다.
 *
 * 얕은 비교로 충분하다. 항목들은 스토어에서 **교체**되지 제자리에서 고쳐지지 않기 때문이다
 * (§3.2 불변 갱신). 즉 내용이 달라졌다면 항목 신원도 달라져 있다.
 */
import { useRef } from 'react';

function sameItems(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * 둘 중 무엇을 쓸지 정한다 — **판단은 여기 순수 함수에 있고 훅은 기억만 한다.**
 * 클라이언트에는 훅을 렌더해 볼 도구(testing-library·jsdom)가 없으므로, 틀릴 수 있는 부분을
 * 훅 밖으로 내보내야 기존 인프라만으로 검증할 수 있다.
 *
 * `undefined` 는 "이 축은 아무도 요청하지 않았다"는 뜻이라 그대로 통과시킨다.
 */
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
