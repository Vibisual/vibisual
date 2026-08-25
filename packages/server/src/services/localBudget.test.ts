/**
 * §5.19 (D) 로컬 한 턴의 토큰 예산 — 생각이 답을 잡아먹지 않게.
 *
 * 회귀 방지 대상 — 2026-08-21 실측. 답 상한이 4,096 고정이던 시절, Qwen3.8-27B 에 debounce
 * 구현을 시키자 **16,950자를 생각하다 예산을 다 쓰고 빈 답**으로 끝났다. 상한을 12,288 로
 * 늘렸더니 이번엔 48,352자를 생각하며 5분 19초를 쓰고 역시 빈 답이었다 — 예산을 키우는 것은
 * 답이 아니었다. 엔진의 `--reasoning-budget` 로 **생각 쪽을 끊자** 같은 과제가
 * `finish_reason=stop` 과 함께 1,931자짜리 정상 구현으로 돌아왔다.
 *
 * 그래서 조건은 셋 — **답 예산은 문맥을 따라 늘 것**, **생각 몫은 답 몫보다 작을 것**
 * (생각이 전부를 가져가면 애초 사고가 재발한다), **아주 작은 문맥에서도 바닥은 있을 것**.
 */
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
