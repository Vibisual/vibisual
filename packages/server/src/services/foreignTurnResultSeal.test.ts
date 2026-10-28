import { describe, it, expect, vi, afterEach } from 'vitest';
import type { QueuedCommand, SubAgent } from '@vibisual/shared';
import { SubAgentManager } from './subAgentManager.js';
import { EARLY_RESULT_SAFETY_MS } from './turnSeal.js';

/**
 * §5.5 #17-18 ⑩-1/⑩-5 — 남의 턴(되살아난 턴·밀린 통지)의 `result` 로 지금 명령을 봉인하지 않는다(답 없는 완료·엉뚱한 답 저장).
 * 판정 축은 `currentTurnId` 도장 · 도장이 비면 예전 판정 · 주인 미확인 본문은 `cmd.result` 에 싣지 않고 안전 마감이 닫는다.
 */

type FakeStdin = {
  destroyed: boolean;
  writableEnded: boolean;
  writable: boolean;
  writes: string[];
  write: (chunk: string) => boolean;
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
  earlyResultForeign?: boolean;
};

type Innards = {
  runningChildren: Map<string, FakeChild>;
  persistentChildReady: Map<string, boolean>;
  persistentLineBuf: Map<string, string>;
  persistentInFlightCmd: Map<string, InFlight>;
  currentTurnId: Map<string, string>;
  _handlePersistentStdoutLine: (line: string, sub: SubAgent, child: FakeChild) => void;
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

const AGENT = 'agent-foreign-turn';
const SUB = 'sub-foreign-turn-1';
const CWD = 'C:\tmp';
const MINE = 'cmd-mine';
const THEIRS = 'cmd-theirs';

/** persistent 자식 하나가 `MINE` 을 처리 중인 순간을 세운다(스폰 경로가 세우는 장부 그대로). */
function setupInFlight() {
  const m = new SubAgentManager();
  const priv = m as unknown as Innards;
  const onComplete = vi.fn();
  m.setOnComplete(onComplete);
  m.setOnSubStatusChange(vi.fn());
  const sub = m.create(AGENT, SUB);
  sub.status = 'active';
  const child = liveChild();
  const cmd: QueuedCommand = {
    id: MINE, text: '내 질문', timestamp: Date.now(), subAgentId: SUB, status: 'executing', startedAt: Date.now(),
  };
  priv.runningChildren.set(sub.id, child);
  priv.persistentLineBuf.set(sub.id, '');
  priv.persistentChildReady.set(sub.id, false);
  priv.persistentInFlightCmd.set(sub.id, {
    cmd, turnCount: 0, resultText: undefined, killed: false, maxTurns: 0, parentCwd: CWD, mainActivity: false,
  });
  const feed = (obj: Record<string, unknown>): void => priv._handlePersistentStdoutLine(JSON.stringify(obj), sub, child);
  const stamp = (id: string | undefined): void => {
    if (id === undefined) priv.currentTurnId.delete(SUB);
    else priv.currentTurnId.set(SUB, id);
  };
  return { m, priv, sub, child, cmd, onComplete, feed, stamp };
}

const ASSISTANT = { type: 'assistant', message: { content: [] } };
const result = (text: string): Record<string, unknown> => ({ type: 'result', subtype: 'success', result: text });

afterEach(() => { vi.useRealTimers(); });

describe('턴 세대 도장 — 남의 result 가 내 명령을 봉인하지 못한다 (B-1)', () => {
  it('이미 말을 한 뒤라도 남의 도장이 찍힌 result 는 내 끝이 아니다 — 가장 중요한 한 줄', () => {
    vi.useFakeTimers();
    const { cmd, onComplete, feed, stamp } = setupInFlight();

    // ① 내 턴이 돌며 말을 시작한다 — 종전 판정의 빗장(mainActivity)이 올라가는 자리.
    stamp(MINE);
    feed(ASSISTANT);

    // ② 그 사이 세션이 다른 턴을 시작했다(되살아난 턴·밀린 통지 처리). 도장이 넘어간다.
    stamp(THEIRS);
    feed(result('남의 턴이 낸 끝'));

    // 남의 턴 `result` 로 봉인되면 안 된다.
    expect(cmd.status).toBe('executing');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('남의 턴이 뱉은 모델 줄은 내가 말했다는 증거가 아니다 — 빗장을 올리지 않는다', () => {
    vi.useFakeTimers();
    const { cmd, onComplete, feed, stamp } = setupInFlight();

    stamp(THEIRS);
    feed(ASSISTANT);
    feed(result('남의 답'));

    expect(cmd.status).toBe('executing');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('내 도장이면 예전처럼 그 자리에서 봉인한다 — 정상 턴이 늦어지지 않는다', () => {
    const { cmd, onComplete, feed, stamp } = setupInFlight();

    stamp(MINE);
    feed(ASSISTANT);
    feed(result('내 답'));

    expect(cmd.status).toBe('completed');
    expect(cmd.result).toBe('내 답');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('도장이 비어 있으면 옛 판정 그대로 — 마감 뒤 여운에 새 주인을 만들지 않는다', () => {
    const { cmd, feed, stamp } = setupInFlight();

    stamp(undefined);
    feed(ASSISTANT);
    feed(result('도장 없는 답'));

    expect(cmd.status).toBe('completed');
    expect(cmd.result).toBe('도장 없는 답');
  });
});

describe('주인 없는 본문 — 남의 답을 내 결과로 싣지 않는다 (B-2)', () => {
  it('남의 도장이 찍힌 본문은 안전 마감이 닫을 때도 싣지 않는다 — 명령은 닫히되 답은 비운다', () => {
    vi.useFakeTimers();
    const { cmd, onComplete, feed, stamp } = setupInFlight();

    stamp(THEIRS);
    feed(result('남의 턴이 낸 긴 답'));
    expect(cmd.status).toBe('executing');

    // 끝내 내 말이 없으면 안전 마감이 명령을 닫는다 — 좀비로 남기지 않는 쪽이 먼저다.
    vi.advanceTimersByTime(EARLY_RESULT_SAFETY_MS);
    expect(cmd.status).toBe('completed');
    expect(onComplete).toHaveBeenCalledTimes(1);
    // 그러나 본문은 내 것이 아니다. (JSONL 폴백이 찾아내면 그게 실리고, 없으면 빈다.)
    expect(cmd.result).not.toBe('남의 턴이 낸 긴 답');
    expect(cmd.result).toBeUndefined();
  });

  it('내 도장인데 말이 없었을 뿐이면 그 본문은 내 것이다 — 훅이 막은 턴의 답은 지킨다', () => {
    vi.useFakeTimers();
    const { cmd, feed, stamp } = setupInFlight();

    stamp(MINE);
    feed(result('훅이 막아 말이 없던 턴의 답'));
    expect(cmd.status).toBe('executing');

    vi.advanceTimersByTime(EARLY_RESULT_SAFETY_MS);
    expect(cmd.status).toBe('completed');
    expect(cmd.result).toBe('훅이 막아 말이 없던 턴의 답');
  });
});
