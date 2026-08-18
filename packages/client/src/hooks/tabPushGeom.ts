// §5.4 #14 / §6 "TabBar 드래그 = 탭 순서 변경" — 탭을 끌 때 옆 탭이 **밀려나는** 거동의 순수 기하.
//
// 프로젝트 탭(`TabBar`)과 IDE 세션 탭(`IDETabBar`)이 같은 손맛을 써야 하므로(DRY) 판정·수치를 한 곳에
// 모은다. 이 파일은 DOM 을 만지지 않는다 — 좌표와 순서만 받아 "어느 탭이 몇 px 밀렸고, 얼마 동안,
// 얼마나 늦게 제자리에 앉는가"만 답한다(`floatingWindowGeom` 선례). 실제 style 적용은
// `useTabPushAnimation` 이 한다.

/** 밀어내기 손맛의 모든 수치 — 값 조정은 여기 한 곳(매직넘버 산개 ❌). */
export const TAB_PUSH = {
  /**
   * 밀려난 이웃이 제자리에 앉기까지. 살짝 넘겼다 되돌아오는 곡선이라 "떠밀렸다"가 눈에 읽힌다.
   *
   * ⚠ 처음 값(260ms · 오버슈트 1.28)은 **밀렸다는 것이 거의 안 보였다** — 탭이 그냥 새 자리에
   * 나타난 것처럼 읽혀 "밀어내기가 없어진 것 아니냐"는 신고로 돌아왔다. 눈이 궤적을 따라가려면
   * 두 가지가 같이 필요하다: 되돌아오는 **시간**이 충분할 것, 그리고 제자리를 **분명히 지나쳤다가**
   * 앉을 것. 그래서 시간을 늘리고 오버슈트를 키웠다(무게가 실린 상자를 민 느낌).
   */
  settleDurationMs: 340,
  settleEasing: 'cubic-bezier(0.16, 1.52, 0.34, 1)',
  /**
   * 끌고 있는 탭 자신은 손을 바로 따라와야 하므로 짧고 튕김 없이 앉는다.
   * 이웃보다 **빨라야** 한다 — 손이 먼저 도착하고 밀린 쪽이 뒤따라 앉아야 "내가 밀었다"로 읽힌다.
   */
  leadDurationMs: 190,
  leadEasing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  /**
   * 손에서 먼 탭일수록 조금씩 늦게 출발 — 한 줄이 차례로 밀리는 연쇄가 보인다.
   * 간격이 너무 촘촘하면 전부 동시에 움직여 연쇄가 안 읽히므로, 한 칸당 간격과 상한을 함께 키웠다.
   */
  staggerMs: 28,
  maxStaggerMs: 96,
  /** 이보다 작은 이동은 재생하지 않는다(눈에 안 보이는데 리플로우만 든다). */
  minShiftPx: 0.5,
  /** transition 이 끝난 뒤 인라인 스타일을 걷을 때의 여유. */
  cleanupSlackMs: 60,
} as const;

/** 한 탭을 어떻게 되돌려 앉힐지 — `useTabPushAnimation` 이 그대로 style 로 옮긴다. */
export interface TabPushStep {
  key: string;
  /** 되돌리기 시작점(FLIP invert). 양수면 오른쪽에서, 음수면 왼쪽에서 밀려 들어온다. */
  shiftPx: number;
  durationMs: number;
  easing: string;
  delayMs: number;
}

export interface TabPushPlanInput {
  /** 재정렬 **직전** 각 탭의 레이아웃 x(스크롤과 무관한 `offsetLeft`). */
  previous: ReadonlyMap<string, number>;
  /** 재정렬 **직후** 각 탭의 레이아웃 x. */
  next: ReadonlyMap<string, number>;
  /** 아직 달리고 있는 애니메이션의 현재 이동량 — 이어 붙여야 중간에 끊기지 않는다. */
  carry?: ReadonlyMap<string, number>;
  /** 지금 끌고 있는 탭. 없으면(탭이 닫혀 옆이 메워질 때 등) 전부 이웃으로 본다. */
  leadKey?: string | null;
  /** 새 순서 — 손에서 얼마나 떨어졌는지(스태거)를 잰다. */
  order: readonly string[];
}

/**
 * FLIP — 옛 좌표와 새 좌표의 차이를 "밀려난 거리"로 환산한다.
 * 새로 붙은 탭(옛 좌표 없음)은 밀려난 것이 아니므로 대상에서 빠진다.
 */
