import type { SessionGoal } from '@vibisual/shared';

/**
 * §5.5 #17-17 ⑩ — 활동바 목표 아이콘의 표시 상태.
 *
 * 판정을 컴포넌트 밖 순수 함수로 두는 이유: **"언제 불을 켜는가"가 세 번 뒤집힌 규칙**이기 때문이다.
 * v4.61 은 목표가 `active` 이기만 하면 켰고, ⑨(b) 로 목표 카드가 명령마다 자동 생성되기 시작하자
 * 그 판정이 **아직 아무 목록도 안 들어온 `0%` 에서도 불을 켜** 사용자가 눌러 보고 빈 화면을 만났다(v4.73).
 * 반대쪽 끝도 같은 병이었다 — 목표를 `achieved` 로 닫는 것은 사용자의 몫이라 세션이 다 끝내고 꺼져도
 * `status` 는 `active` 로 남아, **이미 끝난 목표가 `5/5` 를 띄운 채 며칠씩 켜져 있었다**(⑩ 3차 정정).
 * 활동바의 불은 "여기 지금 볼 게 있다"는 약속이라, 한 번 거짓이 되면 그 뒤로 아무도 믿지 않는다.
 */
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
