import { describe, it, expect, beforeEach } from 'vitest';
import { subAgentManager } from './subAgentManager.js';

/**
 * §2.4 (잠듦) — **유휴 세션의 claude 자식 프로세스 회수** 회귀 테스트.
 *
 * 이 기능의 위험은 "안 재우는 것"이 아니라 **잘못 재우는 것**이다. 도는 세션의 자식을 뺏으면 그 턴이
 * 죽고, 백그라운드 작업을 가진 세션을 재우면 `--resume` 이 그것만은 되살리지 못해 사용자가 시킨 일이
 * 조용히 사라진다(Claude Desktop 이 실제로 그 버그를 안았다 — claude-code#68625).
 * 그래서 재우는 쪽 한 건보다 **재우지 않는 쪽**을 더 많이 고정한다.
 */

const THRESHOLD = 15 * 60 * 1000;

/** 매니저 내부 장부 — 자식 프로세스를 실제로 띄우지 않고 그 자리에 가짜를 앉히기 위한 통로. */
interface Innards {
  runningChildren: Map<string, unknown>;
  persistentChildReady: Map<string, boolean>;
  bgPromotedSubs: Set<string>;
  intentionalKill: Set<string>;
}
function innards(): Innards {
  return subAgentManager as unknown as Innards;
}

/** `isChildStdinWritable` 이 "쓸 수 있는 창구"로 인정하는 최소 형태 + 종료 호출을 삼키는 no-op. */
function fakeIdleChild(): unknown {
  return {
    pid: undefined,
    exitCode: null,
    signalCode: null,
    stdin: { destroyed: false, writableEnded: false, writable: true, end: () => {} },
    kill: () => true,
    once: () => {},
  };
}

const created: string[] = [];
const parents: string[] = [];

/** 자식이 붙어 있고 다음 턴을 기다리며 놀고 있는(ready) 세션 하나. */
function parkedSub(agentId: string, idleMs: number, preferredId?: string): string {
  const sub = subAgentManager.create(agentId, preferredId);
  created.push(sub.id);
  const live = subAgentManager.getSub(sub.id)!;
  live.status = 'idle';
  live.sessionId = `session-${sub.id}`;
  live.lastActivityAt = Date.now() - idleMs;
  innards().runningChildren.set(sub.id, fakeIdleChild());
  innards().persistentChildReady.set(sub.id, true);
  return sub.id;
}

beforeEach(() => {
  while (parents.length > 0) {
    const a = parents.pop();
    if (a) subAgentManager.clearPendingSubagentTasks(a);
  }
  while (created.length > 0) {
    const id = created.pop();
    if (!id) continue;
    innards().runningChildren.delete(id);
    innards().persistentChildReady.delete(id);
    innards().bgPromotedSubs.delete(id);
    innards().intentionalKill.delete(id);
    subAgentManager.remove(id);
  }
});

describe('sweepDormantIdleSubs — 재운다', () => {
  it('임계를 넘겨 놀고 있던 세션의 자식을 회수하고 잠듦 표식을 세운다', () => {
    const id = parkedSub('agent-sleep', THRESHOLD + 1000);

    expect(subAgentManager.sweepDormantIdleSubs(THRESHOLD)).toContain(id);
    expect(subAgentManager.getSub(id)!.dormant).toBe(true);
    expect(typeof subAgentManager.getSub(id)!.dormantSince).toBe('number');
  });

  it('대화를 잇는 근거인 sessionId 는 그대로 둔다(다음 턴이 --resume 으로 이어 간다)', () => {
    const id = parkedSub('agent-keep-session', THRESHOLD + 1000);
    const before = subAgentManager.getSub(id)!.sessionId;

    subAgentManager.sweepDormantIdleSubs(THRESHOLD);
    expect(subAgentManager.getSub(id)!.sessionId).toBe(before);
  });

  it('의도된 종료로 마킹한다 — 안 하면 close 가 크래시로 읽어 세션이 error 로 물든다', () => {
    const id = parkedSub('agent-intentional', THRESHOLD + 1000);

    subAgentManager.sweepDormantIdleSubs(THRESHOLD);
    expect(innards().intentionalKill.has(id)).toBe(true);
  });

  it('한 번 재운 세션을 다시 보고하지 않는다(broadcast·체크포인트 헛돌기 방지)', () => {
    const id = parkedSub('agent-once', THRESHOLD + 1000);

    expect(subAgentManager.sweepDormantIdleSubs(THRESHOLD)).toContain(id);
    expect(subAgentManager.sweepDormantIdleSubs(THRESHOLD)).not.toContain(id);
  });
});

