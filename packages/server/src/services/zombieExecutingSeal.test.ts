import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AgentConfig, QueuedCommand } from '@vibisual/shared';
import { ZOMBIE_EXECUTING_GRACE_MS } from '@vibisual/shared';
import type { LocalTurnArgs } from './localRunner.js';

/**
 * **좀비 `executing` 봉합** — 턴은 끝났는데 명령만 실행 중으로 굳은 자리를 런타임에 되돌리는가.
 *
 * 왜 치명적인가: dispatch 는 같은 sub 에 두 명령을 동시에 보내지 않으려고 `executing` 인
 * subAgentId 를 `busy` 로 잠근다. 그래서 완료 신호가 한 번 유실되면 그 탭은 **영구히** 새 명령을
 * 못 받는다 — 사용자에게는 "입력해도 아무 반응이 없는 탭"이다. 종전에 이걸 푸는 길은 앱 재기동
 * (restore reconcile)이나 [중지] 뿐이었고, 둘 다 사용자가 이상을 눈치채야 했다.
 *
 * 이 시험이 고정하는 것은 두 방향이다:
 *  - 굳은 것은 **반드시** 걷는다(그래야 탭이 되살아난다).
 *  - 도는 것은 **절대** 걷지 않는다 — 특히 **자식이 없는 채로 도는 로컬 턴**. 2026-08-25 에
 *    같은 착각(자식 없음 = 죽음)이 버블을 완료↔동작으로 되풀이시킨 전례가 있다.
 */

/** 러너에 넘어간 인자 — 턴을 "아직 안 끝난" 채로 붙잡아 두려고 가로챈다. */
let lastTurnArgs: LocalTurnArgs | null = null;

vi.mock('./localRunner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./localRunner.js')>();
  return {
    ...actual,
    runLocalTurn: (args: LocalTurnArgs): void => { lastTurnArgs = args; },
  };
});

const { subAgentManager } = await import('./subAgentManager.js');

const PARENT_CWD = process.cwd();
const SESSION = 'sess-zombie';

function localConfig(): AgentConfig {
  return {
    model: 'opus',
    tools: [],
    permissionMode: 'bypassPermissions',
    skills: [],
    provider: { kind: 'local-llama', modelId: 'test-model.gguf' },
  } as unknown as AgentConfig;
}

function makeCmd(subAgentId: string | null, over: Partial<QueuedCommand> = {}): QueuedCommand {
  return {
    id: `cmd-${Math.random().toString(36).slice(2)}`,
    text: '리눅스에서 언어 번역이 깨져',
    status: 'executing',
    timestamp: Date.now(),
    subAgentId,
    // 기본은 "유예를 이미 넘긴" 명령 — 걷혀야 정상인 쪽.
    startedAt: Date.now() - ZOMBIE_EXECUTING_GRACE_MS * 2,
    ...over,
  } as unknown as QueuedCommand;
}

function queues(...cmds: QueuedCommand[]): Map<string, QueuedCommand[]> {
  return new Map([[SESSION, cmds]]);
}

function seal(q: Map<string, QueuedCommand[]>): Array<{ sessionId: string; cmd: QueuedCommand }> {
  return subAgentManager.sealZombieExecutingCommands(q, ZOMBIE_EXECUTING_GRACE_MS);
}

/** 테스트가 만든 sub 를 매번 걷어 낸다(매니저가 모듈 싱글턴이라). */
const created: string[] = [];
function newSub(agentId: string, preferredId?: string): { id: string } {
  const sub = subAgentManager.create(agentId, preferredId);
  created.push(sub.id);
  return sub;
}

beforeEach(() => {
  while (created.length > 0) {
    const id = created.pop();
    if (id) subAgentManager.remove(id);
  }
  lastTurnArgs = null;
  subAgentManager.setOnSubStatusChange(() => { /* 조용히 */ });
});

describe('좀비 executing — 굳은 것은 걷는다', () => {
  it('유예를 넘기고 살아있는 일감이 없으면 봉합하고 탭을 idle 로 되돌린다', () => {
    const sub = newSub('agent-z1', 'sub-z1');
    subAgentManager.getSub(sub.id)!.status = 'active';
    const cmd = makeCmd(sub.id);

    const sealed = seal(queues(cmd));

    expect(sealed).toHaveLength(1);
    expect(sealed[0]!.sessionId).toBe(SESSION);
    expect(sealed[0]!.cmd).toBe(cmd);
    expect(cmd.status).toBe('error');
    // 사유는 기존 코드(restore reconcile)와 같은 `orphaned` 를 쓴다 — 클라의 사유 표시 목록이
    // 이미 아는 코드라야 "알 수 없는 오류"로 떨어지지 않는다.
    expect(cmd.error?.code).toBe('orphaned');
    expect(cmd.result).toContain('orphaned');
    expect(subAgentManager.getSub(sub.id)!.status).toBe('idle');
  });

  it('봉합되면 그 탭에 executing 이 남지 않는다 — busy 잠금이 풀리는 조건', () => {
    const sub = newSub('agent-z2', 'sub-z2');
    const cmd = makeCmd(sub.id);
    const q = queues(cmd);

    seal(q);

    // dispatch 의 busy 판정은 `status === 'executing'` 하나만 본다. 그 술어가 거짓이 되는 것이
    // 곧 "이 탭이 다음 명령을 받을 수 있다"는 뜻이다.
    const stillExecuting = [...q.values()].flat().filter((c) => c.status === 'executing');
    expect(stillExecuting).toHaveLength(0);
  });

  it('여러 세션에 걸쳐 굳은 것을 모두 걷고 각자의 세션 id 를 함께 돌려준다', () => {
    const a = newSub('agent-z3a', 'sub-z3a');
    const b = newSub('agent-z3b', 'sub-z3b');
    const cmdA = makeCmd(a.id);
    const cmdB = makeCmd(b.id);
    const q = new Map([['sess-a', [cmdA]], ['sess-b', [cmdB]]]);

    const sealed = seal(q);

    expect(sealed.map((s) => s.sessionId).sort()).toEqual(['sess-a', 'sess-b']);
  });
});

