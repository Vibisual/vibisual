/**
 * 헤더·탭 배지 집계 — **"화면에 없는 것을 세지 않고, 도는 것을 빠뜨리지 않는다."**
 *
 * 실제 사고 재현: 커스텀 에이전트 1개가 세션 5개를 동시에 돌리고 휴지통에 17개가 들어 있던
 * 프로젝트가 `1/20` 으로 보였다. 사용자가 세는 것(5)도, 캔버스에 있는 것(3)도 아닌 숫자였다.
 */
import { describe, it, expect } from 'vitest';
import type {
  BubbleData,
  ProjectAgentCounts,
  QueuedCommand,
  RunningSubagentTask,
  SubAgent,
} from '@vibisual/shared';
import {
  computeHeaderAgentCounts,
  resolveHeaderAgentCounts,
  type HeaderAgentCountSources,
} from './headerAgentCounts.js';

const PROJECT = 'vibisual';

function agent(id: string, patch: Partial<BubbleData> = {}): BubbleData {
  return {
    id,
    label: id,
    bubbleType: 'agent',
    path: `custom-${id}`,
    status: 'idle',
    activity: 0,
    customCreated: true,
    ...patch,
  };
}

function sub(id: string, parentAgentId: string, status: SubAgent['status'] = 'idle'): SubAgent {
  return {
    id,
    sessionId: `sess-${id}`,
    label: id,
    parentAgentId,
    status,
    createdAt: 0,
    lastActivityAt: 0,
  };
}

function cmd(id: string, subAgentId: string | null, status: QueuedCommand['status']): QueuedCommand {
  return { id, text: 'x', timestamp: 0, subAgentId, status };
}

function task(id: string, parentAgentId: string, subAgentId?: string): RunningSubagentTask {
  return { id, parentAgentId, startedAt: 0, ...(subAgentId ? { subAgentId } : {}) };
}

function sources(patch: Partial<HeaderAgentCountSources> = {}): HeaderAgentCountSources {
  return {
    agents: [],
    agentProjects: {},
    project: PROJECT,
    subAgents: {},
    queuedCommands: {},
    runningSubagentTasks: {},
    ...patch,
  };
}

describe('computeHeaderAgentCounts — 휴지통·프로젝트 필터', () => {
  it('휴지통 에이전트는 전체 수에서 빠진다 — 캔버스가 안 그리는 것을 숫자만 세면 안 된다', () => {
    const agents = [
      agent('a1'),
      agent('a2'),
      agent('a3'),
      ...Array.from({ length: 17 }, (_, i) => agent(`t${i}`, { trashed: true })),
    ];
    const agentProjects = Object.fromEntries(agents.map((a) => [a.id, PROJECT]));
    const counts = computeHeaderAgentCounts(sources({ agents, agentProjects }));
    expect(counts.agents).toBe(3);
  });

  it('다른 프로젝트의 에이전트는 세지 않는다', () => {
    const counts = computeHeaderAgentCounts(sources({
      agents: [agent('a1'), agent('b1')],
      agentProjects: { a1: PROJECT, b1: 'other' },
    }));
    expect(counts.agents).toBe(1);
  });

  it('project 가 null 이면 전부 센다(프로젝트 미선택 부팅 창)', () => {
    const counts = computeHeaderAgentCounts(sources({
      agents: [agent('a1'), agent('b1')],
      agentProjects: { a1: PROJECT, b1: 'other' },
      project: null,
    }));
    expect(counts.agents).toBe(2);
  });
});

