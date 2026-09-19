import { describe, it, expect, vi, afterEach } from 'vitest';
import type { QueuedCommand, SubAgent } from '@vibisual/shared';
import { SubAgentManager } from './subAgentManager.js';
import {
  isMainThreadModelLine, isResultBeforeOwnTurn, EARLY_RESULT_SAFETY_MS, TURN_RESUME_GRACE_MS,
  type TurnSealState,
} from './turnSeal.js';

/**
 * §5.5 #17-18 — **[중지] 뒤에 친 입력이 완료음과 함께 끝나 버리고, 한참 뒤에야 실제로 돈다.**
 *
 * 사용자 보고 그대로의 사슬이다 —
 *   ① [중지]의 마감이 자식의 `close` 에만 걸려 있었다. Windows 는 손자가 파이프를 쥐고 있어 그 `close` 가
 *      늦게 오고, 그동안 화면은 중지가 안 된 채 도는 중이었다.
 *   ② 그 사이 친 새 입력은 옛 자식 뒤에 줄을 섰다가, `--resume` 으로 뜬 자식이 밀린 통지를 먼저 처리하고
 *      낸 `result` 에 **자기 끝으로 봉인됐다**(완료음). 진짜 답은 그 뒤에 세션을 다시 깨웠다.
 *   ③ 곁가지(서브에이전트 안쪽) 줄이 붙든 봉인을 풀어, 끝난 명령이 `executing` 으로 남기도 했다.
 *
 * 여기서 고정하는 약속 —
 *   · 이 명령이 한 마디도 하기 전에 온 `result` 는 이 명령의 끝이 아니다(안전 마감은 따로 있다).
 *   · 본 대화의 토큰 줄(`stream_event`)도 "말하기 시작했다"로 센다. 곁가지 줄은 세지 않는다.
 *   · [중지]는 `close` 를 기다리지 않고 그 자리에서 `[Stopped by user]` 로 마감하고, 중지 표식을 소진한다.
 *   · 내려가는 자식에게 온 새 입력은 큐로 돌아가고 세션 점도 되돌린다.
 */

// ─── 순수 판정 ───

describe('isMainThreadModelLine — 본 대화의 모델 줄만 센다', () => {
  it('완성 줄(assistant)과 토큰 줄(stream_event)은 본 대화면 센다', () => {
    expect(isMainThreadModelLine({ type: 'assistant', message: { content: [] } })).toBe(true);
    expect(isMainThreadModelLine({ type: 'stream_event', event: { type: 'message_start' } })).toBe(true);
    // CLI 는 본 대화에 `parent_tool_use_id: null` 을 싣는다.
    expect(isMainThreadModelLine({ type: 'assistant', parent_tool_use_id: null })).toBe(true);
  });

  it('곁가지(서브에이전트 안쪽) 줄은 세지 않는다', () => {
    expect(isMainThreadModelLine({ type: 'assistant', parent_tool_use_id: 'toolu_01' })).toBe(false);
    expect(isMainThreadModelLine({ type: 'stream_event', parent_tool_use_id: 'toolu_01' })).toBe(false);
  });

  it('모델 줄이 아니면 세지 않는다', () => {
    for (const type of ['result', 'system', 'user', 'control_response', undefined]) {
      expect(isMainThreadModelLine({ type })).toBe(false);
    }
  });
});

describe('isResultBeforeOwnTurn — 활동 없이 온 result 만 "아직 제 차례 전"이다', () => {
  const quiet = { mainActivity: false, cliError: false, killed: false, interrupted: false, slashCommand: false };

  it('아무 활동도, 아무 사유도 없으면 제 차례 전의 끝이다', () => {
    expect(isResultBeforeOwnTurn(quiet)).toBe(true);
  });

  it('모델 줄이 하나라도 왔으면 제 끝이다', () => {
    expect(isResultBeforeOwnTurn({ ...quiet, mainActivity: true })).toBe(false);
  });

  it('실패 신고·최대 턴·인터럽트·슬래시 통과 턴은 말이 없어도 제 끝이다', () => {
    expect(isResultBeforeOwnTurn({ ...quiet, cliError: true })).toBe(false);
    expect(isResultBeforeOwnTurn({ ...quiet, killed: true })).toBe(false);
    expect(isResultBeforeOwnTurn({ ...quiet, interrupted: true })).toBe(false);
    expect(isResultBeforeOwnTurn({ ...quiet, slashCommand: true })).toBe(false);
  });
});

