import { describe, it, expect } from 'vitest';
import { ProjectGraph } from './projectGraph.js';
import { subAgentManager } from './subAgentManager.js';
import type { QueuedCommand } from '@vibisual/shared';

/**
 * §2.4 확인 dismiss — **실패 표식은 눌러 내리면 내려간 채로 있어야 한다.**
 *
 * 부모 버블의 `error` 는 저장된 상태가 아니라 파생값이다 — `recomputeCustomAgentStatus` 가
 * `subs.some(s => s.status === 'error')` 로 매 스윕(`SESSION_SCAN_INTERVAL`=10초) 다시 만든다.
 * 종전 dismiss 는 버블만 `idle` 로 내리고 그 근거인 sub 의 `error` 는 그대로 뒀기 때문에,
 * 사용자가 확인해서 껐어도 **다음 스윕이 같은 자리에 빨강을 되살렸다**(사용자 보고
 * "에러난 거 확인해서 클릭했는데 프로젝트 오가고 세션 여닫으면 왜 다시 빨간불이 드나").
 * 게다가 그 `error` 는 체크포인트에 그대로 실려 앱을 껐다 켜도 되살아났다.
 */

/** 커스텀 에이전트 하나 + 실패로 끝난 sub 하나. 부모 버블은 이미 `error` 까지 올라와 있다. */
function agentWithFailedSub(label = 'GPT-Reserve'): {
  graph: ProjectGraph;
  agentId: string;
  sessionId: string;
  subId: string;
} {
  const graph = new ProjectGraph();
  // `hasPendingAgentWork` 가 큐를 훑으므로 빈 참조라도 꽂아 둔다.
  graph.setCommandQueuesRef(new Map<string, QueuedCommand[]>());

  const agent = graph.createCustomAgent(label);
  const sessionId = agent.path;
  const sub = subAgentManager.create(agent.id);

  // 명령이 실패로 끝났다 → 부모 버블은 completed 가 아니라 error 로 올라간다(§2.4).
  sub.status = 'error';
  expect(graph.recomputeCustomAgentStatus(agent.id)).toBe(true);
  expect(statusOf(graph, agent.id)).toBe('error');

  return { graph, agentId: agent.id, sessionId, subId: sub.id };
}

function statusOf(graph: ProjectGraph, agentId: string): string | undefined {
  return graph.getSnapshot().agents.find((a) => a.id === agentId)?.status;
}

describe('확인 dismiss — 실패 표식이 되살아나지 않는다', () => {
  it('버블만 idle 로 내리면 다음 스윕이 빨강을 되살린다 (근거를 안 걷은 경우)', () => {
    const { graph, agentId, sessionId } = agentWithFailedSub();

    // 종전 동작: dismiss 가 버블만 내린다.
    graph.markAgentIdle(sessionId, true);
    expect(statusOf(graph, agentId)).toBe('idle');

    // 10초 스윕이 같은 근거(sub.status === 'error')로 다시 올린다 = 이 버그의 정체.
    expect(graph.recomputeCustomAgentStatus(agentId)).toBe(true);
    expect(statusOf(graph, agentId)).toBe('error');
  });

  it('근거(sub 의 error)를 함께 걷으면 스윕을 여러 번 돌려도 idle 로 남는다', () => {
    const { graph, agentId, sessionId, subId } = agentWithFailedSub();

    // 지금 동작: /api/dismiss-agent 가 근거부터 걷고 버블을 내린다.
    expect(subAgentManager.acknowledgeErrorSubs(agentId)).toBe(1);
    graph.markAgentIdle(sessionId, true);

    expect(subAgentManager.getSub(subId)?.status).toBe('idle');
    for (let i = 0; i < 3; i++) {
      expect(graph.recomputeCustomAgentStatus(agentId)).toBe(false);
      expect(statusOf(graph, agentId)).toBe('idle');
    }
  });

  it('걷을 실패가 없으면 0 을 돌려준다 — 헛 broadcast·헛 저장 방지', () => {
    const graph = new ProjectGraph();
    graph.setCommandQueuesRef(new Map<string, QueuedCommand[]>());
    const agent = graph.createCustomAgent('무탈');
    subAgentManager.create(agent.id);

    expect(subAgentManager.acknowledgeErrorSubs(agent.id)).toBe(0);
    // 등록된 적 없는 부모 id 도 조용히 0.
    expect(subAgentManager.acknowledgeErrorSubs('agent-none')).toBe(0);
  });

  it('도는 세션은 건드리지 않는다 — active sub 는 그대로, 실패한 형제만 내려간다', () => {
    const graph = new ProjectGraph();
    graph.setCommandQueuesRef(new Map<string, QueuedCommand[]>());
    const agent = graph.createCustomAgent('형제들');
    const failed = subAgentManager.create(agent.id);
    const running = subAgentManager.create(agent.id);
    failed.status = 'error';
    running.status = 'active';

    expect(subAgentManager.acknowledgeErrorSubs(agent.id)).toBe(1);
    expect(subAgentManager.getSub(failed.id)?.status).toBe('idle');
    expect(subAgentManager.getSub(running.id)?.status).toBe('active');

    // 형제가 아직 도니 버블은 active — 확인 클릭이 도는 세션을 끝낸 것으로 만들지 않는다.
    expect(graph.recomputeCustomAgentStatus(agent.id)).toBe(true);
    expect(statusOf(graph, agent.id)).toBe('active');
  });

  it('실패의 기록은 지우지 않는다 — 걷는 것은 표식뿐', () => {
    const { agentId, subId } = agentWithFailedSub('기록보존');
    const sub = subAgentManager.getSub(subId)!;
    sub.lastResult = 'ENOENT: claude 를 찾을 수 없습니다';
    sub.lastCommand = '테스트';

    subAgentManager.acknowledgeErrorSubs(agentId);

    expect(sub.status).toBe('idle');
    expect(sub.lastResult).toBe('ENOENT: claude 를 찾을 수 없습니다');
    expect(sub.lastCommand).toBe('테스트');
  });
});
