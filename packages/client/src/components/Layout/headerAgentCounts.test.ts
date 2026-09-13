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
  resolveAgentRunSummary,
  resolveHeaderAgentCounts,
  type AgentRunSummarySources,
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

function sub(
  id: string,
  parentAgentId: string,
  status: SubAgent['status'] = 'idle',
  patch: Partial<SubAgent> = {},
): SubAgent {
  return {
    id,
    sessionId: `sess-${id}`,
    label: id,
    parentAgentId,
    status,
    createdAt: 0,
    lastActivityAt: 0,
    ...patch,
  };
}

/** §2.4 (한도 정지) — 서버가 세워 둔 표식 한 벌(실측 원문 그대로). */
const LIMIT: SubAgent['usageLimit'] = {
  kind: 'session',
  at: 1,
  message: "You've hit your session limit · resets 10pm (Asia/Seoul)",
  resetsLabel: '10pm (Asia/Seoul)',
};

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
    expect(counts).toEqual({ agents: 1, sessions: 12, running: 5, completed: 0, limited: 0 });
  });

  it('세션이 없는 버블(훅 에이전트)은 자기 자신이 한 단위다', () => {
    const counts = computeHeaderAgentCounts(sources({
      agents: [agent('h1', { status: 'active', customCreated: false })],
      agentProjects: { h1: PROJECT },
    }));
    expect(counts).toEqual({ agents: 1, sessions: 1, running: 1, completed: 0, limited: 0 });
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
  const served: ProjectAgentCounts = { total: 3, active: 1, completed: 0, sessions: 24, running: 5, limited: 0 };

  it('서버가 준 집계가 있으면 그것을 쓴다(배경 탭도 숫자가 살아 있다)', () => {
    expect(resolveHeaderAgentCounts(served, sources())).toEqual({
      agents: 3, sessions: 24, running: 5, completed: 0, limited: 0,
    });
  });

  it('한도 축이 없는 옛 집계는 "멈춘 것이 없다"로 읽는다(에러 ❌ · §3.2.1-5)', () => {
    const old = { total: 3, active: 1, completed: 0, sessions: 24, running: 5 } as ProjectAgentCounts;
    expect(resolveHeaderAgentCounts(old, sources()).limited).toBe(0);
  });

  it('세션 축이 없는 옛 집계는 절반만 믿지 않고 통째로 직접 센다', () => {
    const legacy = { total: 99, active: 9, completed: 0 } as ProjectAgentCounts;
    const counts = resolveHeaderAgentCounts(legacy, sources({
      agents: [agent('a1', { status: 'active' })],
      agentProjects: { a1: PROJECT },
      subAgents: { a1: [sub('s0', 'a1', 'active'), sub('s1', 'a1', 'active')] },
    }));
    expect(counts).toEqual({ agents: 1, sessions: 2, running: 2, completed: 0, limited: 0 });
  });

  it('집계가 아예 없으면 직접 센다', () => {
    const counts = resolveHeaderAgentCounts(undefined, sources({
      agents: [agent('a1')],
      agentProjects: { a1: PROJECT },
    }));
    expect(counts.agents).toBe(1);
  });
});

/**
 * [창과 버블] 목록 한 줄의 실행 요약 — **"창이 없으면 불이 꺼진다"를 끝낸다.**
 *
 * 실제 사고 재현: 배지는 `4/52`(파랑)인데 그 배지를 눌러 연 목록에서는 도는 에이전트의 도트가
 * 꺼져 있었다. 목록 도트가 실행 상태가 아니라 **IDE 창 유무**를 그렸고, 하필 그 색이 세션 도트의
 * "도는 중"과 같은 파랑이었기 때문이다.
 */
function runSources(patch: Partial<AgentRunSummarySources> = {}): AgentRunSummarySources {
  return {
    subAgents: {},
    queuedCommands: {},
    runningSubagentTasks: {},
    acknowledged: {},
    ...patch,
  };
}

