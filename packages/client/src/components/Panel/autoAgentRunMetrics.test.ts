/**
 * §5.3 #10-3 v4.98 — 검증 런 지표 단위 테스트.
 *
 * 이 테스트가 지키는 것은 한 문장이다 — **증거 없는 초록은 없다.**
 */

import { describe, it, expect } from 'vitest';
import type { AutoAgentRun, VerificationAttempt } from '@vibisual/shared';
import { computeRunMetrics, hasPassingEvidence, realRuns, summarizeSelfTest } from './autoAgentRunMetrics.js';

function attempt(exitCode: number, over: Partial<VerificationAttempt> = {}): VerificationAttempt {
  return {
    id: `att-${Math.random().toString(36).slice(2)}`,
    kind: 'test',
    command: 'pnpm test',
    exitCode,
    startedAt: 1_700_000_000_000,
    ok: exitCode === 0,
    ...over,
  };
}

function run(over: Partial<AutoAgentRun> = {}): AutoAgentRun {
  return {
    runId: `run-${Math.random().toString(36).slice(2)}`,
    autoAgentId: 'auto-1',
    userRequest: 'do the thing',
    acceptanceCriteria: [],
    attempts: [],
    reworkUsed: 0,
    reworkBudget: 3,
    status: 'running',
    startedAt: 1_700_000_000_000,
    ...over,
  };
}

describe('computeRunMetrics', () => {
  it('닫힌 런이 없으면 무개입 완료율은 null 이다 (0% 로 쓰면 거짓말)', () => {
    const m = computeRunMetrics([run(), run()]);
    expect(m.total).toBe(2);
    expect(m.running).toBe(2);
    expect(m.handsOffRate).toBeNull();
  });

  it('무개입 완료율은 닫힌 런 기준이며 진행 중인 런은 분모에 들어가지 않는다', () => {
    const m = computeRunMetrics([
      run({ status: 'verified', attempts: [attempt(0)] }),
      run({ status: 'escalated', escalation: 'budget-exhausted' }),
      run({ status: 'running' }),
    ]);
    expect(m.verified).toBe(1);
    expect(m.escalated).toBe(1);
    expect(m.handsOffRate).toBe(50);
  });

  it('자가진단 런은 성적에서 제외된다 — 일부러 실패시킨 것이라 섞이면 안 된다', () => {
    const runs = [
      run({ status: 'verified', attempts: [attempt(0)] }),
      run({ status: 'escalated', escalation: 'no-evidence', selfTest: true, attempts: [attempt(1)] }),
    ];
    expect(realRuns(runs)).toHaveLength(1);
    const m = computeRunMetrics(runs);
    expect(m.total).toBe(1);
    expect(m.escalated).toBe(0);
    expect(m.handsOffRate).toBe(100);
    expect(m.failedAttempts).toBe(0);
  });

  it('에스컬레이션 사유와 재작업 회차를 분포로 센다', () => {
    const m = computeRunMetrics([
      run({ status: 'escalated', escalation: 'budget-exhausted', reworkUsed: 3 }),
      run({ status: 'escalated', escalation: 'budget-exhausted', reworkUsed: 3 }),
      run({ status: 'escalated', escalation: 'no-evidence', reworkUsed: 0 }),
    ]);
    expect(m.escalationByReason['budget-exhausted']).toBe(2);
    expect(m.escalationByReason['no-evidence']).toBe(1);
    expect(m.reworkHistogram[3]).toBe(2);
    expect(m.reworkHistogram[0]).toBe(1);
  });

  it('증거를 통과/실패로 나눠 센다', () => {
    const m = computeRunMetrics([run({ attempts: [attempt(0), attempt(1), attempt(0)] })]);
    expect(m.passedAttempts).toBe(2);
    expect(m.failedAttempts).toBe(1);
  });
});

describe('hasPassingEvidence', () => {
  it('실패 증거만 있으면 통과 증거가 아니다', () => {
    expect(hasPassingEvidence(run({ attempts: [attempt(1), attempt(2)] }))).toBe(false);
  });

  it('증거가 아예 없으면 통과 증거가 아니다', () => {
    expect(hasPassingEvidence(run())).toBe(false);
  });

  it('exitCode 0 이 하나라도 있으면 통과 증거다', () => {
    expect(hasPassingEvidence(run({ attempts: [attempt(1), attempt(0)] }))).toBe(true);
  });
});

describe('summarizeSelfTest', () => {
  it('하나라도 실패하면 게이트를 믿을 수 없다', () => {
    const s = summarizeSelfTest([
      { id: 'a', expected: 'held', actual: 'held', pass: true },
      { id: 'b', expected: 'escalated', actual: 'verified', pass: false },
    ]);
    expect(s.passed).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.allPassed).toBe(false);
  });

  it('점검 항목이 0개면 통과로 치지 않는다', () => {
    expect(summarizeSelfTest([]).allPassed).toBe(false);
  });
});
