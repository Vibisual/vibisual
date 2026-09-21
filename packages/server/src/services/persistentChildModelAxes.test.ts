import { describe, it, expect } from 'vitest';
import type { QueuedCommand } from '@vibisual/shared';
import { decidePersistentReuse, modelAxesKeyOf, PERSISTENT_MODEL_AXIS_FLAGS } from './persistentChildModelAxes.js';
import { SubAgentManager } from './subAgentManager.js';

/**
 * §4 (상태바 모델 칸 ④) — **모델을 바꾸면 다음 턴부터.**
 *
 * 지속 자식은 인자를 스폰 때만 받는다. 종전에는 설정창에서 모델을 바꿔 저장해도 그 자식이 잠듦 회수·크래시로
 * 내려갈 때까지 옛 모델로 답했다 — 상태바 모델 칸이 실측이라 옛 이름을 그대로 보여 준 그 자리다.
 * 여기서 고정하는 약속은 넷이다 —
 *   ① 지문은 **모델 축 인자만** 본다(다른 인자가 바뀌어도 매 턴 재스폰이 되지 않게).
 *   ② 지문이 달라졌고 배경 작업이 없으면 **그 턴을 큐로 되돌리고 자식을 의도된 종료로 내린다.**
 *   ③ 배경 작업이 살아 있으면 내리지 않는다(`--resume` 이 되살리지 못하는 유일한 것).
 *   ④ 스폰 때 지문을 모르면 재사용한다(이 코드가 들어간 첫 턴에 멀쩡한 자식을 전부 다시 띄우지 않게).
 */

describe('modelAxesKeyOf — 모델 축 인자만 지문에 든다', () => {
  const base = ['--model', 'opus[1m]', '--permission-mode', 'default', '--effort', 'xhigh', '--tools', 'Read,Edit'];

  it('모델·강도·설정 파일이 같으면 같은 지문이다 — 순서가 달라도', () => {
    const reordered = ['--tools', 'Read,Edit', '--effort', 'xhigh', '--permission-mode', 'default', '--model', 'opus[1m]'];
    expect(modelAxesKeyOf(base)).toBe(modelAxesKeyOf(reordered));
  });

  it('모델 축이 아닌 인자가 바뀌어도 지문은 그대로다 — 매 턴 재스폰 방지', () => {
    const otherTools = base.map((a) => (a === 'Read,Edit' ? 'Read,Edit,Bash' : a));
    const withPrompt = [...base, '--append-system-prompt', `규약 ${Date.now()}`, '--mcp-config', '/tmp/abc.json'];
    expect(modelAxesKeyOf(otherTools)).toBe(modelAxesKeyOf(base));
    expect(modelAxesKeyOf(withPrompt)).toBe(modelAxesKeyOf(base));
  });

  it('모델을 바꾸면 지문이 바뀐다', () => {
    const sonnet = base.map((a) => (a === 'opus[1m]' ? 'sonnet' : a));
    expect(modelAxesKeyOf(sonnet)).not.toBe(modelAxesKeyOf(base));
  });

  it('강도를 기본으로 되돌려 `--effort` 가 사라져도 바뀐 것이다', () => {
    const noEffort = ['--model', 'opus[1m]', '--permission-mode', 'default', '--tools', 'Read,Edit'];
    expect(modelAxesKeyOf(noEffort)).not.toBe(modelAxesKeyOf(base));
  });

  it('설정 파일(Fast·확장 사고가 드는 곳)이 바뀌면 지문이 바뀐다', () => {
    const a = [...base, '--settings', '/fixtures/.vibisual/agent-settings/aaa.json'];
    const b = [...base, '--settings', '/fixtures/.vibisual/agent-settings/bbb.json'];
    expect(modelAxesKeyOf(a)).not.toBe(modelAxesKeyOf(b));
    expect(modelAxesKeyOf(a)).not.toBe(modelAxesKeyOf(base));
  });

  it('지문에 드는 플래그는 모델 축 셋뿐이다', () => {
    expect([...PERSISTENT_MODEL_AXIS_FLAGS]).toEqual(['--model', '--effort', '--settings']);
  });

  it('값 없이 끝난 플래그는 빈 값으로 읽는다(배열 밖을 읽지 않는다)', () => {
    expect(modelAxesKeyOf(['--model'])).toBe(modelAxesKeyOf([]));
  });
});

