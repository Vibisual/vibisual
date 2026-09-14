/**
 * §5.5 #17-18 · §5.25 (F) — 코덱스 세션에서 [즉시] 덧말이 도는 턴을 끊고 이어 나가는지 고정한다.
 *
 * 사고 — GPT(코덱스) 에이전트의 대기 말풍선에서 [즉시]를 눌러도 턴이 안 끊기고 덧말이 계속 대기했다.
 * [즉시]는 `interruptForImmediateCommand`(index.ts)의 사다리(붙든 봉인 확정 → soft interrupt → `stop()`)를
 * 탄다. 코덱스 턴에는 앞 두 칸이 없어 `stop()` 까지 내려가고, `stop()` 이 true 면 라우트는 다시 dispatch
 * 하지 않는다 — 덧말이 나가는 길은 **끊긴 턴이 마감되며 부르는 `onComplete`** 하나뿐이다.
 * 그런데 러너가 `close` 하나만 기다렸고, 코덱스가 띄운 프로그램이 우리 stdout 파이프를 물려받은 채 트리
 * 밖에 남아 `close` 가 오지 않았다. 턴은 "실행 중"에 머물렀고 덧말은 그 뒤에서 기다렸다.
 *
 * 실제 `SubAgentManager` 와 실제 `attachCodexTurn` 에 가짜 자식만 물려, `close` 가 끝내 안 오는 모양에서
 * 사다리 → 마감 → 덧말 dispatch → 같은 대화 이어가기까지 한 줄로 본다. 러너의 마감 규칙 하나하나는
 * `codexTurnLifecycle.test.ts` 가 따로 고정한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import type { AgentConfig, QueuedCommand } from '@vibisual/shared';
import type { CodexTurnArgs } from './codexRunner.js';

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  constructor(readonly pid: number) { super(); }
  /** 본체 종료. 파이프는 그대로 둔다(물려받은 손자가 쥐고 있는 상황). */
  exit(code: number | null): void { this.emit('exit', code, null); }
  close(code: number | null): void { this.emit('close', code, null); }
  asChild(): ChildProcess { return this as unknown as ChildProcess; }
}

interface Turn { args: CodexTurnArgs; child: FakeChild }

/** 턴마다 새 가짜 자식 — 시험이 꺼내 `exit`·`close` 를 흉내 낸다. */
const turns: Turn[] = [];
/** 트리 종료 요청 기록. 가짜 pid 라 **실제 `killTree` 는 절대 부르지 않는다**(같은 번호의 남의 프로세스가 죽는다). */
const kills: (number | undefined)[] = [];
/** 트리 종료가 닿았을 때 자식의 반응 — 시험마다 정한다. 기본은 `exit` 조차 안 오는 것. */
let onKill: (child: FakeChild) => void = () => { /* test */ };

const EXIT_CLOSE_GRACE_MS = 40;
const STOP_SETTLE_TIMEOUT_MS = 120;

vi.mock('./codexRunner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./codexRunner.js')>();
  return {
    ...actual,
    // 스폰·실행본 탐색만 건너뛰고 턴 수명은 실제 러너 것을 쓴다 — `stopCodexTurn` 도 같은 턴 표식을 본다.
    runCodexTurn: (args: CodexTurnArgs): void => {
      const child = new FakeChild(900_000 + turns.length);
      turns.push({ args, child });
      actual.attachCodexTurn(child.asChild(), args, {
        exitCloseGraceMs: EXIT_CLOSE_GRACE_MS,
        stopSettleTimeoutMs: STOP_SETTLE_TIMEOUT_MS,
        killTree: (pid) => { kills.push(pid); onKill(child); },
      });
    },
  };
});

const { subAgentManager } = await import('./subAgentManager.js');
const { isCodexTurnRunning } = await import('./codexRunner.js');
const created: string[] = [];

function codexConfig(): AgentConfig {
  return {
    model: 'opus',
    tools: [],
    permissionMode: 'auto',
    skills: [],
    provider: { kind: 'codex-cli', modelId: 'gpt-5.3-codex' },
  } as AgentConfig;
}

function makeCommand(subAgentId: string, text: string): QueuedCommand {
  return {
    id: `cmd-${Math.random().toString(36).slice(2)}`,
    text,
    timestamp: Date.now(),
    status: 'queued',
    subAgentId,
  };
}

function run(cmd: QueuedCommand): void {
  subAgentManager.execute(cmd, process.cwd(), 'PROJECT CONTEXT', codexConfig(), 'LIVE CONTEXT', { customParent: true });
}

/** index.ts `interruptForImmediateCommand` 와 같은 순서 — 덜 죽이는 것부터 셋. */
function interruptForImmediate(subId: string): 'idle' | 'sealed' | 'soft' | 'stopped' | 'unstoppable' {
  if (!subAgentManager.isSubProcessingCommand(subId)) return 'idle';
  if (subAgentManager.sealHeldTurnNow(subId)) return 'sealed';
  if (subAgentManager.softInterrupt(subId)) return 'soft';
  return subAgentManager.stop(subId) ? 'stopped' : 'unstoppable';
}

/**
 * index.ts `setOnComplete` → `processNextCommand` 와 같은 일 — 끝난 명령이 세션을 비우면 큐의 다음 것을 보낸다.
 * 라우트가 `stop()` 성공 뒤 dispatch 를 하지 않으므로, 덧말은 **이 자리에서만** 나갈 수 있다.
 */
