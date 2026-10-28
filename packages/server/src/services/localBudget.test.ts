/** §5.19 (D) — 생각이 답을 잡아먹지 않는 예산. 2026-08-21 실측: 상한만 키우면 빈 답, `--reasoning-budget` 로 생각을 끊어야 답이 왔다. 답 예산은 문맥을 따르고 · 생각 < 답 · 바닥이 있다. */
import { describe, it, expect } from 'vitest';
import {
  localAnswerBudget,
  localThinkingBudget,
  LOCAL_DEFAULT_CONTEXT_SIZE,
  LOCAL_ANSWER_BUDGET_MIN,
} from '@vibisual/shared';

/** 사고를 부른 옛 고정값. 이 값으로 되돌아가면 그 사고도 함께 돌아온다. */
const OLD_FLAT_CAP = 4096;

describe('localAnswerBudget — 답 예산은 문맥의 몫이다', () => {
  it('기본 문맥에서는 옛 고정 상한보다 넉넉하다', () => {
    const budget = localAnswerBudget(LOCAL_DEFAULT_CONTEXT_SIZE);
    expect(budget).toBeGreaterThan(OLD_FLAT_CAP);
    expect(budget).toBeLessThan(LOCAL_DEFAULT_CONTEXT_SIZE); // 문맥을 통째로 쓰지는 않는다
  });

  it('문맥을 늘리면 답 길이도 함께 늘어난다', () => {
    expect(localAnswerBudget(32768)).toBeGreaterThan(localAnswerBudget(16384));
  });

  it('문맥을 모르면(0 이하) 기본 문맥으로 친다', () => {
    expect(localAnswerBudget(0)).toBe(localAnswerBudget(LOCAL_DEFAULT_CONTEXT_SIZE));
    expect(localAnswerBudget(-1)).toBe(localAnswerBudget(LOCAL_DEFAULT_CONTEXT_SIZE));
  });

  it('아주 작은 문맥에서도 바닥은 있다 — 답이 통째로 잘리지 않게', () => {
    expect(localAnswerBudget(512)).toBe(LOCAL_ANSWER_BUDGET_MIN);
  });
});

describe('localThinkingBudget — 생각 몫은 답 몫보다 작다', () => {
  it('생각이 답 예산 전부를 가져가지 않는다 — 이걸 어기면 빈 답이 돌아온다', () => {
    for (const ctx of [8192, 16384, 32768, 65536]) {
      expect(localThinkingBudget(ctx)).toBeLessThan(localAnswerBudget(ctx));
    }
  });

  it('문맥을 늘리면 생각 몫도 함께 늘어난다', () => {
    expect(localThinkingBudget(32768)).toBeGreaterThan(localThinkingBudget(16384));
  });

  it('문맥을 모르면 기본 문맥으로 치고, 아주 작아도 바닥은 있다', () => {
    expect(localThinkingBudget(0)).toBe(localThinkingBudget(LOCAL_DEFAULT_CONTEXT_SIZE));
    expect(localThinkingBudget(512)).toBe(LOCAL_ANSWER_BUDGET_MIN);
  });
});
