import { describe, it, expect, vi, afterEach } from 'vitest';
import type { QueuedCommand, SubAgent, SubAgentStreamEvent } from '@vibisual/shared';
import { SubAgentManager } from './subAgentManager.js';
import { NOTICE_RESUME_WINDOW_MS, TURN_RESUME_GRACE_MS } from './turnSeal.js';
import { logger } from '../logger.js';

/**
 * §5.5 #17-9 ⑱ — **끝 통지는 "끝"이 아니라 "곧 다시 돈다"다.**
 *
 * 사용자 보고(`/release` 탭): "여기서 지금 작업이 안 끝났는데 왜 작업 끝남 알림이 울리냐". 실측 사슬 —
 *   · 본 턴이 백그라운드 `Explore` 자식을 띄우고 끝났다. 탭은 자식 덕에 계속 "도는 중"(§5.3 #12-1 승격).
 *   · 25분 뒤 그 자식의 끝 칩이 왔다. 장부가 비자 `syncBgSubStatus` 가 탭을 **그 자리에서** idle 로 내렸고,
 *     버블이 `completed` 로 넘어가 완료음이 울렸다.
 *   · 그러나 CLI 는 그 통지로 3ms 만에 새 턴을 열었다. 첫 모델 줄이 stdout 에 온 것은 24초 뒤다.
 *
 * 고정하는 약속 —
 *   · 쉬는 persistent 자식에 온 끝 칩은 탭을 내리지 않고 붙든다. 푸는 것은 되살아난 턴의 첫 모델 줄이다.
 *   · 풀 때 승격 표식도 함께 걷는다 — 탭은 `active` 그대로 그 턴을 돌고, 그 턴의 끝에서 **한 번만** 잠든다.
 *   · 상한(90초)이 지나도 모델 줄이 없으면 종전처럼 내린다. 명령 처리 중이거나 쉬는 자식이 없으면 종전 그대로.
 *   · 봉인 유예 중에 온 끝 칩은 그 유예를 90초로 늘린다.
 *   · 자식이 둘이면 첫 통지 턴이 끝나도 탭은 `active` 로 남아 남은 자식의 끝 칩도 붙든다(⑱(e)).
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
};

type Innards = {
  runningChildren: Map<string, FakeChild>;
  persistentChildReady: Map<string, boolean>;
  persistentLineBuf: Map<string, string>;
  persistentInFlightCmd: Map<string, InFlight>;
  deferredSeals: Map<string, unknown>;
  noticeResumeHolds: Map<string, ReturnType<typeof setTimeout>>;
  bgPromotedSubs: Set<string>;
  _handlePersistentStdoutLine: (line: string, sub: SubAgent, child: FakeChild) => void;
  noteTurnSealSignal: (event: SubAgentStreamEvent) => void;
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

const AGENT = 'agent-notice-resume';
const SUB = 'sub-notice-resume-1';
const CWD = 'C:\\tmp';

/** 내용 없는 모델 줄 — 버퍼·디스크에 아무것도 남기지 않고 "말하기 시작했다"만 알린다. */
const ASSISTANT = { type: 'assistant', message: { content: [] } };
/** 되살아난 턴의 첫 줄(`--include-partial-messages` 라 첫 토큰이 곧 이 줄이다). */
const FIRST_TOKEN = { type: 'stream_event', event: { type: 'message_start' } };
const NESTED_TOKEN = { type: 'stream_event', parent_tool_use_id: 'toolu_nested', event: { type: 'content_block_delta' } };
const NESTED_ASSISTANT = { type: 'assistant', parent_tool_use_id: 'toolu_nested', message: { content: [] } };
const result = (text: string): Record<string, unknown> => ({ type: 'result', subtype: 'success', result: text });

function parsedEvent(eventType: SubAgentStreamEvent['eventType'], extra: Partial<SubAgentStreamEvent> = {}): SubAgentStreamEvent {
  return { id: `evt-${eventType}`, subAgentId: SUB, parentAgentId: AGENT, timestamp: Date.now(), eventType, content: '', ...extra };
}

