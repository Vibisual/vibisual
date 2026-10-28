/** §7.10 — 워크트리 삭제 때 강제로 끝낼 대상 고르기. 적으면 dev 서버가 파일을 잡아 좀비 폴더가, 많으면 남의 터미널·부모 에이전트가 죽는다. 효과는 주입이다. */
import { describe, it, expect, vi } from 'vitest';

import { reapWorktree, selectWorktreeAgents, EMPTY_REAP, type ReapableAgent, type WorktreeReapInput } from './worktreeReaper.js';

const WT = 'wt-alpha';
const PARENT = 'my-project';
const WT_PATH = 'C:/repo/.claude/worktrees/wt-alpha';

function agent(id: string, over: Partial<ReapableAgent> = {}): ReapableAgent {
  return { id, project: WT, customCreated: true, trashed: false, ...over };
}

describe('회수 대상 고르기 (§7.10)', () => {
  it('그 워크트리의 커스텀 에이전트만 고른다', () => {
    const agents = [
      agent('a1'),
      agent('a2'),
      agent('other', { project: PARENT }),
      agent('other-wt', { project: 'wt-beta' }),
    ];
    expect(selectWorktreeAgents(agents, WT)).toEqual(['a1', 'a2']);
  });

  it('훅 버블은 건드리지 않는다 — 사용자가 자기 VS Code 에서 연 세션은 우리 자식이 아니다', () => {
    const agents = [agent('mine'), agent('hook', { customCreated: false })];
    expect(selectWorktreeAgents(agents, WT)).toEqual(['mine']);
  });

  it('이미 휴지통에 있는 것은 다시 고르지 않는다', () => {
    const agents = [agent('live'), agent('gone', { trashed: true })];
    expect(selectWorktreeAgents(agents, WT)).toEqual(['live']);
  });

  it('워크트리 이름을 모르면 아무도 고르지 않는다 — 빈 이름이 전부와 맞아 떨어지면 참사다', () => {
    expect(selectWorktreeAgents([agent('a1', { project: undefined })], '')).toEqual([]);
    expect(selectWorktreeAgents([agent('a1', { project: null })], WT)).toEqual([]);
  });
});

describe('회수 실행 (§7.10)', () => {
  function run(over: Partial<WorktreeReapInput> = {}) {
    const stopAllSessions = vi.fn((id: string) => [`${id}-s1`, `${id}-s2`]);
    const trashAgent = vi.fn((_agentId: string) => true);
    const killTerminalsUnder = vi.fn(() => 3);
    const result = reapWorktree({
      worktreePath: WT_PATH,
      worktreeProjectName: WT,
      agents: [agent('a1'), agent('a2'), agent('outsider', { project: PARENT })],
      stopAllSessions,
      trashAgent,
      killTerminalsUnder,
      ...over,
    });
    return { result, stopAllSessions, trashAgent, killTerminalsUnder };
  }

  it('터미널·세션·에이전트를 한 번에 회수하고 개수를 그대로 보고한다', () => {
    const { result, stopAllSessions, trashAgent, killTerminalsUnder } = run();
    expect(killTerminalsUnder).toHaveBeenCalledWith(WT_PATH);
    expect(stopAllSessions.mock.calls.map((c) => c[0])).toEqual(['a1', 'a2']);
    expect(trashAgent.mock.calls.map((c) => c[0])).toEqual(['a1', 'a2']);
    expect(result).toEqual({ agents: 2, sessions: 4, terminals: 3, trashed: 2 });
  });

  it('세션을 끊는 것이 휴지통 이동보다 **먼저**다 — 순서가 뒤집히면 소유 판정이 사라진다', () => {
    const order: string[] = [];
    reapWorktree({
      worktreePath: WT_PATH,
      worktreeProjectName: WT,
      agents: [agent('a1')],
      stopAllSessions: (id) => { order.push(`stop:${id}`); return []; },
      trashAgent: (id) => { order.push(`trash:${id}`); return true; },
      killTerminalsUnder: () => { order.push('kill-terminals'); return 0; },
    });
    expect(order).toEqual(['kill-terminals', 'stop:a1', 'trash:a1']);
  });

  it('PTY 다리가 없으면(웹·테스트) 터미널은 0 이고 나머지는 그대로 돈다', () => {
    const { result } = run({ killTerminalsUnder: null });
    expect(result.terminals).toBe(0);
    expect(result.trashed).toBe(2);
  });

  it('한쪽이 실패해도 나머지 회수를 멈추지 않는다 — 여기서 멈추면 폴더가 반만 지워진다', () => {
    const trashAgent = vi.fn((id: string) => {
      if (id === 'a1') throw new Error('boom');
      return true;
    });
    const result = reapWorktree({
      worktreePath: WT_PATH,
      worktreeProjectName: WT,
      agents: [agent('a1'), agent('a2')],
      stopAllSessions: () => ['s'],
      trashAgent,
      killTerminalsUnder: () => { throw new Error('pty gone'); },
    });
    expect(result).toEqual({ agents: 2, sessions: 2, terminals: 0, trashed: 1 });
  });

  it('대상이 없으면 아무것도 부르지 않는다', () => {
    const { result, stopAllSessions, trashAgent } = run({ agents: [agent('outsider', { project: PARENT })] });
    expect(stopAllSessions).not.toHaveBeenCalled();
    expect(trashAgent).not.toHaveBeenCalled();
    expect(result.agents).toBe(0);
  });

  it('EMPTY_REAP 은 전부 0 — 회수 실패 시 호출부가 분기 없이 쓴다', () => {
    expect(EMPTY_REAP).toEqual({ agents: 0, sessions: 0, terminals: 0, trashed: 0 });
  });
});
