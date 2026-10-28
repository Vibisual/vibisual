/**
 * §5.5 #17-12 — 하단 상태바가 가리키는 지금 보고 있는 명령. 렌더된 명령 블록만 훑으면 긴 턴에선 DOM 에 한 장도 없어(선렌더 1600px 밖) 늦게 바뀐다.
 * DOM 에는 화면 맨 위 항목만 묻고 그 턴의 명령은 항목 배열을 거슬러 찾는다(순수 — 클라 테스트엔 jsdom 이 없다).
 */

/** 상태바 판정의 상단 여백(px). 항목 래퍼가 컨테이너 상단에서 이 안쪽까지 내려와도 "지났다"로 본다. */
export const VIEWED_TOP_MARGIN = 24;

/** 컨테이너 상단(+`margin`)을 지난 마지막 항목의 인덱스(없으면 `-1`). `topAt` 이 단조증가라 이분 탐색으로 측정을 log₂N 회로 줄인다. */
export function lastPassedIndex(count: number, topAt: (index: number) => number, margin: number): number {
  let lo = 0;
  let hi = count - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (topAt(mid) <= margin) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** 화면 맨 위 항목이 속한 명령 id(거슬러 처음 만나는 명령). 앞에 명령이 없으면 첫 명령, `topItemId` 가 배열에 없으면 `null`(부르는 쪽이 폴백). */
export function owningCommandId<T extends { id: string }>(
  items: readonly T[],
  isCommand: (item: T) => boolean,
  topItemId: string | null,
): string | null {
  if (topItemId === null) return null;
  const idx = items.findIndex((it) => it.id === topItemId);
  if (idx < 0) return null;
  for (let k = idx; k >= 0; k--) {
    const it = items[k]!;
    if (isCommand(it)) return it.id;
  }
  for (const it of items) {
    if (isCommand(it)) return it.id;
  }
  return null;
}

/**
 * §5.5 #17-12 ③-2 (a) — 상태바가 실행 중 줄을 그리는 동안은 스크롤을 따라가지 않는다(앞 턴을 읽어도 도는 일이 사라지지 않게).
 * 조건은 `StreamStatusBar` 의 `isExecuting`(스피너 조건) 그대로다.
 */
export function statusBarPinsToRunning(input: {
  /** 기본 대상(실행 중 > 최신 완료/오류)의 상태. 대상이 없으면 `null`. */
  defaultStatus: string | null;
  /** 세션이 실제로 도는가(공유 생존 술어). */
  sessionRunning: boolean;
  /** 이 세션 원본 큐에 진짜 `executing` 명령이 있는가(표시용 사본의 승격과 무관). */
  hasRealExecuting: boolean;
}): boolean {
  if (input.defaultStatus === null || !input.sessionRunning) return false;
  return input.defaultStatus === 'executing' || !input.hasRealExecuting;
}
