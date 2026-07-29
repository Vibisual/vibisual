import { describe, it, expect } from 'vitest';
import { ProjectGraph } from './projectGraph.js';

/**
 * §5.10 휴지통 — 복구가 "원래 자리로" 돌아오는지에 대한 회귀 테스트.
 *  1) 클라(DetailPanel)는 세션 키가 아니라 **버블 id**(`agent-…`) 만 들고 있다 → 두 형태 모두 받아야 한다.
 *  2) 휴지통에 있는 동안 들어오는 위치 저장(휴지통 내부 뷰의 임시 배치)은 무시돼야 원래 좌표가 남는다.
 */
describe('ProjectGraph — 커스텀 에이전트 휴지통', () => {
  it('버블 id 로도 복구된다(세션 키를 모르는 클라 경로)', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Trash Me', { x: 120, y: 340 });

    expect(graph.trashCustomAgentByBubbleId(agent.id)).toBe(true);
    expect(graph.getTrashedCustomAgents().map((a) => a.id)).toEqual([agent.id]);

    // 세션 키가 아닌 버블 id 로 복구 요청 — 예전엔 404(무반응)였다.
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
});
