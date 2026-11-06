import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_CONFIG, LAB_RULES_BEGIN, LAB_RULES_END, estimateLabCostUsd, type AgentConfig } from '@vibisual/shared';
import { labResultStatus, mergeLabVariantConfig, sumLabTokens } from './labVariant.js';

const base: AgentConfig = { ...DEFAULT_AGENT_CONFIG, model: 'opus', tools: ['Read', 'Write'], rules: 'Keep tests green.' };
const block = (n: string) => `${LAB_RULES_BEGIN}\nvariant ${n}\n${LAB_RULES_END}`;

describe('§5.18 mergeLabVariantConfig — 기준 전량 + 변형 축만', () => {
  it('변형이 바꾼 축만 덮고 나머지(도구 등)는 기준 그대로 둔다', () => {
    const merged = mergeLabVariantConfig(base, { config: { model: 'sonnet', effort: 'high' } });
    expect(merged.model).toBe('sonnet');
    expect(merged.effort).toBe('high');
    expect(merged.tools).toEqual(['Read', 'Write']);
    expect(merged.permissionMode).toBe(base.permissionMode);
    expect(merged.rules).toBe('Keep tests green.');
  });

  it('maxTurns 0 도 값이다 — 비어 있을 때만 기준을 따른다', () => {
    expect(mergeLabVariantConfig(base, { config: { maxTurns: 0 } }).maxTurns).toBe(0);
    expect(mergeLabVariantConfig(base, { config: {} }).maxTurns).toBe(base.maxTurns);
  });

  it('랩 규칙 섹션은 교체되고 사람이 쓴 규칙은 남는다 — 다시 돌려도 쌓이지 않는다', () => {
    const once = mergeLabVariantConfig(base, { config: {} }, block('A'));
    const twice = mergeLabVariantConfig(once, { config: {} }, block('B'));
    expect(twice.rules).toContain('variant B');
    expect(twice.rules).not.toContain('variant A');
    expect(twice.rules).toContain('Keep tests green.');
    expect(twice.rules!.split(LAB_RULES_BEGIN)).toHaveLength(2);
  });
});

describe('§5.18 결과 판정 — 서버가 정한다', () => {
  it.each([
    [{ status: 'error' as const, result: 'boom' }, 'failed'],
    [{ status: 'completed' as const, result: '[Stopped by user] halted' }, 'stopped'],
    [{ status: 'completed' as const, result: 'All good.' }, 'success'],
    [{ status: 'completed' as const, result: undefined }, 'success'],
  ])('%o → %s', (last, want) => {
    expect(labResultStatus(last as never)).toBe(want);
  });

  it('토큰을 하나도 못 읽었으면 비워 둔다 — 0 은 "공짜로 끝났다" 는 거짓말', () => {
    expect(sumLabTokens([{}, {}])).toEqual({});
    expect(sumLabTokens([{ inputTokens: 10 }, { inputTokens: 5, outputTokens: 2 }])).toEqual({ inputTokens: 15, outputTokens: 2 });
  });

  it('토큰이나 단가가 없으면 비용도 비워 둔다', () => {
    expect(estimateLabCostUsd({})).toBeUndefined();
    expect(estimateLabCostUsd({ inputTokens: 1000, outputTokens: 1000 })).toBeUndefined();
    expect(estimateLabCostUsd({ inputTokens: 1_000_000, outputTokens: 0, pricing: { input: 3, output: 15 } })).toBeCloseTo(3);
  });
});