/** persistent 자식 하나를 가진 탭. `seen` 은 상태 통지(`onSubStatusChange`)가 밖으로 알린 탭 상태 — 버블 재계산이 읽는 값이다. */
function setup(opts: { child?: boolean } = {}) {
  const m = new SubAgentManager();
  const priv = m as unknown as Innards;
  const onComplete = vi.fn();
  m.setOnComplete(onComplete);
  const sub = m.create(AGENT, SUB);
  const seen: string[] = [];
  m.setOnSubStatusChange(() => { seen.push(sub.status); });
  sub.status = 'active';
  const child = liveChild();
  if (opts.child !== false) {
    priv.runningChildren.set(SUB, child);
    priv.persistentLineBuf.set(SUB, '');
    priv.persistentChildReady.set(SUB, true);
  }
  const feed = (obj: Record<string, unknown>): void => priv._handlePersistentStdoutLine(JSON.stringify(obj), sub, child);
  const startTask = (id: string): void => m.noteStreamTaskChip(SUB, 'task_started', { id, description: `Explore ${id}`, subagentType: 'Explore' });
  const endTask = (id: string): void => m.noteStreamTaskChip(SUB, 'task_notification', { id, status: 'completed', summary: '조사 끝' });
  return { m, priv, sub, child, onComplete, seen, feed, startTask, endTask };
}

type Ctx = ReturnType<typeof setup>;

/** 자식이 `cmd` 를 처리 중인 순간을 세운다(스폰 경로가 세우는 장부 그대로). */
function beginCommand(ctx: Ctx): QueuedCommand {
  const cmd: QueuedCommand = {
    id: 'cmd-release', text: '릴리스 진행해 줘', timestamp: Date.now(), subAgentId: SUB, status: 'executing', startedAt: Date.now(),
  };
  ctx.priv.persistentChildReady.set(SUB, false);
  ctx.priv.persistentInFlightCmd.set(SUB, {
    cmd, turnCount: 0, resultText: undefined, killed: false, maxTurns: 0, parentCwd: CWD, mainActivity: false,
  });
  return cmd;
}

/** 보고된 사슬의 앞부분 — 본 턴이 백그라운드 자식을 띄우고 끝났다. 탭은 자식 덕에 계속 "도는 중"이다. */
function mainTurnSpawnsChildrenAndEnds(ctx: Ctx, taskIds: string[] = ['t1']): QueuedCommand {
  const cmd = beginCommand(ctx);
  ctx.feed(ASSISTANT);
  for (const id of taskIds) ctx.startTask(id);
  ctx.feed(result('백그라운드로 조사를 맡겼습니다'));
  // 자식이 살아 있어 끝은 잠정이다 — 유예가 지나 봉인된다.
  vi.advanceTimersByTime(TURN_RESUME_GRACE_MS);
  expect(cmd.status).toBe('completed');
  expect(ctx.priv.persistentChildReady.get(SUB)).toBe(true);
  expect(ctx.sub.status).toBe('active');
  expect(ctx.priv.bgPromotedSubs.has(SUB)).toBe(true);
  return cmd;
}

