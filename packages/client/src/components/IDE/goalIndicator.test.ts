import { describe, it, expect } from 'vitest';
import type { SessionGoal, SessionGoalStepStatus } from '@vibisual/shared';
import { computeGoalIndicator } from './goalIndicator.js';

/**
 * §5.5 #17-17 ⑩ v4.73 — 활동바 목표 아이콘 점등 규칙 회귀.
 *
 * 두 번 뒤집힌 규칙이라 여기서 고정한다: **불은 "목표가 있다"가 아니라 "보여줄 내용이 들어왔다"에
 * 켜진다.** 명령마다 목표 카드가 자동 생성되므로(⑨ b), 카드 존재로 켜면 빈 `0%` 에도 불이 켜져
 * 사용자가 눌러 보고 빈 화면을 만난다.
 */

function goal(over: Partial<SessionGoal> = {}): SessionGoal {
  const steps = (over.steps ?? []).map((s, i) => ({
    id: `gs-${i}`,
    text: s.text,
    status: s.status as SessionGoalStepStatus,
    updatedAt: 0,
  }));
  return {
    agentId: 'agent-1',
    subAgentId: 'sub-1',
    text: '목표 한 문장',
    authoredBy: 'session',
    steps,
    percent: 0,
    status: 'active',
    history: [],
    revision: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
    ...(over.steps ? { steps } : {}),
  };
}

describe('computeGoalIndicator — 활동바 목표 아이콘', () => {
  it('목표가 없으면 꺼져 있다', () => {
    expect(computeGoalIndicator(undefined, false)).toEqual({ lit: false, meter: null, blink: false, steps: null });
  });

  it('명령으로 자동 생성만 된 빈 카드는 켜지 않는다(0% 도 안 띄운다)', () => {
    // ⑨(b) 로 명령마다 태어나는 그 카드 — 아직 아무 목록도 안 들어왔다.
    const ind = computeGoalIndicator(goal(), true);
    expect(ind.lit).toBe(false);
    expect(ind.meter).toBeNull();
    expect(ind.blink).toBe(false); // 세션이 돌고 있어도 켜지지 않은 아이콘은 반짝이지 않는다
  });

  it('목록이 들어오면 켜지고 `완료/전체` 를 띄운다', () => {
    const ind = computeGoalIndicator(goal({
      steps: [
        { id: 'x', text: 'A', status: 'done', updatedAt: 0 },
        { id: 'y', text: 'B', status: 'in_progress', updatedAt: 0 },
        { id: 'z', text: 'C', status: 'pending', updatedAt: 0 },
      ],
      percent: 33,
    }), false);
    expect(ind.lit).toBe(true);
    expect(ind.meter).toBe('1/3');
    expect(ind.steps).toEqual({ done: 1, total: 3 });
  });

  it('단계가 없어도 진행이 신고됐으면 켜고 퍼센트를 띄운다', () => {
    const ind = computeGoalIndicator(goal({ percent: 40 }), false);
    expect(ind.lit).toBe(true);
    expect(ind.meter).toBe('40%');
    expect(ind.steps).toBeNull();
  });

  it('사용자가 직접 쓴 목표는 0% 여도 켠다(사용자가 넣은 내용이다)', () => {
    const ind = computeGoalIndicator(goal({ authoredBy: 'user' }), false);
    expect(ind.lit).toBe(true);
    expect(ind.meter).toBe('0%');
  });

  it('달성·중단은 내용이 있어도 조용하다', () => {
    const steps = [{ id: 'x', text: 'A', status: 'done' as SessionGoalStepStatus, updatedAt: 0 }];
    expect(computeGoalIndicator(goal({ steps, percent: 100, status: 'achieved' }), false).lit).toBe(false);
    expect(computeGoalIndicator(goal({ steps, percent: 100, status: 'abandoned' }), false).lit).toBe(false);
  });

  it('켜진 상태에서 세션이 돌고 있을 때만 반짝인다', () => {
    const steps = [{ id: 'x', text: 'A', status: 'pending' as SessionGoalStepStatus, updatedAt: 0 }];
    expect(computeGoalIndicator(goal({ steps }), true).blink).toBe(true);
    expect(computeGoalIndicator(goal({ steps }), false).blink).toBe(false);
  });
});