// ─── 매니저 배선 ───

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
  once: () => FakeChild;
};

type InFlight = {
  cmd: QueuedCommand;
  turnCount: number;
  resultText: string | undefined;
  killed: boolean;
  maxTurns: number;
  parentCwd: string;
  mainActivity: boolean;
  interrupted?: boolean;
  earlyResultTimer?: ReturnType<typeof setTimeout>;
};

type Innards = {
  runningChildren: Map<string, FakeChild>;
  persistentChildReady: Map<string, boolean>;
  persistentLineBuf: Map<string, string>;
  persistentInFlightCmd: Map<string, InFlight>;
  deferredSeals: Map<string, unknown>;
  stoppedByUser: Set<string>;
  intentionalKill: Set<string>;
  bgPromotedSubs: Set<string>;
  getTurnSealState: (subAgentId: string) => TurnSealState;
  _handlePersistentStdoutLine: (line: string, sub: SubAgent, child: FakeChild) => void;
  _executeViaLegacy: (
    cmd: QueuedCommand,
    sub: SubAgent,
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
    once() { return this; },
  };
}

const AGENT = 'agent-stop-then-input';
const SUB = 'sub-stop-then-input-1';
const CWD = 'C:\\tmp';

function cmdOf(id: string, text = '새 입력'): QueuedCommand {
  return { id, text, timestamp: Date.now(), subAgentId: SUB, status: 'executing', startedAt: Date.now() };
}

/** persistent 자식 하나가 `cmd` 를 처리 중인 순간을 세운다(스폰 경로가 세우는 장부 그대로). */
function setupInFlight(opts: { persistent?: boolean } = {}) {
  const m = new SubAgentManager();
  const priv = m as unknown as Innards;
  const onComplete = vi.fn();
  const onStatus = vi.fn();
  m.setOnComplete(onComplete);
  m.setOnSubStatusChange(onStatus);
  const sub = m.create(AGENT, SUB);
  sub.status = 'active';
  const child = liveChild();
  const cmd = cmdOf('cmd-after-stop');
  priv.runningChildren.set(sub.id, child);
  if (opts.persistent !== false) {
    priv.persistentLineBuf.set(sub.id, '');
    priv.persistentChildReady.set(sub.id, false);
    priv.persistentInFlightCmd.set(sub.id, {
      cmd, turnCount: 0, resultText: undefined, killed: false, maxTurns: 0, parentCwd: CWD, mainActivity: false,
    });
  }
  const feed = (obj: Record<string, unknown>): void => priv._handlePersistentStdoutLine(JSON.stringify(obj), sub, child);
  return { m, priv, sub, child, cmd, onComplete, onStatus, feed };
}

/** 내용 없는 모델 줄 — 버퍼·디스크에 아무것도 남기지 않고 "말하기 시작했다"만 알린다. */
const ASSISTANT = { type: 'assistant', message: { content: [] } };
const TOKEN = { type: 'stream_event', event: { type: 'content_block_delta' } };
const NESTED_ASSISTANT = { type: 'assistant', parent_tool_use_id: 'toolu_nested', message: { content: [] } };
const NESTED_TOKEN = { type: 'stream_event', parent_tool_use_id: 'toolu_nested', event: { type: 'content_block_delta' } };
const result = (text: string): Record<string, unknown> => ({ type: 'result', subtype: 'success', result: text });