/** 쉬는 탭에 끝 칩이 와서 붙들린 순간. */
function heldAfterNotice(): Ctx {
  vi.useFakeTimers();
  const ctx = setup();
  mainTurnSpawnsChildrenAndEnds(ctx);
  ctx.seen.length = 0;
  ctx.endTask('t1');
  // 종전 코드는 여기서 떨어진다 — 탭이 idle 로 내려가고 버블이 completed(완료음)로 넘어갔다.
  expect(ctx.sub.status).toBe('active');
  expect(ctx.seen).not.toContain('idle');
  expect(ctx.priv.noticeResumeHolds.has(SUB)).toBe(true);
  return ctx;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('쉬는 탭에 온 끝 통지 — 되살아난 턴의 끝까지 내리지 않는다', () => {
  it('보고된 사슬 그대로 — 끝 칩에 탭이 내려가지 않고, 되살아난 턴의 끝에서 한 번만 잠든다', () => {
    const { priv, sub, seen, feed } = heldAfterNotice();

    // 첫 토큰까지 24초 — 종전에는 이 사이 내내 탭이 idle, 버블이 completed 였다(완료음).
    vi.advanceTimersByTime(24_000);
    expect(sub.status).toBe('active');

    feed(FIRST_TOKEN);
    expect(priv.noticeResumeHolds.has(SUB)).toBe(false);
    expect(sub.status).toBe('active');

    feed(ASSISTANT);
    feed(result('릴리스를 마쳤습니다'));
    vi.advanceTimersByTime(TURN_RESUME_GRACE_MS);
    expect(sub.status).toBe('idle');
    // 밖으로 알린 idle 은 진짜 끝의 한 번뿐이다 — 완료음도 한 번.
    expect(seen.filter((s) => s === 'idle')).toHaveLength(1);
    expect(seen[seen.length - 1]).toBe('idle');
  });

  it('첫 모델 줄은 붙듦과 승격 표식을 함께 걷는다 — 표식이 남으면 곧바로 "자식이 다 끝났다"로 내려간다', () => {
    const { priv, sub, seen, feed } = heldAfterNotice();

    feed(FIRST_TOKEN);
    expect(priv.noticeResumeHolds.has(SUB)).toBe(false);
    expect(priv.bgPromotedSubs.has(SUB)).toBe(false);
    expect(sub.status).toBe('active');
    expect(seen).not.toContain('idle');
  });

  it('파싱된 재개 신호도 붙듦을 푼다 — 원시 줄을 거치지 않는 경로용', () => {
    const { priv, sub } = heldAfterNotice();

    priv.noteTurnSealSignal(parsedEvent('text'));
    expect(priv.noticeResumeHolds.has(SUB)).toBe(false);
    expect(priv.bgPromotedSubs.has(SUB)).toBe(false);
    expect(sub.status).toBe('active');
  });

  it('곁가지 줄은 붙듦을 풀지 않는다 — 본 대화가 말하기 시작했다는 증거가 아니다', () => {
    const { priv, sub, feed } = heldAfterNotice();

    feed(NESTED_TOKEN);
    feed(NESTED_ASSISTANT);
    priv.noteTurnSealSignal(parsedEvent('text', { nestedUnderToolUseId: 'toolu_nested' }));
    expect(priv.noticeResumeHolds.has(SUB)).toBe(true);
    expect(sub.status).toBe('active');
  });
});

describe('상한과 정리', () => {
  it('90초 안에 모델 줄이 없으면 종전처럼 내린다 — 늦은 소리가 영원한 스피너보다 낫다', () => {
    const { priv, sub, seen } = heldAfterNotice();

    vi.advanceTimersByTime(NOTICE_RESUME_WINDOW_MS - 1);
    expect(sub.status).toBe('active');
    expect(seen).not.toContain('idle');

    vi.advanceTimersByTime(1);
    expect(priv.noticeResumeHolds.has(SUB)).toBe(false);
    expect(priv.bgPromotedSubs.has(SUB)).toBe(false);
    expect(sub.status).toBe('idle');
    expect(seen[seen.length - 1]).toBe('idle');
  });

  it('붙든 사이 끝 칩이 또 오면 그 시각부터 다시 잰다', () => {
    vi.useFakeTimers();
    const ctx = setup();
    mainTurnSpawnsChildrenAndEnds(ctx, ['t1', 't2']);

    ctx.endTask('t1');
    vi.advanceTimersByTime(60_000);
    ctx.endTask('t2');
    // 첫 끝 칩부터 재면 이미 지났을 시각이다.
    vi.advanceTimersByTime(NOTICE_RESUME_WINDOW_MS - 1);
    expect(ctx.sub.status).toBe('active');
    expect(ctx.priv.noticeResumeHolds.has(SUB)).toBe(true);

    vi.advanceTimersByTime(1);
    expect(ctx.sub.status).toBe('idle');
  });

  it('[중지]가 붙듦을 걷는다 — 늦은 만료가 멈춘 세션의 상태를 다시 흔들지 않는다', () => {
    const { m, priv } = heldAfterNotice();
    const warn = vi.spyOn(logger, 'warn');

    expect(m.stop(SUB)).toBe(true);
    expect(priv.noticeResumeHolds.has(SUB)).toBe(false);

    vi.advanceTimersByTime(NOTICE_RESUME_WINDOW_MS * 2);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('did not resume the session'));
  });

  it('탭 제거도 붙듦을 걷는다', () => {
    const { m, priv } = heldAfterNotice();

    m.remove(SUB);
    expect(priv.noticeResumeHolds.has(SUB)).toBe(false);
  });
});

