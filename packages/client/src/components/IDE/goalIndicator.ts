import type { SessionGoal } from '@vibisual/shared';

/** §5.5 #17-17 ⑩ — 목표 아이콘 상태(순수 — 점등 규칙이 뒤집히기 쉬워서). `active` 만으로 켜지 마라 — 자동 생성 카드의 빈 `0%`·안 닫힌 끝난 목표(`5/5`)에도 켜진다. */
export interface GoalIndicator {
  /** 아이콘에 불을 켤지 — "보여줄 내용이 들어왔다" 이고 "아직 끝나지 않았다" 일 때만 true. */
  lit: boolean;
  /** 아이콘 아래 한 줄(`완료/전체` 또는 퍼센트). 켜지지 않았으면 null — 빈 `0%` 도 띄우지 않는다. */
  meter: string | null;
  /** 지금 그 목표를 향해 도는 중 — 글리프만 반짝인다(켜진 상태에서만). */
  blink: boolean;
  /** 단계 진행(툴팁 조립용). 단계가 없으면 null. */
  steps: { done: number; total: number } | null;
}

/**
 * @param goal    지금 열려 있는 세션 탭의 목표(없을 수 있다)
 * @param working 그 세션 탭(sub)이 실제로 실행 중인가
 */
export function computeGoalIndicator(goal: SessionGoal | undefined, working: boolean): GoalIndicator {
  const none: GoalIndicator = { lit: false, meter: null, blink: false, steps: null };
  if (!goal || goal.status !== 'active') return none;

  const total = goal.steps.length;
  const done = goal.steps.filter((s) => s.status === 'done').length;

  // 내용의 기준은 셋 중 하나 — 목록이 들어왔다 / 진행이 실제로 신고됐다 / 사용자가 직접 쓴 목표다.
  // 자동 생성된 빈 카드(단계 0 · 0% · 세션이 쓴 문장)는 아직 "보여줄 것"이 아니다.
  const hasContent = total > 0 || goal.percent > 0 || goal.authoredBy === 'user';
  if (!hasContent) return none;

  // ⑩ 3차 정정 — **남은 일이 없고 그 세션도 멈췄으면** 달성과 같은 조용함으로 되돌린다.
  //   단계가 있으면 단계가 전부이므로(③) 완수 판정도 단계를 먼저 본다.
  //   도는 중이면 `5/5` 여도 켜 둔다 — 세션은 목록을 더 붙일 수 있고, 그때의 불은 참이다.
  const finished = total > 0 ? done === total : goal.percent >= 100;
  if (finished && !working) return none;

  return {
    lit: true,
    // ③ "단계가 있으면 단계가 전부다" — 화면 표기도 같은 우선순위를 따른다.
    meter: total > 0 ? `${done}/${total}` : `${goal.percent}%`,
    blink: working,
    steps: total > 0 ? { done, total } : null,
  };
}
