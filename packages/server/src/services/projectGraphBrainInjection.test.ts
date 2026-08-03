import { describe, it, expect } from 'vitest';
import { ProjectGraph } from './projectGraph.js';
import { BRAIN_INJECTIONS_MAX_PER_AGENT, type BrainInjectionEvent } from '@vibisual/shared';

/**
 * §5.10 v3.78 — IDE 스트림 `기억 N장 참조` 칩 도배 회귀 테스트.
 *
 * 스폰 브리핑은 **명령을 dispatch 할 때마다** 돌고 상시 규칙 + top-K 는 대개 그대로라 카드 묶음이
 * 매번 똑같다. 종전에는 그때마다 이벤트가 append 돼 칩이 턴 수만큼 쌓였다(실측 7개 연속).
 * 같은 계기 + 같은 카드 집합이면 칩을 새로 만들지 않고 횟수만 올라야 한다.
 */
const ev = (over: Partial<BrainInjectionEvent> & Pick<BrainInjectionEvent, 'id' | 'at'>): BrainInjectionEvent => ({
  agentId: 'agent-1',
  cardIds: ['card-a', 'card-b', 'card-c'],
  cardTitles: ['A', 'B', 'C'],
  trigger: 'spawn',
  ...over,
});

/** 그 에이전트의 주입 이벤트 목록(스냅샷 탑재분과 같은 창구). */
function injections(graph: ProjectGraph, agentId: string): BrainInjectionEvent[] {
  return graph.getBrainInjectionsRecord()?.[agentId] ?? [];
}

describe('ProjectGraph — Brain 주입 칩 코얼레스', () => {
  it('같은 카드 묶음이 매 턴 다시 주입돼도 칩은 하나로 유지된다', () => {
    const graph = new ProjectGraph();
    for (let i = 0; i < 7; i++) graph.addBrainInjection(ev({ id: `inj-${i}`, at: 1000 + i * 60_000 }));

    const list = injections(graph, 'agent-1');
    expect(list).toHaveLength(1);
    expect(list[0]?.repeatCount).toBe(7);
  });

  it('정렬 기준인 at 은 최초 시각 그대로 두고 lastAt 만 갱신한다(스트림 재정렬 방지)', () => {
    const graph = new ProjectGraph();
    graph.addBrainInjection(ev({ id: 'inj-1', at: 1000 }));
    graph.addBrainInjection(ev({ id: 'inj-2', at: 99_000 }));

    const first = injections(graph, 'agent-1')[0];
    expect(first?.at).toBe(1000);
    expect(first?.lastAt).toBe(99_000);
    expect(first?.id).toBe('inj-1'); // 칩 key 가 바뀌지 않아야 펼침 상태가 유지된다.
  });

  it('카드 묶음이 실제로 달라지면 새 칩이 생긴다', () => {
    const graph = new ProjectGraph();
    graph.addBrainInjection(ev({ id: 'inj-1', at: 1000 }));
    graph.addBrainInjection(ev({ id: 'inj-2', at: 2000, cardIds: ['card-x'], cardTitles: ['X'] }));

    expect(injections(graph, 'agent-1')).toHaveLength(2);
  });

  it('카드 집합이 같으면 순서가 달라도 같은 칩으로 본다', () => {
    const graph = new ProjectGraph();
    graph.addBrainInjection(ev({ id: 'inj-1', at: 1000, cardIds: ['card-a', 'card-b'], cardTitles: ['A', 'B'] }));
    graph.addBrainInjection(ev({ id: 'inj-2', at: 2000, cardIds: ['card-b', 'card-a'], cardTitles: ['B', 'A'] }));

    expect(injections(graph, 'agent-1')).toHaveLength(1);
  });

  it('계기(trigger)가 다르면 따로 센다 — 파일 경고와 스폰 브리핑은 다른 사건이다', () => {
    const graph = new ProjectGraph();
    graph.addBrainInjection(ev({ id: 'inj-1', at: 1000 }));
    graph.addBrainInjection(ev({ id: 'inj-2', at: 2000, trigger: 'file' }));

    expect(injections(graph, 'agent-1').map((e) => e.trigger)).toEqual(['spawn', 'file']);
  });

  it('서로 다른 묶음이 많이 쌓여도 ring buffer 상한을 넘지 않는다', () => {
    const graph = new ProjectGraph();
    for (let i = 0; i < BRAIN_INJECTIONS_MAX_PER_AGENT + 10; i++) {
      graph.addBrainInjection(ev({ id: `inj-${i}`, at: 1000 + i, cardIds: [`card-${i}`], cardTitles: [`T${i}`] }));
    }
    expect(injections(graph, 'agent-1')).toHaveLength(BRAIN_INJECTIONS_MAX_PER_AGENT);
  });

  it('에이전트가 다르면 서로 섞이지 않는다', () => {
    const graph = new ProjectGraph();
    graph.addBrainInjection(ev({ id: 'inj-1', at: 1000 }));
    graph.addBrainInjection(ev({ id: 'inj-2', at: 2000, agentId: 'agent-2' }));

    expect(injections(graph, 'agent-1')).toHaveLength(1);
    expect(injections(graph, 'agent-2')).toHaveLength(1);
  });
});