describe('sweepDormantIdleSubs — 재우지 않는다', () => {
  it('임계에 못 미친 세션은 건드리지 않는다', () => {
    const id = parkedSub('agent-fresh', THRESHOLD - 60 * 1000);

    expect(subAgentManager.sweepDormantIdleSubs(THRESHOLD)).not.toContain(id);
    expect(subAgentManager.getSub(id)!.dormant).toBeUndefined();
  });

  it('한 턴을 처리 중인 자식(ready=false)은 오래 놀았어도 건드리지 않는다', () => {
    const id = parkedSub('agent-busy', THRESHOLD + 1000);
    innards().persistentChildReady.set(id, false);

    expect(subAgentManager.sweepDormantIdleSubs(THRESHOLD)).not.toContain(id);
  });

  it('아직 나가지 않은 명령이 큐에 남아 있으면 곧 쓸 자식이라 두고 간다', () => {
    const id = parkedSub('agent-queued', THRESHOLD + 1000);

    const slept = subAgentManager.sweepDormantIdleSubs(THRESHOLD, (subId) => subId === id);
    expect(slept).not.toContain(id);
    expect(subAgentManager.getSub(id)!.dormant).toBeUndefined();
  });

  it('백그라운드 작업이 살아 있는 세션은 재우지 않는다 — --resume 이 그것만은 못 되살린다', () => {
    const id = parkedSub('agent-bg', THRESHOLD + 1000);
    innards().bgPromotedSubs.add(id);

    expect(subAgentManager.sweepDormantIdleSubs(THRESHOLD)).not.toContain(id);
    expect(subAgentManager.getSub(id)!.dormant).toBeUndefined();
  });

  it('PTY(CMD) 세션은 우리가 띄운 자식이 아니므로 대상이 아니다', () => {
    const agentId = 'agent-cmd-dormant';
    const id = parkedSub(agentId, THRESHOLD + 1000);
    subAgentManager.markCmdSubActivity(`term:${agentId}:${id}`, /*isStop=*/false);

    expect(subAgentManager.sweepDormantIdleSubs(THRESHOLD)).not.toContain(id);
  });

  it('자식이 애초에 없는 세션은 회수할 것이 없다(빈 보고 ❌)', () => {
    const sub = subAgentManager.create('agent-no-child');
    created.push(sub.id);
    subAgentManager.getSub(sub.id)!.lastActivityAt = Date.now() - (THRESHOLD + 1000);

    expect(subAgentManager.sweepDormantIdleSubs(THRESHOLD)).not.toContain(sub.id);
  });
});

describe('잠듦 표식은 런타임 전용', () => {
  it('체크포인트에서 복원할 때 표식을 걷는다 — 부팅 직후엔 회수해 둔 자식 자체가 없다', () => {
    const agentId = 'agent-restored-dormant';
    subAgentManager.mergeSnapshot(
      {
        [agentId]: [{
          id: 'sub-restored-dormant',
          sessionId: 'session-restored',
          label: 'Sub #1',
          parentAgentId: agentId,
          status: 'idle',
          createdAt: Date.now(),
          lastActivityAt: Date.now(),
          dormant: true,
          dormantSince: Date.now(),
        }],
      },
      0,
    );
    created.push('sub-restored-dormant');

    const restored = subAgentManager.getSub('sub-restored-dormant');
    expect(restored).toBeDefined();
    expect(restored!.dormant).toBeUndefined();
    expect(restored!.dormantSince).toBeUndefined();
  });
});

describe('sweepDormantIdleSubs — 주인 모를 백그라운드 자식이 있으면 그 부모는 통째로 보호한다', () => {
  it('소유 세션 역조회가 실패한 자식(subId 미상)이 떠 있으면 그 부모의 세션을 재우지 않는다', () => {
    const agentId = 'agent-unowned-bg';
    const id = parkedSub(agentId, THRESHOLD + 1000);
    // 훅이 소유 탭을 못 풀었고 처리 중인 탭도 없다 → 장부에 주인 없는 자식으로 오른다.
    subAgentManager.noteSubagentTaskStart(agentId, 'tool-unowned', undefined, { background: true });
    parents.push(agentId);

    expect(subAgentManager.sweepDormantIdleSubs(THRESHOLD)).not.toContain(id);
    expect(subAgentManager.getSub(id)!.dormant).toBeUndefined();
  });

  it('그 자식이 정리되면 다시 재울 수 있다(영구 잠금 ❌)', () => {
    const agentId = 'agent-unowned-cleared';
    const id = parkedSub(agentId, THRESHOLD + 1000);
    subAgentManager.noteSubagentTaskStart(agentId, 'tool-unowned-2', undefined, { background: true });
    parents.push(agentId);
    expect(subAgentManager.sweepDormantIdleSubs(THRESHOLD)).not.toContain(id);

    subAgentManager.clearPendingSubagentTasks(agentId);
    expect(subAgentManager.sweepDormantIdleSubs(THRESHOLD)).toContain(id);
  });

  it('다른 부모의 미상 자식은 이 부모를 묶지 않는다(과보호 ❌)', () => {
    const other = 'agent-other-parent';
    subAgentManager.noteSubagentTaskStart(other, 'tool-other', undefined, { background: true });
    parents.push(other);
    const id = parkedSub('agent-unrelated', THRESHOLD + 1000);

    expect(subAgentManager.sweepDormantIdleSubs(THRESHOLD)).toContain(id);
  });
});