export function planTabPush(input: TabPushPlanInput): TabPushStep[] {
  const { previous, next, carry, leadKey = null, order } = input;
  const leadIndex = leadKey === null ? -1 : order.indexOf(leadKey);
  const steps: TabPushStep[] = [];

  for (const [key, nextLeft] of next) {
    const prevLeft = previous.get(key);
    if (prevLeft === undefined) continue;
    const shift = prevLeft - nextLeft + (carry?.get(key) ?? 0);
    if (Math.abs(shift) < TAB_PUSH.minShiftPx) continue;

    const isLead = key === leadKey;
    const index = order.indexOf(key);
    const distance = leadIndex < 0 || index < 0 ? 0 : Math.abs(index - leadIndex);
    steps.push({
      key,
      shiftPx: shift,
      durationMs: isLead ? TAB_PUSH.leadDurationMs : TAB_PUSH.settleDurationMs,
      easing: isLead ? TAB_PUSH.leadEasing : TAB_PUSH.settleEasing,
      // 바로 옆(거리 1)은 곧장, 그 너머는 한 칸당 staggerMs 씩 늦게 — 연쇄로 읽히게.
      delayMs: isLead ? 0 : Math.min(TAB_PUSH.maxStaggerMs, Math.max(0, distance - 1) * TAB_PUSH.staggerMs),
    });
  }
  return steps;
}

export interface TabReorderInput {
  /** 지금 순서(숨은 탭 포함 전체 — 키로 다루므로 숨은 탭이 사이에 껴 있어도 안전하다). */
  order: readonly string[];
  /** 끌고 있는 탭. */
  movedKey: string;
  /** 커서가 올라가 있는 탭. */
  targetKey: string;
  /** 커서 x(뷰포트 기준). */
  pointerX: number;
  /** 대상 탭의 뷰포트 기준 좌측 x 와 폭. */
  targetLeft: number;
  targetWidth: number;
}

/**
 * 자리를 **언제** 바꿀지 — 커서가 대상 탭의 중앙선을 **넘어섰을 때만** 바꾼다.
 *
 * 넘기 전에 바꾸면 자리가 바뀌자마자 커서가 다시 반대편 탭 위에 놓여 두 탭이 매 프레임 자리를
 * 맞바꾸는 떨림(oscillation)이 생긴다. 중앙선 규칙은 그 되돌이를 구조적으로 막는다.
 */
export function crossedTabMidpoint(input: {
  pointerX: number;
  targetLeft: number;
  targetWidth: number;
  movingRight: boolean;
}): boolean {
  const mid = input.targetLeft + input.targetWidth / 2;
  return input.movingRight ? input.pointerX >= mid : input.pointerX <= mid;
}

/**
 * 끌고 있는 탭을 대상 탭 자리로 옮긴 새 순서. 오른쪽으로 끌면 대상 **뒤**, 왼쪽으로 끌면 대상 **앞**.
 */
export function moveKeyToward(order: readonly string[], movedKey: string, targetKey: string): string[] {
  const from = order.indexOf(movedKey);
  const to = order.indexOf(targetKey);
  if (from < 0 || to < 0 || from === to) return [...order];
  const next = [...order];
  next.splice(from, 1);
  const anchor = next.indexOf(targetKey);
  next.splice(from < to ? anchor + 1 : anchor, 0, movedKey);
  return next;
}

/**
 * 드래그 중 새 순서를 낸다 — 아직 중앙선을 안 넘었거나 바뀔 게 없으면 `null`(그대로 두라는 뜻).
 */
export function resolveTabReorder(input: TabReorderInput): string[] | null {
  const { order, movedKey, targetKey } = input;
  if (movedKey === targetKey) return null;
  const from = order.indexOf(movedKey);
  const to = order.indexOf(targetKey);
  if (from < 0 || to < 0) return null;
  const crossed = crossedTabMidpoint({
    pointerX: input.pointerX,
    targetLeft: input.targetLeft,
    targetWidth: input.targetWidth,
    movingRight: from < to,
  });
  if (!crossed) return null;
  return moveKeyToward(order, movedKey, targetKey);
}

/** 두 순서가 같은가(길이·자리 모두). */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, i) => key === b[i]);
}

/** 두 순서가 같은 식구를 담고 있는가(자리는 달라도 됨). */
export function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((key) => set.has(key));
}

/**
 * 서버가 준 목록에 **드래그 중인 로컬 순서**를 덧씌운다 — 커밋 왕복 동안 화면이 되돌아가지 않게.
 * 순서에 없는 항목(드래그 중에 새로 생긴 탭)은 뒤에 원래 상대 순서대로 붙는다.
 */
export function applyLocalOrder<T>(items: readonly T[], order: readonly string[], keyOf: (item: T) => string): T[] {
  const rank = new Map(order.map((key, i) => [key, i]));
  const known = items
    .filter((item) => rank.has(keyOf(item)))
    .sort((a, b) => (rank.get(keyOf(a)) ?? 0) - (rank.get(keyOf(b)) ?? 0));
  const unknown = items.filter((item) => !rank.has(keyOf(item)));
  return [...known, ...unknown];
}
