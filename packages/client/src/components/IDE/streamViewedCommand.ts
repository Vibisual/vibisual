/**
 * §5.5 #17-12 — 하단 상태바(`StreamStatusBar`)가 가리키는 **지금 보고 있는 명령** 판정.
 *
 * 스트림은 가상 리스트(virtuoso)라 **뷰포트 밖 항목은 DOM 에 없다.** 종전 판정은 렌더된 명령
 * 블록(`[data-cmd-id]`)만 훑었는데, 응답이 긴 턴에서는 그 사이에 명령 블록이 **한 장도 렌더되지
 * 않는다**(선렌더 버퍼 위 1600px 밖). 그래서 위로 올려 내 프롬프트 말풍선을 지나쳐도 상태바는
 * 계속 최신 프롬프트를 가리키다가, 옛 말풍선이 화면 가까이 와서야 뒤늦게 바뀌었다
 * (사용자 지적 — "중간 정도까지 올라가야 바뀐다").
 *
 * 그래서 DOM 에는 **화면 맨 위를 채운 항목이 무엇인가**만 묻고, 그 항목이 속한 턴의 명령은
 * **항목 배열을 거슬러 올라가** 찾는다 — 명령 블록이 미렌더여도 정확히 나온다.
 * 두 함수 모두 DOM 을 모르는 순수 함수라 단위 테스트로 못박는다(클라 테스트에는 jsdom 이 없다).
 */

/** 상태바 판정의 상단 여백(px). 항목 래퍼가 컨테이너 상단에서 이 안쪽까지 내려와도 "지났다"로 본다. */
export const VIEWED_TOP_MARGIN = 24;

/**
 * 컨테이너 상단(+`margin`)을 지난 **마지막** 항목의 인덱스. 하나도 못 지났으면 `-1`
 * (= 리스트 맨 위라 첫 항목이 상단보다 아래에 있는 경우).
 *
 * DOM 순서 = 위→아래 시각 순서라 `topAt` 은 단조증가한다 → 이분 탐색으로 훑어
 * `getBoundingClientRect` 측정을 log₂N 회로 묶는다(스크롤마다 수백 항목을 재던 비용 제거).
 */
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

/**
 * 화면 맨 위를 채운 항목(`topItemId`)이 **속한 명령 항목**의 id.
 *
 * - 그 항목부터 거슬러 올라가 처음 만나는 명령 항목 = 지금 보고 있는 턴의 프롬프트.
 * - 앞에 명령이 하나도 없으면(첫 명령보다 위 = 세션 서두) **첫 명령**을 가리킨다 —
 *   맨 위로 올렸을 때 상태바가 비지 않게 하던 종전 폴백과 같은 뜻.
 * - `topItemId` 가 배열에 없으면(측정과 데이터가 어긋난 순간) `null` — 부르는 쪽이 종전 판정으로 폴백.
 */
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
 * §5.5 #17-12 ③-2 (a) — 상태바가 **실행 중 줄을 그리는 동안**은 스크롤을 따라가지 않는다.
 *
 * 종전에는 실행 중에도 추종이 돌아, 명령을 내려 두고 위로 올려 앞 턴을 읽는 순간 상태바가
 * 그 옛 턴의 `완료 / 옛 프롬프트` 로 바뀌었다 — 지금 돌고 있는 일이 화면에서 사라진 것처럼 보였다
 * (사용자 지적 — "실행 중일 때는 스크롤을 올려도 바뀌지 않게, 기존 동작은 실행이 끝났을 때").
 *
 * 조건은 그 줄이 스피너를 돌리는 조건 그대로다(`StreamStatusBar` 의 `isExecuting`): 세션이 실제로 돌고,
 * 기본 대상이 `executing` 이거나 진짜 실행 중 명령 없이 세션만 도는 되살아난 턴. 끝나면 거짓이 되어
 * 종전 추종(③-2)이 돌아온다.
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
