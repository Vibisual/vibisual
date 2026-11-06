/**
 * §5.5 #17-17 ㉓ — 끝낸 단계(`done`, 자기 신고)와 확인된 단계를 가른다(순수).
 * 확인됨 = 같은 세션 탭에 그 단계의 마지막 변경 **뒤에** 끝난 검증(#17-35)이 `pass` 이고 종료 코드 0 인 시도가 하나 이상이다.
 * 퍼센트·주입 규약에는 쓰지 않는다 — 표시 전용.
 */
import type { SessionGoalStep, VerificationRun } from './types.js';

export interface GoalStepVerification {
  /** 그 검증이 판정된 시각. */
  at: number;
  verificationId: string;
}

/** 서버가 판정한 통과 + 실행 증거(종료 코드 0)가 있는 검증인가. 말만 있는 통과는 세지 않는다. */
export function isPassingVerification(run: Pick<VerificationRun, 'status' | 'verdict' | 'attempts'>): boolean {
  return run.status === 'done' && run.verdict === 'pass' && run.attempts.some((a) => a.exitCode === 0);
}

/** 이 단계를 확인해 준 검증 — 그 단계가 끝난 뒤 가장 먼저 통과한 것. 없으면 null. */
export function goalStepVerification(
  step: Pick<SessionGoalStep, 'status' | 'updatedAt'>,
  runs: readonly Pick<VerificationRun, 'id' | 'status' | 'verdict' | 'attempts' | 'finishedAt'>[] | undefined,
): GoalStepVerification | null {
  if (step.status !== 'done' || !runs || runs.length === 0) return null;
  let best: GoalStepVerification | null = null;
  for (const run of runs) {
    if (run.finishedAt === undefined || run.finishedAt < step.updatedAt) continue;
    if (!isPassingVerification(run)) continue;
    if (!best || run.finishedAt < best.at) best = { at: run.finishedAt, verificationId: run.id };
  }
  return best;
}
