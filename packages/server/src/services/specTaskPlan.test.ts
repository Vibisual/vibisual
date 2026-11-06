import { describe, expect, it } from 'vitest';
import { SPEC_RULES_BEGIN, SPEC_RULES_END, buildSpecTaskRules } from '@vibisual/shared';
import { planSpecTasks, specChainLinks, withSpecRules, type SpecPlanStep } from './specTaskPlan.js';

const items = (...cards: (string | undefined)[]) => cards.map((taskAgentId, i) => ({ id: `i${i + 1}`, ...(taskAgentId ? { taskAgentId } : {}) }));
const alive = (...ids: string[]) => (id: string) => ids.includes(id);
/** Pretend every create succeeds with agent `new-<itemId>`. */
const resolve = (step: SpecPlanStep) => (step.kind === 'create' ? `new-${step.itemId}` : step.agentId);

describe('§5.15 planSpecTasks — 작업 카드 만들기 판정', () => {
  it('카드가 없으면 전부 만들고 항목 순서대로 사슬을 잇는다', () => {
    const plan = planSpecTasks(items(undefined, undefined, undefined), { wanted: null, regenerate: false, agentExists: alive() });
    expect(plan.steps.map((s) => s.kind)).toEqual(['create', 'create', 'create']);
    expect(specChainLinks(plan.steps, resolve)).toEqual([
      { source: 'new-i1', target: 'new-i2' },
      { source: 'new-i2', target: 'new-i3' },
    ]);
  });

  it('살아 있는 카드는 건너뛰고, 가운데에 새로 생긴 카드는 앞뒤 둘 다와 잇는다', () => {
    const plan = planSpecTasks(items('a1', undefined, 'a3'), { wanted: null, regenerate: false, agentExists: alive('a1', 'a3') });
    expect(plan.steps).toEqual([
      { kind: 'keep', itemId: 'i1', agentId: 'a1' },
      { kind: 'create', itemId: 'i2', index: 1 },
      { kind: 'keep', itemId: 'i3', agentId: 'a3' },
    ]);
    expect(specChainLinks(plan.steps, resolve)).toEqual([
      { source: 'a1', target: 'new-i2' },
      { source: 'new-i2', target: 'a3' },
    ]);
  });

  it('카드 버블을 지운 항목은 연결을 끊고 다시 만든다 — 사라진 에이전트를 사슬 고리로 쓰지 않는다', () => {
    const plan = planSpecTasks(items('gone', 'a2'), { wanted: null, regenerate: false, agentExists: alive('a2') });
    expect(plan.detach).toEqual(['i1']);
    expect(plan.steps[0]).toEqual({ kind: 'create', itemId: 'i1', index: 0 });
    const links = specChainLinks(plan.steps, resolve);
    expect(links).toEqual([{ source: 'new-i1', target: 'a2' }]);
    expect(links.some((l) => l.source === 'gone' || l.target === 'gone')).toBe(false);
  });

  it('대상이 아닌 항목의 끊긴 연결도 걷어 낸다 — 화면이 "카드 없음" 으로 정직하게 보인다', () => {
    const plan = planSpecTasks(items('gone', undefined), { wanted: new Set(['i2']), regenerate: false, agentExists: alive() });
    expect(plan.detach).toEqual(['i1']);
    expect(plan.steps).toEqual([{ kind: 'create', itemId: 'i2', index: 1 }]);
  });

  it('스펙 변경을 카드에 반영(regenerate)하면 대상 카드만 다시 맞추고 새 카드·새 엣지는 없다', () => {
    const plan = planSpecTasks(items('a1', 'a2'), { wanted: new Set(['i2']), regenerate: true, agentExists: alive('a1', 'a2') });
    expect(plan.steps).toEqual([
      { kind: 'keep', itemId: 'i1', agentId: 'a1' },
      { kind: 'refresh', itemId: 'i2', agentId: 'a2' },
    ]);
    expect(specChainLinks(plan.steps, resolve)).toEqual([]);
  });

  it('만들기에 실패한 자리는 사슬에서 빠지고, 남은 이웃이 둘 다 옛 카드면 새 엣지를 만들지 않는다', () => {
    const plan = planSpecTasks(items('a1', undefined, 'a3'), { wanted: null, regenerate: false, agentExists: alive('a1', 'a3') });
    expect(specChainLinks(plan.steps, (s) => (s.kind === 'create' ? null : s.agentId))).toEqual([]);
  });
});

describe('§5.15 withSpecRules — 카드 규칙의 스펙 섹션만 교체', () => {
  const block = (text: string) => buildSpecTaskRules({ specTitle: 'T', specBody: 'B', itemText: text, itemIndex: 0, itemTotal: 1 });

  it('사람이 쓴 규칙은 남기고 옛 스펙 섹션을 새것으로 바꾼다', () => {
    const first = withSpecRules('Always run tests.', block('old criterion'));
    const second = withSpecRules(first, block('new criterion'));
    expect(second).toContain('new criterion');
    expect(second).not.toContain('old criterion');
    expect(second).toContain('Always run tests.');
    expect(second.split(SPEC_RULES_BEGIN)).toHaveLength(2);
    expect(second.split(SPEC_RULES_END)).toHaveLength(2);
    expect(second.startsWith(SPEC_RULES_BEGIN)).toBe(true);
  });

  it('규칙이 비어 있으면 스펙 섹션만 남는다 — 같은 입력이면 같은 결과', () => {
    const once = withSpecRules(undefined, block('c'));
    expect(withSpecRules(once, block('c'))).toBe(once);
  });
});
