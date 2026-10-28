import { describe, it, expect } from 'vitest';
import { ProjectGraph } from './projectGraph.js';

/** §5.10 휴지통 복구: 클라(DetailPanel)는 버블 id(`agent-…`)만 들어 두 형태 다 받는다 · 휴지통 안의 위치 저장은 무시해 원래 좌표를 남긴다. */
describe('ProjectGraph — 커스텀 에이전트 휴지통', () => {
  it('버블 id 로도 복구된다(세션 키를 모르는 클라 경로)', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Trash Me', { x: 120, y: 340 });

    expect(graph.trashCustomAgentByBubbleId(agent.id)).toBe(true);
    expect(graph.getTrashedCustomAgents().map((a) => a.id)).toEqual([agent.id]);

    // 세션 키가 아닌 버블 id 로 복구 요청.
    expect(graph.restoreTrashedAgent(agent.id)).toBe(true);
    expect(graph.getTrashedCustomAgents()).toHaveLength(0);
    expect(agent.trashed).toBeUndefined();
    expect(agent.trashedAt).toBeUndefined();
  });

  it('세션 키로도 복구된다', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Trash Me');
    const sessionId = agent.path; // createCustomAgent 는 path 에 세션 키를 담는다.

    expect(graph.trashCustomAgentByBubbleId(agent.id)).toBe(true);
    expect(graph.restoreTrashedAgent(sessionId)).toBe(true);
    expect(agent.trashed).toBeUndefined();
  });

  it('휴지통에 있는 동안의 위치 저장은 무시되어 원래 좌표가 보존된다', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Keep My Spot', { x: 900, y: 700 });
    graph.trashCustomAgentByBubbleId(agent.id);

    // 휴지통 내부 뷰의 임시 배치가 흘러들어오는 상황.
    graph.updateBubblePositionsBatch([{ id: agent.id, x: -300, y: -150 }]);
    graph.updateBubblePosition(agent.id, -10, -20);
    expect(agent.position).toEqual({ x: 900, y: 700 });

    // 복구 후에는 다시 위치 저장을 받는다.
    graph.restoreTrashedAgent(agent.id);
    graph.updateBubblePositionsBatch([{ id: agent.id, x: 1000, y: 800 }]);
    expect(agent.position).toEqual({ x: 1000, y: 800 });
  });

  it('존재하지 않는 id 는 복구 실패(404 경로)', () => {
    const graph = new ProjectGraph();
    expect(graph.restoreTrashedAgent('agent-nope')).toBe(false);
    expect(graph.permanentlyDeleteTrashedAgent('agent-nope')).toBe(false);
  });

  /** [모두 삭제]·Delete 다중 선택의 배치 경로(`POST /api/trash/purge`) 알맹이 — 여러 건이 다 지워지고, 없는 id 가 섞여도 나머지는 계속 지워진다. */
  it('여러 건을 이어서 영구 삭제해도 전부 지워진다(배치 경로)', () => {
    const graph = new ProjectGraph();
    const agents = ['A', 'B', 'C'].map((label) => graph.createCustomAgent(label));
    for (const a of agents) expect(graph.trashCustomAgentByBubbleId(a.id)).toBe(true);
    expect(graph.getTrashedCustomAgents()).toHaveLength(3);

    // 라우트가 도는 루프 그대로 — 없는 id 는 missing 으로 빠지고 나머지는 계속 지운다.
    const results = [agents[0]!.id, 'agent-nope', agents[1]!.id, agents[2]!.id]
      .map((id) => graph.permanentlyDeleteTrashedAgent(id));
    expect(results).toEqual([true, false, true, true]);
    expect(graph.getTrashedCustomAgents()).toHaveLength(0);

    // 같은 id 를 다시 보내도(더블 클릭·경합) 예외 없이 false.
    expect(graph.permanentlyDeleteTrashedAgent(agents[0]!.id)).toBe(false);
  });

  it('휴지통에 없는(살아 있는) 커스텀 에이전트는 영구 삭제되지 않는다', () => {
    const graph = new ProjectGraph();
    const alive = graph.createCustomAgent('Still Working');

    // 일괄 삭제로 넘어온 id 가 사실은 살아 있는 버블이었던 경우 — 묘비까지 남기며 사라지면 안 된다.
    expect(graph.permanentlyDeleteTrashedAgent(alive.id)).toBe(false);
    expect(graph.getTrashedCustomAgents()).toHaveLength(0);
    expect(alive.trashed).toBeUndefined();
  });
});