describe('decidePersistentReuse — 재사용 직전의 판정', () => {
  it('지문이 같으면 재사용', () => {
    expect(decidePersistentReuse({ spawnedKey: 'k', wantKey: 'k', hasLiveBackgroundWork: false })).toBe('reuse');
  });

  it('스폰 때 지문을 모르면 재사용 — 멀쩡한 자식을 헛되이 다시 띄우지 않는다', () => {
    expect(decidePersistentReuse({ spawnedKey: undefined, wantKey: 'k', hasLiveBackgroundWork: false })).toBe('reuse');
  });

  it('지문이 다르고 배경 작업이 없으면 갈아 끼운다', () => {
    expect(decidePersistentReuse({ spawnedKey: 'old', wantKey: 'new', hasLiveBackgroundWork: false })).toBe('respawn');
  });

  it('지문이 달라도 배경 작업이 살아 있으면 내리지 않는다', () => {
    expect(decidePersistentReuse({ spawnedKey: 'old', wantKey: 'new', hasLiveBackgroundWork: true })).toBe('reuse-held');
  });
});

// ─── 실제 재사용 경로(`_executeViaLegacy`) — 판정이 배선돼 있는지 ───

type FakeStdin = {
  destroyed: boolean;
  writableEnded: boolean;
  writable: boolean;
  writes: string[];
  write: (chunk: string, encoding?: string) => boolean;
  setDefaultEncoding: () => FakeStdin;
  end: () => void;
  on: () => FakeStdin;
};

type FakeChild = {
  pid: undefined;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  stdin: FakeStdin;
  killed: string[];
  kill: (signal?: string) => boolean;
};

type Innards = {
  runningChildren: Map<string, FakeChild>;
  persistentChildReady: Map<string, boolean>;
  persistentInFlightCmd: Map<string, { cmd: { id: string } }>;
  persistentSpawnModelKey: Map<string, string>;
  persistentSpawnVerificationKey: Map<string, string>;
  intentionalKill: Set<string>;
  bgPromotedSubs: Set<string>;
  dispatchingSubs: Set<string>;
  _executeViaLegacy: (
    cmd: QueuedCommand,
    sub: { id: string; parentAgentId: string; lastActivityAt: number },
    parentCwd: string,
    prompt: string,
    configArgs: string[],
    maxTurns: number,
  ) => void;
};

function liveChild(): FakeChild {
  const stdin: FakeStdin = {
    destroyed: false,
    writableEnded: false,
    writable: true,
    writes: [],
    write(chunk: string) { this.writes.push(chunk); return true; },
    setDefaultEncoding() { return this; },
    end() { this.writableEnded = true; this.writable = false; },
    on() { return this; },
  };
  return {
    pid: undefined,
    exitCode: null,
    signalCode: null,
    stdin,
    killed: [],
    kill(signal?: string) { this.killed.push(signal ?? 'SIGTERM'); return true; },
  };
}

const SUB = 'sub-model-axes-1';
const AGENT = 'agent-model-axes';
const OPUS_ARGS = ['--model', 'opus[1m]', '--effort', 'xhigh'];
const SONNET_ARGS = ['--model', 'sonnet', '--effort', 'xhigh'];

function dispatchedCmd(id = 'cmd-next-turn'): QueuedCommand {
  return {
    id,
    text: '다음 턴',
    timestamp: Date.now(),
    subAgentId: SUB,
    status: 'executing',
    startedAt: Date.now(),
  };
}

function setup(spawnedArgs: string[] | null): { priv: Innards; child: FakeChild } {
  const m = new SubAgentManager();
  const priv = m as unknown as Innards;
  const child = liveChild();
  priv.runningChildren.set(SUB, child);
  priv.persistentChildReady.set(SUB, true);
  priv.dispatchingSubs.add(SUB);
  if (spawnedArgs) priv.persistentSpawnModelKey.set(SUB, modelAxesKeyOf(spawnedArgs));
  return { priv, child };
}

const sub = (): { id: string; parentAgentId: string; lastActivityAt: number } => ({ id: SUB, parentAgentId: AGENT, lastActivityAt: 0 });

