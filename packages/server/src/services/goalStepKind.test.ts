import { describe, it, expect, vi } from 'vitest';

// 이 파일은 사용자 기기의 `~/.vibisual/user-defaults.json` 을 읽으면 안 된다(기기마다 답이 갈린다).
vi.mock('./userDefaultsService.js', () => ({
  userDefaultsService: { get: () => ({ updatedAt: 1 }), subscribe: () => () => {} },
}));

const { ProjectGraph } = await import('./projectGraph.js');

/**
 * §5.5 #17-17 ⑪(c)(d)(j) — **단계에 종류를 붙이는 좁은 문**의 회귀 테스트.
 *
 * 이 문이 왜 따로 있는지가 곧 시험할 것이다. 종류를 `setUserGoalSteps` 로 붙이면 목록 **전체**가
 * `authoredBy='user'` 로 박혀, 다음 턴부터 세션은 자기 계획을 한 줄도 못 고친다 — 화면으로는
 * "왜 단계가 안 갱신되지"로만 보이고 원인은 여기다. 그래서 이 문은 `kind` 말고는 아무것도
 * 건드리지 않아야 한다. 특히 **단계의 `updatedAt`** — 무대가 그 값으로 시각 구간을 잘라
 * 아래 칸에 무엇을 펼지 정하므로(⑪(j)), 종류를 고른 것만으로 창이 밀리면 남의 기록이 이 단계의
 * 것으로 보인다.
 */

function graphWithSteps(): {
  graph: InstanceType<typeof ProjectGraph>;
  sub: string;
  ids: string[];
} {
  const graph = new ProjectGraph();
  const agent = graph.createCustomAgent('Stager');
  const sub = 'sub-kind';
  graph.setSessionGoal({ agentId: agent.id, subAgentId: sub, text: '무대 시험' });
  graph.noteSessionGoalProgress(sub, {
    source: 'agent',
    steps: [
      { text: '자리 찾기', status: 'done' },
      { text: '고치기', status: 'in_progress' },
      { text: '확인', status: 'pending' },
    ],
  });
  const goal = graph.getSessionGoal(sub);
  return { graph, sub, ids: (goal?.steps ?? []).map((s) => s.id) };
}

describe('⑪(c) setGoalStepKind — 종류만 바꾸는 좁은 문', () => {
  it('그 단계에만 종류가 붙는다', () => {
    const { graph, sub, ids } = graphWithSteps();
    const next = graph.setGoalStepKind(sub, ids[1]!, 'git');
    expect(next?.steps[1]?.kind).toBe('git');
    expect(next?.steps[0]?.kind).toBeUndefined();
    expect(next?.steps[2]?.kind).toBeUndefined();
  });

  it('소유(authoredBy)를 사용자로 바꾸지 않는다 — 세션이 계속 자기 목록을 고칠 수 있어야 한다', () => {
    const { graph, sub, ids } = graphWithSteps();
    const before = graph.getSessionGoal(sub)?.steps.map((s) => s.authoredBy);
    const next = graph.setGoalStepKind(sub, ids[0]!, 'source');
    expect(next?.steps.map((s) => s.authoredBy)).toEqual(before);
    expect(next?.steps.some((s) => s.authoredBy === 'user')).toBe(false);
  });

  it('단계의 시각(updatedAt)을 밀지 않는다 — 무대의 시각 구간이 종류 선택으로 흔들리면 안 된다', () => {
    const { graph, sub, ids } = graphWithSteps();
    const before = graph.getSessionGoal(sub)?.steps.map((s) => s.updatedAt);
    const next = graph.setGoalStepKind(sub, ids[1]!, 'log');
    expect(next?.steps.map((s) => s.updatedAt)).toEqual(before);
  });

  it('본문·상태·진행률은 그대로다', () => {
    const { graph, sub, ids } = graphWithSteps();
    const before = graph.getSessionGoal(sub);
    const next = graph.setGoalStepKind(sub, ids[2]!, 'test');
    expect(next?.steps.map((s) => s.text)).toEqual(before?.steps.map((s) => s.text));
    expect(next?.steps.map((s) => s.status)).toEqual(before?.steps.map((s) => s.status));
    expect(next?.percent).toBe(before?.percent);
    expect(next?.history).toHaveLength(before?.history.length ?? 0);
  });

  it('null 을 주면 종류가 떨어진다(빈 문자열이 남지 않는다)', () => {
    const { graph, sub, ids } = graphWithSteps();
    graph.setGoalStepKind(sub, ids[0]!, 'git');
    const cleared = graph.setGoalStepKind(sub, ids[0]!, null);
    expect(cleared?.steps[0] && 'kind' in cleared.steps[0]).toBe(false);
  });

  it('같은 종류를 다시 붙이면 목표가 그대로다(헛된 갱신을 만들지 않는다)', () => {
    const { graph, sub, ids } = graphWithSteps();
    const first = graph.setGoalStepKind(sub, ids[1]!, 'git');
    const again = graph.setGoalStepKind(sub, ids[1]!, 'git');
    expect(again).toBe(first); // 같은 객체 — updatedAt 조차 오르지 않는다
  });

  it('종류 이름은 40자에서 잘린다(에이전트가 문장을 통째로 보내도 카드 이름이 된다)', () => {
    const { graph, sub, ids } = graphWithSteps();
    const next = graph.setGoalStepKind(sub, ids[0]!, 'x'.repeat(80));
    expect(next?.steps[0]?.kind).toHaveLength(40);
  });

  it('없는 단계·없는 세션에는 아무 일도 일어나지 않는다', () => {
    const { graph, sub, ids } = graphWithSteps();
    expect(graph.setGoalStepKind(sub, 'nope', 'git')).toBeUndefined();
    expect(graph.setGoalStepKind('sub-없음', ids[0]!, 'git')).toBeUndefined();
    expect(graph.getSessionGoal(sub)?.steps.every((s) => !s.kind)).toBe(true);
  });

  it('붙인 종류는 그 카드의 노출로 셈해진다(⑪(c) 의 생애 판정이 사용자 선택도 읽는다)', () => {
    const { graph, sub, ids } = graphWithSteps();
    graph.upsertVisualKind({ key: 'git', label: 'Git' });
    const before = graph.getVisualKindsRecord()?.['git']?.refCount ?? 0;
    graph.setGoalStepKind(sub, ids[1]!, 'git');
    expect(graph.getVisualKindsRecord()?.['git']?.refCount).toBe(before + 1);
  });

  it('없는 카드를 골라도 카드가 새로 생기지는 않는다(카드를 만드는 문은 따로다 — ⑪(a))', () => {
    const { graph, sub, ids } = graphWithSteps();
    graph.setGoalStepKind(sub, ids[0]!, '없는종류');
    // 단계에는 붙는다(에이전트가 나중에 그 키로 카드를 세우면 그때 그림이 붙는다).
    expect(graph.getSessionGoal(sub)?.steps[0]?.kind).toBe('없는종류');
    expect(graph.getVisualKindsRecord()?.['없는종류']).toBeUndefined();
  });
});