describe('computeHeaderAgentCounts — 세션 축 실행 집계', () => {
  it('한 버블 안에서 다섯 세션이 돌면 5 다 — 버블 축이면 영원히 1 이었다', () => {
    const a = agent('a1', { status: 'active' });
    const subs = [
      ...Array.from({ length: 5 }, (_, i) => sub(`s${i}`, 'a1', 'active')),
      ...Array.from({ length: 7 }, (_, i) => sub(`i${i}`, 'a1', 'idle')),
    ];
    const counts = computeHeaderAgentCounts(sources({
      agents: [a],
      agentProjects: { a1: PROJECT },
      subAgents: { a1: subs },
    }));
    expect(counts).toEqual({ agents: 1, sessions: 12, running: 5, completed: 0 });
  });

  it('세션이 없는 버블(훅 에이전트)은 자기 자신이 한 단위다', () => {
    const counts = computeHeaderAgentCounts(sources({
      agents: [agent('h1', { status: 'active', customCreated: false })],
      agentProjects: { h1: PROJECT },
    }));
    expect(counts).toEqual({ agents: 1, sessions: 1, running: 1, completed: 0 });
  });

  it('세션은 조용한데 버블만 active 면 1 로 친다 — 권한 대기·자식 Task 대기', () => {
    const counts = computeHeaderAgentCounts(sources({
      agents: [agent('a1', { status: 'active' })],
      agentProjects: { a1: PROJECT },
      subAgents: { a1: [sub('s0', 'a1', 'idle'), sub('s1', 'a1', 'idle')] },
    }));
    expect(counts.running).toBe(1);
    expect(counts.sessions).toBe(2);
  });

  it('awaiting_permission 도 도는 중으로 본다', () => {
    const counts = computeHeaderAgentCounts(sources({
      agents: [agent('h1', { status: 'awaiting_permission', customCreated: false })],
      agentProjects: { h1: PROJECT },
    }));
    expect(counts.running).toBe(1);
  });

  it('sub 가 idle 이어도 그 세션의 명령이 executing 이면 도는 중', () => {
    const counts = computeHeaderAgentCounts(sources({
      agents: [agent('a1')],
      agentProjects: { a1: PROJECT },
      subAgents: { a1: [sub('s0', 'a1', 'idle'), sub('s1', 'a1', 'idle')] },
      queuedCommands: { a1: [cmd('c1', 's1', 'executing')] },
    }));
    expect(counts.running).toBe(1);
  });

  it('큐에 줄만 서 있는 명령은 도는 중이 아니다', () => {
    const counts = computeHeaderAgentCounts(sources({
      agents: [agent('a1')],
      agentProjects: { a1: PROJECT },
      subAgents: { a1: [sub('s0', 'a1', 'idle')] },
      queuedCommands: { a1: [cmd('c1', 's0', 'queued')] },
    }));
    expect(counts.running).toBe(0);
  });

  it('그 세션이 띄운 백그라운드 Task 가 살아 있으면 도는 중', () => {
    const counts = computeHeaderAgentCounts(sources({
      agents: [agent('a1')],
      agentProjects: { a1: PROJECT },
      subAgents: { a1: [sub('s0', 'a1', 'idle')] },
      runningSubagentTasks: { a1: [task('t1', 'a1', 's0')] },
    }));
    expect(counts.running).toBe(1);
  });

  it('completed 버블 수는 따로 센다 — 도트 색이 그것으로 갈린다', () => {
    const counts = computeHeaderAgentCounts(sources({
      agents: [agent('a1', { status: 'completed' }), agent('a2')],
      agentProjects: { a1: PROJECT, a2: PROJECT },
    }));
    expect(counts.completed).toBe(1);
    expect(counts.running).toBe(0);
  });
});

describe('resolveHeaderAgentCounts — 서버 집계 우선', () => {
  const served: ProjectAgentCounts = { total: 3, active: 1, completed: 0, sessions: 24, running: 5 };

  it('서버가 준 집계가 있으면 그것을 쓴다(배경 탭도 숫자가 살아 있다)', () => {
    expect(resolveHeaderAgentCounts(served, sources())).toEqual({
      agents: 3, sessions: 24, running: 5, completed: 0,
    });
  });

  it('세션 축이 없는 옛 집계는 절반만 믿지 않고 통째로 직접 센다', () => {
    const legacy = { total: 99, active: 9, completed: 0 } as ProjectAgentCounts;
    const counts = resolveHeaderAgentCounts(legacy, sources({
      agents: [agent('a1', { status: 'active' })],
      agentProjects: { a1: PROJECT },
      subAgents: { a1: [sub('s0', 'a1', 'active'), sub('s1', 'a1', 'active')] },
    }));
    expect(counts).toEqual({ agents: 1, sessions: 2, running: 2, completed: 0 });
  });

  it('집계가 아예 없으면 직접 센다', () => {
    const counts = resolveHeaderAgentCounts(undefined, sources({
      agents: [agent('a1')],
      agentProjects: { a1: PROJECT },
    }));
    expect(counts.agents).toBe(1);
  });
});