describe('재사용 경로 — 모델을 바꿨으면 놀던 자식을 갈아 끼운다', () => {
  it('모델 축이 바뀌었으면 쓰지 않고 큐로 되돌린 뒤 자식을 의도된 종료로 내린다', () => {
    const { priv, child } = setup(OPUS_ARGS);
    const cmd = dispatchedCmd();

    priv._executeViaLegacy(cmd, sub(), 'C:\\tmp', '다음 턴', SONNET_ARGS, 0);

    // 옛 모델 자식에게 한 글자도 쓰지 않았다.
    expect(child.stdin.writes).toHaveLength(0);
    // 이 턴은 살아서 큐로 돌아간다 — 자식의 close 가 다음 차례에 `--resume` fresh spawn 으로 보낸다.
    expect(cmd.status).toBe('queued');
    expect(priv.persistentChildReady.has(SUB)).toBe(false);
    // 크래시로 읽히면 멀쩡한 세션이 error 로 물든다 — 의도된 종료 표식이 있어야 한다.
    expect(priv.intentionalKill.has(SUB)).toBe(true);
    // stdin.end() → SIGTERM (terminateChildTree). 그 뒤의 execute 는 창구 닫힘 가드가 큐로 돌린다.
    expect(child.stdin.writableEnded).toBe(true);
    expect(child.killed).toContain('SIGTERM');
    // 옛 지문은 버린다 — 새 자식이 뜨면 그 자리에서 다시 적힌다.
    expect(priv.persistentSpawnModelKey.has(SUB)).toBe(false);
  });

  it('모델 축이 같으면 종전대로 재사용한다', () => {
    const { priv, child } = setup(OPUS_ARGS);
    const cmd = dispatchedCmd();

    priv._executeViaLegacy(cmd, sub(), 'C:\\tmp', '다음 턴', [...OPUS_ARGS, '--tools', 'Read'], 0);

    expect(child.stdin.writes).toHaveLength(1);
    expect(cmd.status).toBe('executing');
    expect(priv.intentionalKill.has(SUB)).toBe(false);
    expect(child.killed).toHaveLength(0);
  });

  it('배경 작업이 살아 있으면 모델이 바뀌어도 내리지 않고 이 턴은 옛 자식으로 보낸다', () => {
    const { priv, child } = setup(OPUS_ARGS);
    priv.bgPromotedSubs.add(SUB);
    const cmd = dispatchedCmd();

    priv._executeViaLegacy(cmd, sub(), 'C:\\tmp', '다음 턴', SONNET_ARGS, 0);

    expect(child.stdin.writes).toHaveLength(1);
    expect(cmd.status).toBe('executing');
    expect(priv.intentionalKill.has(SUB)).toBe(false);
    expect(child.killed).toHaveLength(0);
  });

  it('스폰 때 지문이 없는 자식은 재사용한다', () => {
    const { priv, child } = setup(null);
    const cmd = dispatchedCmd();

    priv._executeViaLegacy(cmd, sub(), 'C:\\tmp', '다음 턴', SONNET_ARGS, 0);

    expect(child.stdin.writes).toHaveLength(1);
    expect(cmd.status).toBe('executing');
  });
});

describe('verification connection on existing Claude sessions', () => {
  const verificationArgs = [...OPUS_ARGS, '--mcp-config', '/app/mcp/verification.json', '--allowedTools', 'mcp__vibisual_verify'];

  it('reconnects an old idle child before submitting the verification command', () => {
    const { priv, child } = setup(OPUS_ARGS);
    const cmd = dispatchedCmd('cmd-verify');
    priv._executeViaLegacy(cmd, sub(), 'C:\\tmp', 'verify', verificationArgs, 0);
    expect(child.stdin.writes).toHaveLength(0);
    expect(cmd.status).toBe('queued');
    expect(priv.intentionalKill.has(SUB)).toBe(true);
    expect(child.stdin.writableEnded).toBe(true);
  });

  it('reuses a connected child across different verification run prompts', () => {
    const { priv, child } = setup(OPUS_ARGS);
    priv.persistentSpawnVerificationKey.set(SUB, '/app/mcp/verification.json');
    const cmd = dispatchedCmd('cmd-new-run');
    priv._executeViaLegacy(cmd, sub(), 'C:\\tmp', 'runId: run-second', verificationArgs, 0);
    expect(child.stdin.writes).toHaveLength(1);
    expect(child.stdin.writes[0]).toContain('run-second');
    expect(cmd.status).toBe('executing');
    expect(child.killed).toHaveLength(0);
  });

  it('preserves background work and reports unavailable tools instead of silently sending a text-only check', () => {
    const { priv, child } = setup(OPUS_ARGS);
    priv.bgPromotedSubs.add(SUB);
    const cmd = dispatchedCmd('cmd-verify-bg');
    priv._executeViaLegacy(cmd, sub(), 'C:\\tmp', 'verify', verificationArgs, 0);
    expect(child.stdin.writes).toHaveLength(0);
    expect(child.killed).toHaveLength(0);
    expect(child.stdin.writableEnded).toBe(false);
    expect(cmd.status).toBe('error');
    expect(cmd.result).toContain('live background work');
    expect(priv.dispatchingSubs.has(SUB)).toBe(false);
  });
});