function dispatchOnComplete(current: QueuedCommand, followUp: QueuedCommand): () => number {
  let completions = 0;
  subAgentManager.setOnComplete(() => {
    completions += 1;
    if (current.status !== 'executing' && followUp.status === 'queued') run(followUp);
  });
  return () => completions;
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error(`condition not met within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const THREAD = '{"type":"thread.started","thread_id":"thread-immediate-1"}\n';
const PARTIAL = '{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"로그를 살펴보는 중입니다"}}\n';
const ANSWER = '{"type":"item.completed","item":{"id":"i2","type":"agent_message","text":"다가가면 표시가 뜨게 고쳤습니다"}}\n';
const TURN_END = '{"type":"turn.completed"}\n';

beforeEach(() => {
  turns.length = 0;
  kills.length = 0;
  onKill = () => { /* test */ };
  subAgentManager.setOnSubStatusChange(() => { /* test */ });
  subAgentManager.setOnComplete(() => { /* test */ });
});

afterEach(() => {
  // 실패한 시험이 턴을 문 채 끝나도 다음 시험을 오염시키지 않게 — 알림을 끊고 남은 자식을 전부 닫는다.
  subAgentManager.setOnComplete(() => { /* test */ });
  for (const turn of turns) turn.child.close(0);
  while (created.length > 0) {
    const id = created.pop();
    if (id) subAgentManager.remove(id);
  }
});

describe('코덱스 세션의 [즉시] 덧말', () => {
  it('사다리가 stop() 까지 내려가 턴을 끊고, close 가 끝내 안 와도 마감돼 덧말이 같은 대화로 이어 나간다', async () => {
    const sub = subAgentManager.create('agent-codex-immediate', 'sub-codex-immediate-exit');
    created.push(sub.id);
    const current = makeCommand(sub.id, '에디터를 띄워서 확인해 줘');
    const followUp = makeCommand(sub.id, '다가가면 표시가 떠야 하는데 안 나와');
    const completions = dispatchOnComplete(current, followUp);

    run(current);
    expect(turns).toHaveLength(1);
    const first = turns[0]!;
    first.child.stdout.write(THREAD);
    first.child.stdout.write(PARTIAL);
    await sleep(5);
    expect(sub.sessionId).toBe('thread-immediate-1');

    // 트리 종료로 본체는 죽지만(`exit`), 트리 밖으로 빠진 손자가 파이프를 쥐고 있어 `close` 는 안 온다.
    onKill = (child) => { setTimeout(() => child.exit(1), 5); };

    expect(interruptForImmediate(sub.id)).toBe('stopped');
    // 라우트는 여기서 dispatch 하지 않는다 — 덧말은 아직 대기이고, 끊긴 턴의 마감이 보내야 한다.
    expect(followUp.status).toBe('queued');

    await waitFor(() => completions() === 1, 2000);
    expect(kills).toEqual([first.child.pid]);
    expect(current.status).toBe('completed');
    expect(current.result?.startsWith('[Stopped by user]')).toBe(true);
    expect(current.result).toContain('로그를 살펴보는 중입니다');

    // 덧말이 곧바로 나갔고, 같은 코덱스 대화(thread)를 이어간다.
    expect(followUp.status).toBe('executing');
    expect(turns).toHaveLength(2);
    const second = turns[1]!;
    expect(second.args.resumeThreadId).toBe('thread-immediate-1');
    expect(second.args.prompt).toContain('다가가면 표시가 떠야 하는데 안 나와');
    expect(subAgentManager.isSubProcessingCommand(sub.id)).toBe(true);

    // 한참 뒤 손자가 끝나 옛 자식의 `close` 가 와도 새 턴 표식은 그대로다 — 새 턴도 [중지]·[즉시]로 멈출 수 있어야 한다.
    first.child.close(1);
    await sleep(EXIT_CLOSE_GRACE_MS + 20);
    expect(completions()).toBe(1);
    expect(followUp.status).toBe('executing');
    expect(isCodexTurnRunning(sub.id)).toBe(true);
    expect(subAgentManager.isSubProcessingCommand(sub.id)).toBe(true);

    // 덧말 턴은 평소대로 답을 싣고 끝난다.
    second.child.stdout.write(ANSWER);
    second.child.stdout.write(TURN_END);
    await sleep(5);
    second.child.exit(0);
    second.child.close(0);
    await waitFor(() => completions() === 2, 2000);
    expect(followUp.status).toBe('completed');
    expect(followUp.result).toBe('다가가면 표시가 뜨게 고쳤습니다');
    expect(isCodexTurnRunning(sub.id)).toBe(false);
    expect(subAgentManager.isSubProcessingCommand(sub.id)).toBe(false);
  });

  it('트리 종료가 빗나가 exit 조차 안 오면 시한 뒤 한 번 더 종료를 보내고 마감해 덧말을 보낸다', async () => {
    const sub = subAgentManager.create('agent-codex-immediate', 'sub-codex-immediate-noexit');
    created.push(sub.id);
    const current = makeCommand(sub.id, '빌드를 돌려 줘');
    const followUp = makeCommand(sub.id, '빌드는 멈추고 이것부터 봐 줘');
    const completions = dispatchOnComplete(current, followUp);

    run(current);
    const first = turns[0]!;

    expect(interruptForImmediate(sub.id)).toBe('stopped');
    await waitFor(() => completions() === 1, 2000);

    // 두 번째 종료는 "시한 안에 exit 도 없었다"는 마감 경로에서만 나간다.
    expect(kills).toEqual([first.child.pid, first.child.pid]);
    expect(current.status).toBe('completed');
    expect(current.result).toBe('[Stopped by user]');
    expect(followUp.status).toBe('executing');
    expect(turns).toHaveLength(2);
    expect(turns[1]!.args.prompt).toContain('빌드는 멈추고 이것부터 봐 줘');
  });
});