describe('resolveAgentRunSummary — 목록 한 줄의 실행 상태', () => {
  it('창이 하나도 없어도 세션이 돌면 도는 중이다 — 창 유무는 실행 여부와 다른 축', () => {
    const a = agent('a1');
    const summary = resolveAgentRunSummary(a, runSources({
      subAgents: { a1: [sub('s0', 'a1', 'active'), sub('s1', 'a1', 'idle')] },
    }));
    expect(summary.state).toBe('running');
    expect(summary).toMatchObject({ running: 1, sessions: 2 });
  });

  it('세션이 전부 조용해도 버블이 도는 중이면 1 — 권한 대기·자식 기다리는 감독관', () => {
    const summary = resolveAgentRunSummary(agent('a1', { status: 'awaiting_permission' }), runSources({
      subAgents: { a1: [sub('s0', 'a1', 'idle')] },
    }));
    expect(summary.state).toBe('running');
    expect(summary.running).toBe(1);
  });

  it('이 세션이 띄운 백그라운드 Task 가 살아 있으면 도는 중 — sub.status 만 믿지 않는다', () => {
    const summary = resolveAgentRunSummary(agent('a1'), runSources({
      subAgents: { a1: [sub('s0', 'a1', 'idle')] },
      runningSubagentTasks: { a1: [task('t1', 'a1', 's0')] },
    }));
    expect(summary.state).toBe('running');
  });

  it('실패한 세션이 있어도 도는 세션이 하나 있으면 도는 중으로 보인다', () => {
    const summary = resolveAgentRunSummary(agent('a1'), runSources({
      subAgents: { a1: [sub('s0', 'a1', 'error'), sub('s1', 'a1', 'active')] },
    }));
    expect(summary.state).toBe('running');
    expect(summary.running).toBe(1);
  });

  it('아무것도 안 돌고 실패만 남았으면 오류', () => {
    const summary = resolveAgentRunSummary(agent('a1'), runSources({
      subAgents: { a1: [sub('s0', 'a1', 'error')] },
    }));
    expect(summary.state).toBe('error');
    expect(summary.running).toBe(0);
  });

  it('끝났는데 아직 안 봤으면 초록, 확인하면 회색으로 물러난다', () => {
    const src = { subAgents: { a1: [sub('s0', 'a1', 'idle')] } };
    expect(resolveAgentRunSummary(agent('a1'), runSources(src)).state).toBe('doneUnseen');
    expect(resolveAgentRunSummary(agent('a1'), runSources({
      ...src, acknowledged: { s0: true as const },
    })).state).toBe('done');
  });

  it('세션이 없는 버블은 자기 자신이 한 단위 — 배지와 같은 규칙', () => {
    expect(resolveAgentRunSummary(agent('a1', { status: 'active' }), runSources()))
      .toMatchObject({ sessions: 1, running: 1 });
    expect(resolveAgentRunSummary(agent('a1'), runSources()))
      .toMatchObject({ sessions: 1, running: 0 });
  });

  // §2.4 (한도 정지) — 원증상: 한도로 멎은 세션이 초록 "끝남"으로 보였다(CLI 가 exit 0 이라).
  it('한도로 끊긴 세션은 끝남이 아니라 멈춤이다 — 초록으로 내려가지 않는다', () => {
    const summary = resolveAgentRunSummary(agent('a1'), runSources({
      subAgents: { a1: [sub('s0', 'a1', 'idle', { usageLimit: LIMIT })] },
    }));
    expect(summary.state).toBe('limited');
    expect(summary.limited).toBe(1);
    expect(summary.limitLabel).toBe('10pm (Asia/Seoul)');
    expect(summary.limitMessage).toContain('session limit');
  });

  it('무시하고 다시 돌린 세션이 있으면 파랑이 이긴다 — 사용자가 정한 우선순위', () => {
    const summary = resolveAgentRunSummary(agent('a1'), runSources({
      subAgents: {
        a1: [sub('s0', 'a1', 'idle', { usageLimit: LIMIT }), sub('s1', 'a1', 'active')],
      },
    }));
    expect(summary.state).toBe('running');
  });

  it('한도가 실패보다 앞선다 — 사유가 더 구체적이라 그 줄이 무엇을 기다리는지 말해 준다', () => {
    const summary = resolveAgentRunSummary(agent('a1'), runSources({
      subAgents: {
        a1: [sub('s0', 'a1', 'idle', { usageLimit: LIMIT }), sub('s1', 'a1', 'error')],
      },
    }));
    expect(summary.state).toBe('limited');
  });

  it('배지 집계도 같은 규칙으로 센다 — 도는 세션의 옛 표식은 주황으로 세지 않는다', () => {
    const agents = [agent('a1'), agent('a2')];
    const agentProjects = { a1: PROJECT, a2: PROJECT };
    const subAgents = {
      a1: [sub('s0', 'a1', 'idle', { usageLimit: LIMIT })],
      // 다시 돌아 active 인데 표식이 아직 남아 있는 한 프레임 — 파랑과 주황이 겹치면 안 된다.
      a2: [sub('s1', 'a2', 'active', { usageLimit: LIMIT })],
    };
    const counts = computeHeaderAgentCounts(sources({ agents, agentProjects, subAgents }));
    expect(counts.limited).toBe(1);
    expect(counts.running).toBe(1);
  });

  it('줄들의 합이 배지 숫자와 같다 — 목록과 배지가 다른 말을 하면 안 된다', () => {
    const agents = [
      agent('a1', { status: 'active' }),
      agent('a2'),
      agent('a3', { status: 'completed' }),
    ];
    const agentProjects = { a1: PROJECT, a2: PROJECT, a3: PROJECT };
    const subAgents = {
      a1: [sub('s0', 'a1', 'active'), sub('s1', 'a1', 'idle')],
      a2: [sub('s2', 'a2', 'idle')],
      a3: [sub('s3', 'a3', 'idle'), sub('s4', 'a3', 'active')],
    };
    const queuedCommands = { a2: [cmd('c1', 's2', 'executing')] };
    const counts = computeHeaderAgentCounts(sources({
      agents, agentProjects, subAgents, queuedCommands,
    }));
    const rows = agents.map((a) => resolveAgentRunSummary(a, runSources({ subAgents, queuedCommands })));
    expect(rows.reduce((n, r) => n + r.running, 0)).toBe(counts.running);
    expect(rows.reduce((n, r) => n + r.sessions, 0)).toBe(counts.sessions);
  });
});

