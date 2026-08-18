import { describe, it, expect } from 'vitest';
import { ProjectGraph } from './projectGraph.js';
import { subAgentManager } from './subAgentManager.js';
import type { QueuedCommand, SessionLoop } from '@vibisual/shared';

/**
 * §5.5 #17-11 v3.92 — 커스텀 에이전트의 **거짓 완료** 회귀 테스트.
 *
 * `recomputeCustomAgentStatus` 는 "지금 도는 sub 가 0" 이면 부모 버블을 completed 로 내렸다.
 * 그런데 한 턴이 끝나고 다음 명령이 dispatch 되기까지 sub 는 잠깐 idle 이라, 큐에 명령이 줄 서
 * 있거나 루프가 다음 회차를 기다리는 동안에도 그 찰나가 매번 "완료"로 잡혔다 = 사용자 보고
 * "완료도 안 했는데 계속 완료 처리". 완료의 기준은 **낼 일이 남았는가** 여야 한다.
 */

function makeCmd(subAgentId: string, status: QueuedCommand['status']): QueuedCommand {
  return {
    id: `cmd-${Math.random().toString(36).slice(2, 8)}`,
    text: 'do the thing',
    timestamp: Date.now(),
    subAgentId,
    status,
  };
}

function makeLoop(agentId: string, subAgentId: string, over: Partial<SessionLoop> = {}): SessionLoop {
  const now = Date.now();
  return {
    agentId,
    subAgentId,
    command: 'run the tests',
    mode: 'infinite',
    completed: 1,
    enabled: true,
    intervalMs: 0,
    stopOnError: true,
    contextMode: 'none',
    spentCostUsd: 0,
    spentTokens: 0,
    oneTaskPerRound: false,
    commitEachRound: false,
    status: 'waiting',
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

/** 커스텀 에이전트 + 큐 참조 + sub 하나를 세우고, 부모를 active 상태까지 올려 둔다. */
function activeAgent(label: string): {
  graph: ProjectGraph;
  agentId: string;
  sessionId: string;
  subId: string;
  queues: Map<string, QueuedCommand[]>;
} {
  const graph = new ProjectGraph();
  const queues = new Map<string, QueuedCommand[]>();
  graph.setCommandQueuesRef(queues);

  const agent = graph.createCustomAgent(label);
  const sessionId = agent.path;
  const sub = subAgentManager.create(agent.id);

  // 명령이 도는 중 = sub active → 부모도 active.
  sub.status = 'active';
  expect(graph.recomputeCustomAgentStatus(agent.id)).toBe(true);
  expect(graph.getSnapshot().agents.find((a) => a.id === agent.id)?.status).toBe('active');

  // 턴 종료 — sub 는 idle 로 떨어진다(다음 명령 dispatch 전의 그 찰나).
  sub.status = 'idle';

  return { graph, agentId: agent.id, sessionId, subId: sub.id, queues };
}

function statusOf(graph: ProjectGraph, agentId: string): string | undefined {
  return graph.getSnapshot().agents.find((a) => a.id === agentId)?.status;
}

describe('커스텀 에이전트 완료 판정 — 낼 일이 남았으면 완료가 아니다', () => {
  it('큐에 대기 중인 명령이 남아 있으면 완료로 내리지 않는다', () => {
    const { graph, agentId, sessionId, subId, queues } = activeAgent('Queued');
    queues.set(sessionId, [makeCmd(subId, 'queued')]);

    expect(graph.recomputeCustomAgentStatus(agentId)).toBe(false);
    expect(statusOf(graph, agentId)).toBe('active');
  });

  it('그 대기 명령이 다 빠지면 그때 한 번 완료로 간다', () => {
    const { graph, agentId, sessionId, subId, queues } = activeAgent('Drain');
    queues.set(sessionId, [makeCmd(subId, 'queued')]);
    expect(graph.recomputeCustomAgentStatus(agentId)).toBe(false);

    // 명령이 끝나 큐에서 빠진 상태(아카이브로 이동) — 이제 진짜 할 일이 없다.
    queues.set(sessionId, []);
    expect(graph.recomputeCustomAgentStatus(agentId)).toBe(true);
    expect(statusOf(graph, agentId)).toBe('completed');
  });

  it('다른 에이전트의 큐는 이 에이전트의 완료를 막지 못한다', () => {
    const { graph, agentId, subId, queues } = activeAgent('Neighbor');
    const other = graph.createCustomAgent('Other');
    queues.set(other.path, [makeCmd(subId, 'queued')]);

    expect(graph.recomputeCustomAgentStatus(agentId)).toBe(true);
    expect(statusOf(graph, agentId)).toBe('completed');
  });

  it('자식이 죽었는데 executing 으로 굳은 명령은 완료를 영영 막지 않는다', () => {
    const { graph, agentId, sessionId, subId, queues } = activeAgent('Stuck');
    queues.set(sessionId, [makeCmd(subId, 'executing')]);

    // 살아있는 자식이 있으면 anyActive 가 잡고, 없으면 여기서 끝나야 한다 — 무한 active 금지.
    expect(graph.recomputeCustomAgentStatus(agentId)).toBe(true);
    expect(statusOf(graph, agentId)).toBe('completed');
  });

  it('회차 사이 대기(waiting) 중인 세션 루프가 있으면 완료로 내리지 않는다', () => {
    const { graph, agentId, subId } = activeAgent('Looping');
    graph.setSessionLoop(makeLoop(agentId, subId, { status: 'waiting' }));

    expect(graph.recomputeCustomAgentStatus(agentId)).toBe(false);
    expect(statusOf(graph, agentId)).toBe('active');
  });

  it('루프가 목표 도달로 꺼지면 그때 완료로 간다', () => {
    const { graph, agentId, subId } = activeAgent('LoopDone');
    graph.setSessionLoop(makeLoop(agentId, subId, { status: 'waiting' }));
    expect(graph.recomputeCustomAgentStatus(agentId)).toBe(false);

    graph.updateSessionLoop(subId, { enabled: false, status: 'done' });
    expect(graph.recomputeCustomAgentStatus(agentId)).toBe(true);
    expect(statusOf(graph, agentId)).toBe('completed');
  });

  it('사용자가 정지한 루프는 완료를 막지 않는다', () => {
    const { graph, agentId, subId } = activeAgent('LoopStopped');
    graph.setSessionLoop(makeLoop(agentId, subId, { enabled: false, status: 'stopped' }));

    expect(graph.recomputeCustomAgentStatus(agentId)).toBe(true);
    expect(statusOf(graph, agentId)).toBe('completed');
  });

  it('다른 에이전트의 루프는 이 에이전트의 완료를 막지 못한다', () => {
    const { graph, agentId, subId } = activeAgent('LoopNeighbor');
    const other = graph.createCustomAgent('OtherLooper');
    graph.setSessionLoop(makeLoop(other.id, subId, { status: 'running' }));

    expect(graph.recomputeCustomAgentStatus(agentId)).toBe(true);
    expect(statusOf(graph, agentId)).toBe('completed');
  });

  it('실패로 끝난 세션은 완료가 아니라 error 로 올라간다 — 캔버스에서 실패가 완료로 세탁되면 안 된다', () => {
    const { graph, agentId, subId } = activeAgent('Failed');
    const sub = subAgentManager.getSub(subId);
    expect(sub).toBeDefined();
    sub!.status = 'error';

    expect(graph.recomputeCustomAgentStatus(agentId)).toBe(true);
    expect(statusOf(graph, agentId)).toBe('error');
  });

  it('실패 버블은 같은 판정을 다시 받아도 흔들리지 않는다(중복 broadcast 방지)', () => {
    const { graph, agentId, subId } = activeAgent('FailedStable');
    subAgentManager.getSub(subId)!.status = 'error';
    expect(graph.recomputeCustomAgentStatus(agentId)).toBe(true);

    expect(graph.recomputeCustomAgentStatus(agentId)).toBe(false);
    expect(statusOf(graph, agentId)).toBe('error');
  });

  it('실패한 세션이 새 명령으로 다시 돌면 active 로 복귀한다 — error 에 갇히지 않는다', () => {
    const { graph, agentId, subId } = activeAgent('FailedThenRerun');
    const sub = subAgentManager.getSub(subId)!;
    sub.status = 'error';
    graph.recomputeCustomAgentStatus(agentId);
    expect(statusOf(graph, agentId)).toBe('error');

    // dispatch 가 sub 를 active 로 되돌리는 그 지점.
    sub.status = 'active';
    expect(graph.recomputeCustomAgentStatus(agentId)).toBe(true);
    expect(statusOf(graph, agentId)).toBe('active');
  });

  it('도는 세션이 하나라도 있으면 실패한 형제가 있어도 active 가 이긴다', () => {
    const { graph, agentId, subId } = activeAgent('MixedSiblings');
    subAgentManager.getSub(subId)!.status = 'error';
    const running = subAgentManager.create(agentId);
    running.status = 'active';

    expect(graph.recomputeCustomAgentStatus(agentId)).toBe(false);
    expect(statusOf(graph, agentId)).toBe('active');
  });

  it('완료가 보류되는 동안 활동 시각이 갱신돼 idle sweep 에 걸리지 않는다', () => {
    const { graph, agentId, sessionId, subId, queues } = activeAgent('KeepAlive');
    queues.set(sessionId, [makeCmd(subId, 'queued')]);

    const before = graph.getSnapshot().agents.find((a) => a.id === agentId)?.lastActivity ?? 0;
    graph.recomputeCustomAgentStatus(agentId);
    const after = graph.getSnapshot().agents.find((a) => a.id === agentId)?.lastActivity ?? 0;
    expect(after).toBeGreaterThanOrEqual(before);

    // sub 의 활동 시각은 오래됐지만(턴 종료 직후 고정) 큐가 남아 있으므로 idle 로 쓸려가면 안 된다.
    expect(graph.sweepIdleAgents(60_000)).not.toContain(sessionId);
  });
});
