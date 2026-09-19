import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig, QueuedCommand } from '@vibisual/shared';
import type { LocalTurnArgs } from './localRunner.js';

/**
 * §5.3 #12-1-B · §5.5 #17-12 ③-6 — **로컬 턴**에서 권한 카드 취소·답 넷·턴 끝 이유가 서는가.
 *
 * 로컬 경로는 훅이 없어 `/api/permission-check` 를 타지 않는다. 판정 자리가 `requestTool` 한 곳에
 * 따로 있으므로, 훅 경로만 고치고 여기를 빠뜨리면 로컬 버블에서만 "항상 거절했는데 또 묻는다"가 난다.
 *
 * 러너는 대역이다 — `onToolRequest`·`onDone` 을 우리가 부른다(`localTurnLiveness.test.ts` 와 같은 방식).
 */

let lastTurnArgs: LocalTurnArgs | null = null;
const runningLocal = new Set<string>();

vi.mock('./localRunner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./localRunner.js')>();
  return {
    ...actual,
    runLocalTurn: (args: LocalTurnArgs): void => { lastTurnArgs = args; runningLocal.add(args.subAgentId); },
    // 대역 러너에는 끊을 생성이 없다 — "돌고 있던 턴을 끊었다"만 알려 준다.
    stopLocalTurn: (subAgentId: string): boolean => runningLocal.delete(subAgentId),
  };
});

const { subAgentManager } = await import('./subAgentManager.js');
const { permissionBroker } = await import('./permissionBroker.js');
const { permissionSessionGrants } = await import('./permissionSessionGrants.js');

const PARENT_CWD = process.cwd();

function localConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    model: 'opus',
    tools: [],
    permissionMode: 'default',
    skills: [],
    provider: { kind: 'local-llama', modelId: 'test-model.gguf' },
    ...overrides,
  } as unknown as AgentConfig;
}

function makeCmd(subAgentId: string): QueuedCommand {
  return {
    id: `cmd-${Math.random().toString(36).slice(2)}`,
    text: '파일 하나 고쳐 줘',
    status: 'queued',
    timestamp: Date.now(),
    subAgentId,
  } as unknown as QueuedCommand;
}

const created: string[] = [];
function newSub(agentId: string, preferredId: string): { id: string } {
  const sub = subAgentManager.create(agentId, preferredId);
  created.push(sub.id);
  return sub;
}

function start(agentId: string, subId: string, config: AgentConfig = localConfig()) {
  const sub = newSub(agentId, subId);
  const cmd = makeCmd(sub.id);
  subAgentManager.execute(cmd, PARENT_CWD, '', config);
  expect(lastTurnArgs).not.toBeNull();
  return { sub, cmd, args: lastTurnArgs! };
}

beforeEach(() => {
  while (created.length > 0) {
    const id = created.pop();
    if (id) subAgentManager.remove(id);
  }
  for (const p of permissionBroker.listPending()) permissionBroker.cancel(p.requestId, 'agent-stopped');
  lastTurnArgs = null;
  runningLocal.clear();
  subAgentManager.setOnSubStatusChange(() => { /* 조용히 */ });
  subAgentManager.setAgentConfigResolver(() => undefined);
});

afterEach(() => {
  subAgentManager.setAgentConfigResolver(() => undefined);
});

describe('로컬 턴 끝 이유 — 러너가 넘긴 날것을 한 칸으로 접는다', () => {
  it('엔진이 stop 으로 끝내면 end_turn', () => {
    const { cmd, args } = start('agent-stop-end', 'sub-stop-end');
    args.onDone(undefined, { finishReason: 'stop' });
    expect(cmd.status).toBe('completed');
    expect(cmd.stopReason).toBe('end_turn');
  });

  it('length 는 max_tokens, content_filter 는 refusal', () => {
    const a = start('agent-stop-len', 'sub-stop-len');
    a.args.onDone(undefined, { finishReason: 'length' });
    expect(a.cmd.stopReason).toBe('max_tokens');

    const b = start('agent-stop-filter', 'sub-stop-filter');
    b.args.onDone(undefined, { finishReason: 'content_filter' });
    expect(b.cmd.stopReason).toBe('refusal');
  });

  it('도구 왕복 상한에 닿으면 마지막 낱말이 무엇이든 max_turns', () => {
    const { cmd, args } = start('agent-stop-rounds', 'sub-stop-rounds');
    args.onDone(undefined, { finishReason: 'tool_calls', maxRounds: true });
    expect(cmd.stopReason).toBe('max_turns');
  });

  it('끝 정보가 없어도 성공한 턴은 평범한 끝이다', () => {
    const { cmd, args } = start('agent-stop-bare', 'sub-stop-bare');
    args.onDone();
    expect(cmd.stopReason).toBe('end_turn');
  });

  it('실패로 닫힌 턴에는 짐작한 이유를 적지 않는다', () => {
    const { cmd, args } = start('agent-stop-fail', 'sub-stop-fail');
    args.onDone('engine responded 400');
    expect(cmd.status).toBe('error');
    expect(cmd.stopReason).toBeUndefined();
  });

  it('사용자가 멈춘 턴은 엔진 낱말보다 cancelled 가 앞선다', () => {
    const { sub, cmd, args } = start('agent-stop-user', 'sub-stop-user');
    expect(subAgentManager.stop(sub.id)).toBe(true);
    args.onDone(undefined, { finishReason: 'stop' });
    expect(cmd.stopReason).toBe('cancelled');
  });
});