describe('붙들지 않는 자리 — 종전 그대로', () => {
  it('명령을 처리 중이면 붙들지 않는다 — 그 명령의 봉인이 끝을 정하고, 처리 중이라 강등도 막힌다', () => {
    vi.useFakeTimers();
    const ctx = setup();
    const cmd = beginCommand(ctx);
    ctx.feed(ASSISTANT);
    ctx.startTask('t1');

    ctx.endTask('t1');
    expect(ctx.priv.noticeResumeHolds.has(SUB)).toBe(false);
    expect(ctx.priv.bgPromotedSubs.has(SUB)).toBe(false);
    expect(ctx.sub.status).toBe('active');
    expect(cmd.status).toBe('executing');
  });

  it('쉬는 persistent 자식이 없으면 바로 내린다 — 통지로 새 턴을 열 주체가 없다', () => {
    vi.useFakeTimers();
    const ctx = setup({ child: false });
    ctx.sub.status = 'idle';
    ctx.startTask('t1');
    expect(ctx.sub.status).toBe('active');

    ctx.endTask('t1');
    expect(ctx.priv.noticeResumeHolds.has(SUB)).toBe(false);
    expect(ctx.sub.status).toBe('idle');
  });
});

describe('봉인 유예 중에 온 끝 칩 — 유예를 늘린다 (⑱(d))', () => {
  /** 자식이 살아 있어 끝이 잠정으로 붙들린 사이에 그 자식이 끝났다. */
  function graceThenNotice() {
    vi.useFakeTimers();
    const ctx = setup();
    const cmd = beginCommand(ctx);
    ctx.feed(ASSISTANT);
    ctx.startTask('t1');
    ctx.feed(result('앞 턴의 답'));
    expect(ctx.priv.deferredSeals.has(SUB)).toBe(true);
    ctx.endTask('t1');
    return { ...ctx, cmd };
  }

  it('3초 유예가 지나도 봉인하지 않고, 되살아난 턴의 첫 모델 줄이 거둔다 — 완료는 진짜 끝 한 번', () => {
    const { priv, cmd, onComplete, feed } = graceThenNotice();

    vi.advanceTimersByTime(TURN_RESUME_GRACE_MS);
    expect(cmd.status).toBe('executing');
    expect(onComplete).not.toHaveBeenCalled();

    vi.advanceTimersByTime(24_000 - TURN_RESUME_GRACE_MS);
    feed(FIRST_TOKEN);
    expect(priv.deferredSeals.has(SUB)).toBe(false);

    feed(ASSISTANT);
    feed(result('이어진 답'));
    expect(cmd.status).toBe('completed');
    expect(cmd.result).toBe('이어진 답');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('늘린 유예에도 끝이 있다 — 90초 안에 모델 줄이 없으면 그때 봉인한다', () => {
    const { cmd, onComplete } = graceThenNotice();

    vi.advanceTimersByTime(NOTICE_RESUME_WINDOW_MS - 1);
    expect(cmd.status).toBe('executing');

    vi.advanceTimersByTime(1);
    expect(cmd.status).toBe('completed');
    expect(cmd.result).toBe('앞 턴의 답');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe('자식이 둘 — 첫 통지 턴의 끝도 남은 자식을 센다 (⑱(e))', () => {
  it('첫 통지 턴이 끝나도 탭은 active 로 남고, 남은 자식의 끝 칩도 붙든다 — 완료음은 마지막 턴의 끝에서 한 번', () => {
    vi.useFakeTimers();
    const ctx = setup();
    const { priv, sub, seen, feed, endTask } = ctx;
    mainTurnSpawnsChildrenAndEnds(ctx, ['t1', 't2']);
    seen.length = 0;

    // 먼저 끝난 자식의 통지 턴.
    endTask('t1');
    feed(FIRST_TOKEN);
    feed(ASSISTANT);
    feed(result('첫 조사 결과를 반영했습니다'));
    vi.advanceTimersByTime(TURN_RESUME_GRACE_MS);
    // t2 가 아직 돈다 — 종전에는 여기서 idle 로 잠들었다.
    expect(sub.status).toBe('active');
    expect(priv.bgPromotedSubs.has(SUB)).toBe(true);

    // 남은 자식이 끝난다 — CLI 는 그 통지로 또 새 턴을 연다.
    endTask('t2');
    // 종전에는 탭이 이미 idle 이라 붙들 자격이 없어, 여기서 버블이 completed 로 넘어갔다(완료음).
    expect(priv.noticeResumeHolds.has(SUB)).toBe(true);
    expect(sub.status).toBe('active');

    feed(FIRST_TOKEN);
    feed(ASSISTANT);
    feed(result('모두 마쳤습니다'));
    vi.advanceTimersByTime(TURN_RESUME_GRACE_MS);
    expect(sub.status).toBe('idle');
    expect(seen.filter((s) => s === 'idle')).toHaveLength(1);
    expect(seen[seen.length - 1]).toBe('idle');
  });
});