afterEach(() => {
  vi.useRealTimers();
});

describe('활동 없이 온 result — 새 입력을 봉인하지 않는다', () => {
  it('명령이 한 마디도 하기 전에 온 result 는 그 명령의 끝이 아니다 — 진짜 답의 result 가 봉인한다', () => {
    const { priv, cmd, onComplete, feed } = setupInFlight();

    // `--resume` 으로 뜬 자식이 밀린 통지를 먼저 처리하고 낸 끝.
    feed(result('백그라운드 작업이 끝났습니다.'));
    expect(cmd.status).toBe('executing');
    expect(onComplete).not.toHaveBeenCalled();
    expect(priv.persistentInFlightCmd.get(SUB)?.cmd).toBe(cmd);

    // 그 뒤 이 명령의 진짜 턴.
    feed(ASSISTANT);
    feed(result('진짜 답'));
    expect(cmd.status).toBe('completed');
    expect(cmd.result).toBe('진짜 답');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(priv.persistentInFlightCmd.has(SUB)).toBe(false);
    expect(priv.persistentChildReady.get(SUB)).toBe(true);
  });

  it('끝내 아무 말이 없으면 안전 마감이 봉인한다 — 명령이 영영 executing 으로 남지 않는다', () => {
    vi.useFakeTimers();
    const { cmd, onComplete, feed } = setupInFlight();

    feed(result('말 없는 끝'));
    vi.advanceTimersByTime(EARLY_RESULT_SAFETY_MS - 1);
    expect(cmd.status).toBe('executing');

    vi.advanceTimersByTime(1);
    expect(cmd.status).toBe('completed');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('안전 마감을 건 뒤 모델 줄이 오면 그 마감은 거둔다 — 진짜 끝 하나로만 닫힌다', () => {
    vi.useFakeTimers();
    const { cmd, onComplete, feed } = setupInFlight();

    feed(result('통지 처리 끝'));
    feed(TOKEN);
    vi.advanceTimersByTime(EARLY_RESULT_SAFETY_MS * 2);
    expect(cmd.status).toBe('executing');
    expect(onComplete).not.toHaveBeenCalled();

    feed(result('진짜 답'));
    expect(cmd.status).toBe('completed');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('본 대화의 토큰 줄(stream_event)도 "말하기 시작했다"로 센다', () => {
    const { cmd, feed } = setupInFlight();
    feed(TOKEN);
    feed(result('답'));
    expect(cmd.status).toBe('completed');
  });

  it('곁가지 줄은 이 명령의 말이 아니다 — 그 뒤의 result 는 여전히 제 차례 전이다', () => {
    const { cmd, feed } = setupInFlight();
    feed(NESTED_TOKEN);
    feed(NESTED_ASSISTANT);
    feed(result('곁가지가 끝났을 뿐'));
    expect(cmd.status).toBe('executing');
  });

  it('인터럽트를 보낸 명령은 말이 없어도 그 result 로 끝난다', () => {
    vi.useFakeTimers();
    const { m, cmd, child, feed } = setupInFlight();

    expect(m.softInterrupt(SUB)).toBe(true);
    expect(child.stdin.writes).toHaveLength(1);
    feed(result(''));
    expect(cmd.status).toBe('completed');
  });

  it('CLI 가 실패로 신고한 result 는 말이 없어도 그 명령의 끝이다', () => {
    const { priv, cmd, onComplete, feed } = setupInFlight();
    feed({ type: 'result', subtype: 'error_during_execution', is_error: true, result: '' });
    expect(cmd.status).not.toBe('executing');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(priv.persistentInFlightCmd.has(SUB)).toBe(false);
  });

  it('슬래시 통과 턴(모델이 말하지 않는 턴)은 첫 result 로 끝난다', () => {
    const { priv, cmd, feed } = setupInFlight();
    cmd.text = '/compact';
    priv.persistentInFlightCmd.get(SUB)!.cmd.text = '/compact';
    feed(result(''));
    expect(cmd.status).toBe('completed');
  });
});

describe('붙든 봉인 — 본 대화만 풀고 곁가지는 풀지 않는다', () => {
  /** 밀린 통지가 있어 끝을 잠정으로 붙든 상태를 만든다. */
  function heldSeal() {
    vi.useFakeTimers();
    const ctx = setupInFlight();
    ctx.priv.getTurnSealState(SUB).deliveredNotices = 1;
    ctx.feed(ASSISTANT);
    ctx.feed(result('답'));
    expect(ctx.priv.deferredSeals.has(SUB)).toBe(true);
    expect(ctx.cmd.status).toBe('executing');
    return ctx;
  }

  it('곁가지 줄은 붙든 봉인을 풀지 않는다 — 유예가 끝나면 그대로 봉인된다', () => {
    const { priv, cmd, onComplete, feed } = heldSeal();

    feed(NESTED_TOKEN);
    feed(NESTED_ASSISTANT);
    expect(priv.deferredSeals.has(SUB)).toBe(true);

    vi.advanceTimersByTime(TURN_RESUME_GRACE_MS);
    expect(cmd.status).toBe('completed');
    expect(cmd.result).toBe('답');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('본 대화의 토큰 줄은 파싱된 이벤트가 되기 전에도 붙든 봉인을 푼다', () => {
    const { priv, cmd, onComplete, feed } = heldSeal();

    feed(TOKEN);
    expect(priv.deferredSeals.has(SUB)).toBe(false);
    vi.advanceTimersByTime(TURN_RESUME_GRACE_MS * 2);
    expect(cmd.status).toBe('executing');
    expect(onComplete).not.toHaveBeenCalled();

    // 이어진 턴의 끝이 진짜 끝이다(밀린 통지는 그 턴이 받아 갔다).
    feed(result('이어진 답'));
    expect(cmd.status).toBe('completed');
    expect(cmd.result).toBe('이어진 답');
  });
});

describe('[중지] — close 를 기다리지 않고 그 자리에서 마감한다', () => {
  it('처리 중인 persistent 턴은 즉시 [Stopped by user] 로 닫히고 세션은 쉰다', () => {
    const { m, priv, sub, child, cmd, onComplete, onStatus } = setupInFlight();

    expect(m.stop(SUB)).toBe(true);

    expect(cmd.status).toBe('completed');
    expect(cmd.result?.startsWith('[Stopped by user]')).toBe(true);
    expect(sub.status).toBe('idle');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalled();
    // 뒤늦은 close 는 in-flight 가 비어 있어 세션만 쉬게 한다.
    expect(priv.persistentInFlightCmd.has(SUB)).toBe(false);
    expect(priv.persistentChildReady.has(SUB)).toBe(false);
    // close 핸들러가 크래시로 읽지 않게 의도된 종료 표식은 남긴다.
    expect(priv.intentionalKill.has(SUB)).toBe(true);
    // 중지 표식은 여기서 소진 — 다음 명령의 끝을 잘못 닫지 않게.
    expect(priv.stoppedByUser.has(SUB)).toBe(false);
    // 트리 종료는 창구부터 닫는다(재사용 경로가 그걸 보고 내려가는 자식을 알아본다).
    expect(child.stdin.writableEnded).toBe(true);
    expect(child.killed.length).toBeGreaterThan(0);
  });

  it('활동 없는 result 로 안전 마감이 걸려 있어도 중지 한 번으로만 닫힌다', () => {
    vi.useFakeTimers();
    const { m, cmd, onComplete, feed } = setupInFlight();

    feed(result('통지 처리 끝'));
    m.stop(SUB);
    expect(cmd.result?.startsWith('[Stopped by user]')).toBe(true);
    vi.advanceTimersByTime(EARLY_RESULT_SAFETY_MS * 2);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('붙든 봉인이 있으면 그 봉인이 곧 마감이다 — 이미 온 답을 버리지 않는다', () => {
    vi.useFakeTimers();
    const { m, priv, cmd, onComplete, feed } = setupInFlight();
    priv.getTurnSealState(SUB).deliveredNotices = 1;
    feed(ASSISTANT);
    feed(result('이미 온 답'));
    expect(priv.deferredSeals.has(SUB)).toBe(true);

    m.stop(SUB);
    expect(priv.deferredSeals.has(SUB)).toBe(false);
    expect(cmd.status).toBe('completed');
    expect(cmd.result).toBe('[Stopped by user]\n\n이미 온 답');
    // 봉인이 다음 턴을 위해 세운 준비 표식은 끊긴 자식에겐 거짓이다.
    expect(priv.persistentChildReady.has(SUB)).toBe(false);
    vi.advanceTimersByTime(TURN_RESUME_GRACE_MS * 2);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('놀던 자식을 멈춰도 중지 표식이 남지 않는다 — 다음 명령이 [Stopped by user] 로 닫히지 않게', () => {
    const { m, priv, sub, onComplete } = setupInFlight();
    priv.persistentInFlightCmd.delete(SUB);
    priv.persistentChildReady.set(SUB, true);

    expect(m.stop(SUB)).toBe(true);
    expect(priv.stoppedByUser.has(SUB)).toBe(false);
    expect(onComplete).not.toHaveBeenCalled();
    expect(sub.status).toBe('active'); // 쉬게 하기는 close 의 몫(마감할 턴이 없었다)
  });

  it('stopAll 도 같은 자리에서 마감한다', () => {
    const { m, priv, cmd, onComplete } = setupInFlight();

    expect(m.stopAll(AGENT)).toEqual([SUB]);
    expect(cmd.result?.startsWith('[Stopped by user]')).toBe(true);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(priv.stoppedByUser.has(SUB)).toBe(false);
  });

  it('legacy(--print) 자식은 건드리지 않는다 — 그 마감은 close 가 쌓은 stdout 을 읽어야 한다', () => {
    const { m, priv, cmd, onComplete } = setupInFlight({ persistent: false });

    expect(m.stop(SUB)).toBe(true);
    expect(cmd.status).toBe('executing');
    expect(onComplete).not.toHaveBeenCalled();
    // close 핸들러가 읽을 표식은 그대로 남는다.
    expect(priv.stoppedByUser.has(SUB)).toBe(true);
  });
});

describe('[중지] 뒤의 새 입력 — 내려가는 자식에게 쓰지 않고 큐로 돌아간다', () => {
  it('창구가 닫힌 자식이면 큐로 되돌리고 세션 점도 되돌린다', () => {
    const { m, priv, sub, child, onStatus } = setupInFlight();
    m.stop(SUB);
    const writesBefore = child.stdin.writes.length;
    onStatus.mockClear();

    const next = cmdOf('cmd-typed-after-stop');
    sub.status = 'active'; // execute 가 올려 둔 상태
    priv._executeViaLegacy(next, sub, CWD, '새 입력', [], 0);

    expect(next.status).toBe('queued');
    expect(next.startedAt).toBeUndefined();
    expect(child.stdin.writes.length).toBe(writesBefore);
    expect(sub.status).toBe('idle');
    expect(onStatus).toHaveBeenCalledWith(AGENT);
  });

  it('백그라운드 작업이 올려 둔 active 는 그 장부의 몫이라 건드리지 않는다', () => {
    const { m, priv, sub } = setupInFlight();
    m.stop(SUB);
    priv.bgPromotedSubs.add(SUB);

    const next = cmdOf('cmd-typed-after-stop');
    sub.status = 'active';
    priv._executeViaLegacy(next, sub, CWD, '새 입력', [], 0);

    expect(next.status).toBe('queued');
    expect(sub.status).toBe('active');
  });
});