describe('로컬 권한 판정 — 취소·금지 목록·세션 기억', () => {
  it('[중지]는 그 세션의 대기 카드를 취소로 닫고, 모델에게는 취소 사유가 간다', async () => {
    const { sub, args } = start('agent-perm-stop', 'sub-perm-stop');
    const verdict = args.onToolRequest!('Bash', { command: 'ls' });
    const pending = permissionBroker.listPending().filter((p) => p.subAgentId === sub.id);
    expect(pending).toHaveLength(1);
    // 모드가 물은 호출이라 "항상 허용"은 세션 기억, "항상 거절"은 금지 목록에 적힌다.
    expect(pending[0]!.alwaysAllow).toBe('session');
    expect(pending[0]!.alwaysReject).toBe('disallowed-tools');

    subAgentManager.stop(sub.id);
    const result = await verdict;
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/cancelled/);
    expect(permissionBroker.listPending().filter((p) => p.subAgentId === sub.id)).toHaveLength(0);
  });

  it('확인 목록이 붙잡은 호출의 "항상 허용"은 확인 목록 칸이다', async () => {
    const { sub, args } = start('agent-perm-ask', 'sub-perm-ask', localConfig({ permissionMode: 'bypassPermissions', askTools: ['Bash'] }));
    const verdict = args.onToolRequest!('Bash', { command: 'ls' });
    const [card] = permissionBroker.listPending().filter((p) => p.subAgentId === sub.id);
    expect(card?.askedByTool).toBe(true);
    expect(card?.alwaysAllow).toBe('ask-tools');
    permissionBroker.cancel(card!.requestId, 'agent-stopped');
    await verdict;
  });

  it('턴 도중에 저장된 금지 목록을 다음 호출이 곧바로 읽는다 — 모드 단축보다 먼저', async () => {
    const agentId = 'agent-perm-live';
    let saved: AgentConfig = localConfig({ permissionMode: 'bypassPermissions' });
    subAgentManager.setAgentConfigResolver((pid) => (pid === agentId ? saved : undefined));
    const { args } = start(agentId, 'sub-perm-live', localConfig({ permissionMode: 'bypassPermissions' }));

    expect((await args.onToolRequest!('Bash', { command: 'ls' })).allowed).toBe(true);
    // 카드에서 [항상 거절]을 눌러 저장된 모양 — 턴 설정 객체는 그대로다.
    saved = { ...saved, disallowedTools: ['Bash'] };
    const blocked = await args.onToolRequest!('Bash', { command: 'ls' });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toMatch(/disallowed/);
    expect(permissionBroker.listPending()).toHaveLength(0);
  });

  it('세션 기억이 있으면 모드가 묻는 호출을 다시 묻지 않는다 — 다른 세션은 그대로 묻는다', async () => {
    const agentId = 'agent-perm-grant';
    const a = start(agentId, 'sub-perm-grant-1');
    permissionSessionGrants.grant(agentId, a.sub.id, 'Bash');
    expect((await a.args.onToolRequest!('Bash', { command: 'ls' })).allowed).toBe(true);
    expect(permissionBroker.listPending()).toHaveLength(0);

    const b = start(agentId, 'sub-perm-grant-2');
    const verdict = b.args.onToolRequest!('Bash', { command: 'ls' });
    expect(permissionBroker.listPending().filter((p) => p.subAgentId === b.sub.id)).toHaveLength(1);
    subAgentManager.stop(b.sub.id);
    expect((await verdict).allowed).toBe(false);
  });

  it('확인 목록이 붙잡은 호출은 세션 기억을 읽지 않는다(사용자가 매번 묻게 지목한 도구)', async () => {
    const agentId = 'agent-perm-grant-ask';
    const { sub, args } = start(agentId, 'sub-perm-grant-ask', localConfig({ permissionMode: 'bypassPermissions', askTools: ['Bash'] }));
    permissionSessionGrants.grant(agentId, sub.id, 'Bash');
    const verdict = args.onToolRequest!('Bash', { command: 'ls' });
    expect(permissionBroker.listPending().filter((p) => p.subAgentId === sub.id)).toHaveLength(1);
    subAgentManager.stop(sub.id);
    await verdict;
  });

  it('[중지]는 세션 기억을 지우지 않고, 세션을 지우면 기억도 함께 사라진다', () => {
    const agentId = 'agent-perm-forget';
    const { sub } = start(agentId, 'sub-perm-forget');
    permissionSessionGrants.grant(agentId, sub.id, 'Bash');
    subAgentManager.stop(sub.id);
    expect(permissionSessionGrants.has(agentId, sub.id, 'Bash')).toBe(true);
    subAgentManager.remove(sub.id);
    expect(permissionSessionGrants.has(agentId, sub.id, 'Bash')).toBe(false);
  });
});