describe('좀비 executing — 도는 것은 걷지 않는다', () => {
  it('유예 안이면 걷지 않는다 — dispatch 직후 자식이 붙기 전 창을 죽이지 않는다', () => {
    const sub = newSub('agent-z4', 'sub-z4');
    const cmd = makeCmd(sub.id, { startedAt: Date.now() - 1_000 });

    expect(seal(queues(cmd))).toHaveLength(0);
    expect(cmd.status).toBe('executing');
  });

  it('유예 경계 직전은 남기고, 넘긴 순간부터 걷는다', () => {
    const sub = newSub('agent-z5', 'sub-z5');
    const justInside = makeCmd(sub.id, { startedAt: Date.now() - (ZOMBIE_EXECUTING_GRACE_MS - 5_000) });
    expect(seal(queues(justInside))).toHaveLength(0);

    const justOutside = makeCmd(sub.id, { startedAt: Date.now() - (ZOMBIE_EXECUTING_GRACE_MS + 5_000) });
    expect(seal(queues(justOutside))).toHaveLength(1);
  });

  it('나간 적이 없는 명령(startedAt 없음)은 건드리지 않는다', () => {
    const sub = newSub('agent-z6', 'sub-z6');
    const cmd = makeCmd(sub.id, { startedAt: undefined });

    expect(seal(queues(cmd))).toHaveLength(0);
    expect(cmd.status).toBe('executing');
  });

  it('queued 는 걷지 않는다 — 아직 자기 차례를 기다리는 명령이다', () => {
    const sub = newSub('agent-z7', 'sub-z7');
    const cmd = makeCmd(sub.id, { status: 'queued' });

    expect(seal(queues(cmd))).toHaveLength(0);
    expect(cmd.status).toBe('queued');
  });

  it('소유 탭이 없는 명령(subAgentId=null)은 건드리지 않는다', () => {
    const cmd = makeCmd(null);
    expect(seal(queues(cmd))).toHaveLength(0);
  });

  it('자식이 없어도 로컬 턴이 도는 중이면 걷지 않는다 (2026-08-25 회귀)', () => {
    const sub = newSub('agent-z8', 'sub-z8');
    const cmd = makeCmd(sub.id);
    // 로컬(All Model) 턴은 자식 프로세스가 없다 — "자식이 없으니 죽었다"가 통하지 않는 경로.
    subAgentManager.execute(cmd, PARENT_CWD, '', localConfig());
    // 러너를 붙잡아 뒀으므로 이 턴은 아직 끝나지 않았다.
    expect(lastTurnArgs).not.toBeNull();
    // 실행 시작으로 `startedAt` 이 새로 찍히므로, 유예를 넘긴 상태로 되돌려 놓고 시험한다.
    cmd.startedAt = Date.now() - ZOMBIE_EXECUTING_GRACE_MS * 2;

    expect(seal(queues(cmd))).toHaveLength(0);
    expect(cmd.status).toBe('executing');
    expect(subAgentManager.getSub(sub.id)!.status).toBe('active');
  });

  it('PTY(CMD) 탭은 걷지 않는다 — 우리가 띄운 자식이 아니라 사용자가 치는 터미널이다', () => {
    const sub = newSub('agent-z9', 'sub-z9');
    // 훅이 이 탭을 만지면 PTY 표식이 붙는다(`cmdDrivenSubs`). termId 는 `term:<agentId>:<subId>`.
    expect(subAgentManager.markCmdSubActivity(`term:agent-z9:${sub.id}`, false)).toBe(true);
    const cmd = makeCmd(sub.id);

    expect(seal(queues(cmd))).toHaveLength(0);
    expect(cmd.status).toBe('executing');
  });
});

describe('좀비 executing — 상태 강등과 같은 답을 쓴다', () => {
  it('생존 대조가 살아있다고 본 탭은 봉합도 살려 둔다', () => {
    const sub = newSub('agent-z10', 'sub-z10');
    const cmd = makeCmd(sub.id);
    subAgentManager.execute(cmd, PARENT_CWD, '', localConfig());
    cmd.startedAt = Date.now() - ZOMBIE_EXECUTING_GRACE_MS * 2;

    // 두 경로가 같은 술어(`hasLivingWork`)를 쓰므로 답이 갈릴 수 없다 — 갈리면 그 탭은
    // "쉬는 중으로 보이는데 새 명령은 못 받는" 자리에 갇힌다.
    expect(subAgentManager.reconcileDeadActiveSubs()).not.toContain(sub.id);
    expect(seal(queues(cmd))).toHaveLength(0);
  });

  it('생존 대조가 죽었다고 본 탭은 봉합도 걷는다', () => {
    const sub = newSub('agent-z11', 'sub-z11');
    subAgentManager.getSub(sub.id)!.status = 'active';
    const cmd = makeCmd(sub.id);

    expect(subAgentManager.reconcileDeadActiveSubs()).toContain(sub.id);
    expect(seal(queues(cmd))).toHaveLength(1);
  });
});