/**
 * (판올림 번호 발급 대기) **색을 눌렀으면 그 색의 세션이 떠야 한다** — `focusSessionId`.
 *
 * 실제 사고 재현: 목록의 주황 줄을 눌러 창을 열어도 **마지막에 보던 세션**이 떴다. 색은
 * "이 버블 어딘가에 멈춘 것이 있다"까지만 말하고, 어느 탭인지는 사용자가 다시 찾아야 했다.
 */
describe('resolveAgentRunSummary — 그 색이 가리키는 세션(focusSessionId)', () => {
  it('파랑이면 도는 세션 중 가장 최근에 움직인 것', () => {
    const summary = resolveAgentRunSummary(agent('a1'), runSources({
      subAgents: {
        a1: [
          sub('s-old', 'a1', 'active', { lastActivityAt: 10 }),
          sub('s-quiet', 'a1', 'idle', { lastActivityAt: 999 }),
          sub('s-new', 'a1', 'active', { lastActivityAt: 20 }),
        ],
      },
    }));
    expect(summary.state).toBe('running');
    expect(summary.focusSessionId).toBe('s-new');
  });

  it('주황이면 멈춘 세션 중 가장 최근 — 조용한 세션은 짚지 않는다', () => {
    const summary = resolveAgentRunSummary(agent('a1'), runSources({
      subAgents: {
        a1: [
          sub('s-quiet', 'a1', 'idle', { lastActivityAt: 900 }),
          sub('s-stop1', 'a1', 'idle', { lastActivityAt: 10, usageLimit: LIMIT }),
          sub('s-stop2', 'a1', 'idle', { lastActivityAt: 30, usageLimit: LIMIT }),
        ],
      },
    }));
    expect(summary.state).toBe('limited');
    expect(summary.focusSessionId).toBe('s-stop2');
  });

  it('빨강이면 실패한 세션 중 가장 최근', () => {
    const summary = resolveAgentRunSummary(agent('a1'), runSources({
      subAgents: {
        a1: [
          sub('s-err1', 'a1', 'error', { lastActivityAt: 50 }),
          sub('s-err2', 'a1', 'error', { lastActivityAt: 5 }),
        ],
      },
    }));
    expect(summary.state).toBe('error');
    expect(summary.focusSessionId).toBe('s-err1');
  });

  it('초록이면 끝났는데 안 본 세션 중 가장 최근 — 이미 확인한 것은 짚지 않는다', () => {
    const summary = resolveAgentRunSummary(agent('a1'), runSources({
      subAgents: {
        a1: [
          sub('s-seen', 'a1', 'idle', { lastActivityAt: 900 }),
          sub('s-unseen', 'a1', 'idle', { lastActivityAt: 7 }),
        ],
      },
      acknowledged: { 's-seen': true as const },
    }));
    expect(summary.state).toBe('doneUnseen');
    expect(summary.focusSessionId).toBe('s-unseen');
  });

  it('회색(조용함)은 짚지 않는다 — 그때 열 것은 마지막에 보던 세션이다', () => {
    const summary = resolveAgentRunSummary(agent('a1'), runSources({
      subAgents: { a1: [sub('s0', 'a1', 'idle'), sub('s1', 'a1', 'idle')] },
      acknowledged: { s0: true as const, s1: true as const },
    }));
    expect(summary.state).toBe('done');
    expect(summary.focusSessionId).toBeNull();
  });

  // 줄이 파란 근거는 `isSessionRunning` 인데 세션 도트는 `error` 를 먼저 본다 — 색표로만 맞추면
  // 이 줄은 짚을 것을 못 찾아 조용한 세션으로 열린다.
  it('실패 표식이 남은 채 명령이 도는 세션도 파랑의 근거라면 짚는다', () => {
    const summary = resolveAgentRunSummary(agent('a1'), runSources({
      subAgents: { a1: [sub('s0', 'a1', 'error', { lastActivityAt: 3 })] },
      queuedCommands: { a1: [cmd('c1', 's0', 'executing')] },
    }));
    expect(summary.state).toBe('running');
    expect(summary.focusSessionId).toBe('s0');
  });

  it('색이 버블에서만 왔으면 짚을 세션이 없다 — 권한 대기로 도는 버블', () => {
    const summary = resolveAgentRunSummary(agent('a1', { status: 'awaiting_permission' }), runSources({
      subAgents: { a1: [sub('s0', 'a1', 'idle')] },
      acknowledged: { s0: true as const },
    }));
    expect(summary.state).toBe('running');
    expect(summary.focusSessionId).toBeNull();
  });

  it('세션이 하나도 없는 버블도 짚을 것이 없다', () => {
    expect(resolveAgentRunSummary(agent('a1', { status: 'error' }), runSources()).focusSessionId)
      .toBeNull();
  });
});
