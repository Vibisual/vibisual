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

/**
 * §5.5 #17-11 — 훅 `Stop` 이 집계를 건너뛰고 버블을 완료로 찍던 회귀.
 *
 * 헤드리스 서브는 `VIBISUAL_OWNER_AGENT_ID` 를 달고 뜨고, 그 태그가 훅 라우트에서 `session_id` 를
 * **부모 버블의 세션키로 rewrite** 한다. 그래서 세션 탭 하나가 턴을 마칠 때마다
 * `agentTracker.markStop → setAgentStatus(버블, 'completed')` 가 불렸고, 형제 탭이 멀쩡히 도는
 * 중에도 버블이 completed 로 찍혀 완료음·완료 알림이 울렸다(사용자 보고).
 * 같은 경로로 v3.92 완료 조건(큐·루프·백그라운드 Task·실패 형제)도 전부 우회됐다.
 *
 * 그래서 커스텀 버블의 `setAgentStatus` 는 직접 찍지 않고 `recomputeCustomAgentStatus` 에 넘긴다.
 * CMD(인터랙티브 터미널)와 일반 Hook 에이전트는 예외 — 훅이 그 버블의 유일한 상태 주인이다.
 */
describe('커스텀 에이전트 완료 판정 — 훅 Stop 은 탭 하나의 종료일 뿐이다', () => {
  /** 세션 탭 두 개가 동시에 도는 버블. 둘 다 active 인 상태로 돌려준다. */
  function twoTabAgent(label: string): {
    graph: ProjectGraph;
    agentId: string;
    sessionId: string;
    subs: [string, string];
    queues: Map<string, QueuedCommand[]>;
  } {
    const graph = new ProjectGraph();
    const queues = new Map<string, QueuedCommand[]>();
    graph.setCommandQueuesRef(queues);

    const agent = graph.createCustomAgent(label);
    const first = subAgentManager.create(agent.id);
    const second = subAgentManager.create(agent.id);
    first.status = 'active';
    second.status = 'active';

    expect(graph.recomputeCustomAgentStatus(agent.id)).toBe(true);
    expect(statusOf(graph, agent.id)).toBe('active');

    return { graph, agentId: agent.id, sessionId: agent.path, subs: [first.id, second.id], queues };
  }

  it('탭 하나가 턴을 마쳐도 형제 탭이 도는 동안에는 완료로 찍지 않는다', () => {
    const { graph, agentId, sessionId, subs } = twoTabAgent('TwoTabs');
    subAgentManager.getSub(subs[0])!.status = 'idle';

    // 훅 Stop — 소유자 태그로 session_id 가 버블 세션키로 rewrite 된 그 호출.
    graph.setAgentStatus(sessionId, 'completed');

    expect(statusOf(graph, agentId)).toBe('active');
  });

  it('마지막 탭까지 끝나면 그때 완료로 간다', () => {
    const { graph, agentId, sessionId, subs } = twoTabAgent('LastTab');
    subAgentManager.getSub(subs[0])!.status = 'idle';
    graph.setAgentStatus(sessionId, 'completed');
    expect(statusOf(graph, agentId)).toBe('active');

    subAgentManager.getSub(subs[1])!.status = 'idle';
    graph.setAgentStatus(sessionId, 'completed');
    expect(statusOf(graph, agentId)).toBe('completed');
  });

  it('큐에 대기 중인 명령이 남아 있으면 훅 Stop 으로도 완료되지 않는다', () => {
    const { graph, agentId, sessionId, subId, queues } = activeAgent('HookQueued');
    queues.set(sessionId, [makeCmd(subId, 'queued')]);

    graph.setAgentStatus(sessionId, 'completed');

    expect(statusOf(graph, agentId)).toBe('active');
  });

  it('진행 중 세션 루프가 있으면 훅 Stop 으로도 완료되지 않는다', () => {
    const { graph, agentId, sessionId, subId } = activeAgent('HookLooping');
    graph.setSessionLoop(makeLoop(agentId, subId, { status: 'waiting' }));

    graph.setAgentStatus(sessionId, 'completed');

    expect(statusOf(graph, agentId)).toBe('active');
  });

  it('실패한 탭이 있으면 훅 Stop 이 완료로 세탁하지 못한다', () => {
    const { graph, agentId, sessionId, subId } = activeAgent('HookFailed');
    subAgentManager.getSub(subId)!.status = 'error';

    graph.setAgentStatus(sessionId, 'completed');

    expect(statusOf(graph, agentId)).toBe('error');
  });

  it('완료의 부수효과(페이드·엣지 정리)까지 마지막 탭까지 유예된다', () => {
    const { graph, agentId, sessionId, subs } = twoTabAgent('DeferSideEffects');
    const fadeOf = () => graph.getSnapshot().agents.find((a) => a.id === agentId)?.fadeStartedAt;

    subAgentManager.getSub(subs[0])!.status = 'idle';
    graph.setAgentStatus(sessionId, 'completed');
    // 상태만 막고 부수효과가 먼저 돌면 버블이 도는 중에 선이 끊기고 색이 바랜다.
    expect(fadeOf()).toBeUndefined();

    subAgentManager.getSub(subs[1])!.status = 'idle';
    graph.setAgentStatus(sessionId, 'completed');
    expect(fadeOf()).toEqual(expect.any(Number));
  });

  it('CMD(인터랙티브 터미널) 버블은 종전대로 훅이 직접 완료로 찍는다', () => {
    const graph = new ProjectGraph();
    const cmd = graph.createCustomAgent('Term', undefined, null, {
      executionMode: 'interactive-terminal',
    });
    expect(graph.getAgentConfigOverrides(cmd.id)?.executionMode).toBe('interactive-terminal');

    // 집계는 CMD 를 일부러 비켜서 있다 — 여기서 가로채면 그 버블은 영영 끝나지 않는다.
    graph.setAgentStatus(cmd.path, 'completed');

    expect(statusOf(graph, cmd.id)).toBe('completed');
  });

  it('커스텀이 아닌 Hook 에이전트는 종전대로 훅이 직접 완료로 찍는다', () => {
    const graph = new ProjectGraph();
    const sessionId = 'hook-session-completion';
    graph.processHookEvent({
      session_id: sessionId,
      hook_event_name: 'PreToolUse',
      cwd: process.cwd(),
      tool_name: 'Read',
      tool_input: { file_path: 'README.md' },
      tool_use_id: 'hook-completion-1',
    });
    const agent = graph.getSnapshot().agents.find((a) => a.path === sessionId);
    expect(agent?.status).toBe('active');

    graph.setAgentStatus(sessionId, 'completed');

    expect(statusOf(graph, agent!.id)).toBe('completed');
  });
});
