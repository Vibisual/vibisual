/**
 * §5.3 #10-3 v4.98 — 검증 런 지표 (순수 함수 — React·DOM 의존 0).
 *
 * "인간 개입이 줄었다"를 느낌이 아니라 숫자로 확인하기 위한 계산부.
 * 판정 자체는 서버가 하고, 여기서는 서버가 내려준 런을 **세기만** 한다.
 */

import type { AutoAgentRun, EscalationReason } from '@vibisual/shared';

export interface RunMetrics {
  /** 자가진단을 뺀 실제 작업 런 수 */
  total: number;
  /** 증거와 함께 통과한 런 수 */
  verified: number;
  /** 사람을 부른 런 수 */
  escalated: number;
  /** 아직 도는 런 수 */
  running: number;
  /** 무개입 완료율 (0~100). 닫힌 런이 없으면 null — 0% 로 표시하면 거짓말이 된다. */
  handsOffRate: number | null;
  /** 에스컬레이션 사유 분포 */
  escalationByReason: Record<EscalationReason, number>;
  /** 재작업 회차 분포 (회차 → 그 회차를 쓴 런 수) */
  reworkHistogram: Record<number, number>;
  /** 통과 증거 총 건수 */
  passedAttempts: number;
  /** 실패 증거 총 건수 */
  failedAttempts: number;
}

const EMPTY_REASONS: Record<EscalationReason, number> = {
  'budget-exhausted': 0,
  'verification-failed': 0,
  'irreversible-action': 0,
  'no-evidence': 0,
};

/** 자가진단 런은 지표에서 뺀다 — 일부러 실패시킨 것이라 성적에 섞이면 안 된다. */
export function realRuns(runs: AutoAgentRun[]): AutoAgentRun[] {
  return runs.filter((r) => !r.selfTest);
}

export function computeRunMetrics(runs: AutoAgentRun[]): RunMetrics {
  const real = realRuns(runs);
  const escalationByReason: Record<EscalationReason, number> = { ...EMPTY_REASONS };
  const reworkHistogram: Record<number, number> = {};
  let verified = 0;
  let escalated = 0;
  let running = 0;
  let passedAttempts = 0;
  let failedAttempts = 0;

  for (const run of real) {
    if (run.status === 'verified') verified++;
    else if (run.status === 'escalated') escalated++;
    else if (run.status === 'running') running++;

    if (run.status === 'escalated' && run.escalation) {
      escalationByReason[run.escalation] = (escalationByReason[run.escalation] ?? 0) + 1;
    }
    reworkHistogram[run.reworkUsed] = (reworkHistogram[run.reworkUsed] ?? 0) + 1;

    for (const attempt of run.attempts) {
      if (attempt.ok) passedAttempts++;
      else failedAttempts++;
    }
  }

  const closed = verified + escalated;
  return {
    total: real.length,
    verified,
    escalated,
    running,
    handsOffRate: closed === 0 ? null : Math.round((verified / closed) * 100),
    escalationByReason,
    reworkHistogram,
    passedAttempts,
    failedAttempts,
  };
}

/**
 * 이 런을 화면에서 어떤 색으로 그릴지.
 * `running` 은 파랑, `verified` 는 초록, 나머지는 호박/빨강 — **증거 없는 초록은 없다.**
 */
export function runTone(run: AutoAgentRun): 'running' | 'verified' | 'escalated' | 'abandoned' {
  return run.status;
}

/** 그 런이 통과 증거를 하나라도 갖고 있는가 (초록 배지의 유일한 근거) */
export function hasPassingEvidence(run: AutoAgentRun): boolean {
  return run.attempts.some((a) => a.ok);
}

/** 자가진단 결과 요약 — 전부 통과해야 게이트를 믿을 수 있다. */
export interface SelfTestCheck {
  id: string;
  expected: string;
  actual: string;
  pass: boolean;
}

export function summarizeSelfTest(checks: SelfTestCheck[]): { passed: number; failed: number; allPassed: boolean } {
  const passed = checks.filter((c) => c.pass).length;
  return { passed, failed: checks.length - passed, allPassed: checks.length > 0 && passed === checks.length };
}
