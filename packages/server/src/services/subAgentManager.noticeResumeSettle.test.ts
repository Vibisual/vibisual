import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueuedCommand, SubAgent } from '@vibisual/shared';
import { SubAgentManager } from './subAgentManager.js';
import { TURN_RESUME_GRACE_MS } from './turnSeal.js';

/**
 * §5.5 #17-9 ⑱(c) · #17-10 ⑤ — 백단 자식 덕에 `active` 였던 쉬는 탭이 끝날 때(자식 자멸 · [중지] · 전체 중지) 상태를 다시 센다 — 걷기만 하면 `active` 가 남는다.
 * 실제 스폰 콜백을 거친다 — 자식을 장부에 직접 넣으면 `close` 처리기가 붙지 않는다.
 */

const mock = vi.hoisted(() => ({ spawn: vi.fn(), noteSpawnFailure: vi.fn() }));
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: mock.spawn,
}));
vi.mock('./claudeBin.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./claudeBin.js')>(),
  getClaudeBin: () => ({ binPath: 'test-claude', source: 'unknown' }),
  noteClaudeSpawnFailure: mock.noteSpawnFailure,
}));

/** 실제 스폰 콜백을 연결하되 OS 프로세스·PID 레지스트리는 건드리지 않는다. */
function fakeChild() {
  return Object.assign(new EventEmitter(), {
    pid: undefined,
    exitCode: null,
    signalCode: null,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  });
}
type FakeChild = ReturnType<typeof fakeChild>;
type Innards = {
  runningChildren: Map<string, FakeChild>;
  noticeResumeHolds: Map<string, ReturnType<typeof setTimeout>>;
  bgPromotedSubs: Set<string>;
  _handlePersistentStdoutLine: (line: string, sub: SubAgent, child: FakeChild) => void;
  _executeViaLegacy: (
    cmd: QueuedCommand, sub: SubAgent, cwd: string, prompt: string,
    configArgs: string[], maxTurns: number, maxBudgetUsd?: number,
  ) => void;
};

const AGENT = 'agent-notice-settle';
const SESSION = 'session-notice-settle';

/** 본 턴이 백그라운드 `Explore` 자식을 띄우고 봉인됐고, 쉬는 자식 덕에 탭은 `active`. `notified` 면 끝 칩까지 와서 붙들린 상태. */
function restingPromotedTab(opts: { notified: boolean }) {
  vi.useFakeTimers();
  const m = new SubAgentManager();
  const priv = m as unknown as Innards;
  const sub = m.create(AGENT);
  sub.sessionId = SESSION;
  sub.status = 'active';
  const child = fakeChild();
  mock.spawn.mockReturnValueOnce(child);
  const cmd: QueuedCommand = {
    id: 'cmd-release', text: '릴리스 진행해 줘', timestamp: Date.now(), startedAt: Date.now(), status: 'executing', subAgentId: sub.id,
  };
  priv._executeViaLegacy(cmd, sub, process.cwd(), cmd.text, [], 0, 0);
  const feed = (obj: Record<string, unknown>): void => priv._handlePersistentStdoutLine(JSON.stringify(obj), sub, child);
  feed({ type: 'assistant', message: { content: [] } });
  m.noteStreamTaskChip(sub.id, 'task_started', { id: 't1', description: 'Explore t1', subagentType: 'Explore' });
  feed({ type: 'result', subtype: 'success', result: '백그라운드로 조사를 맡겼습니다' });
  vi.advanceTimersByTime(TURN_RESUME_GRACE_MS);
  expect(cmd.status).toBe('completed');
  expect(sub.status).toBe('active');
  expect(priv.bgPromotedSubs.has(sub.id)).toBe(true);
  if (opts.notified) {
    m.noteStreamTaskChip(sub.id, 'task_notification', { id: 't1', status: 'completed', summary: '조사 끝' });
    expect(priv.noticeResumeHolds.has(sub.id)).toBe(true);
    expect(sub.status).toBe('active');
  }
  const seen: string[] = [];
  m.setOnSubStatusChange(() => { seen.push(sub.status); });
  return { m, priv, sub, child, seen };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('붙든 사이 쉬던 자식이 스스로 죽는다', () => {
  it('탭이 idle 로 내려가고 밖에 알린다 — "실행 중"으로 굳지 않는다', () => {
    const { m, priv, sub, child, seen } = restingPromotedTab({ notified: true });

    child.emit('close', 1);

    expect(priv.noticeResumeHolds.has(sub.id)).toBe(false);
    expect(priv.bgPromotedSubs.has(sub.id)).toBe(false);
    expect(sub.status).toBe('idle');
    expect(seen[seen.length - 1]).toBe('idle');
    // 크래시는 대화를 버리지 않는다 — 다음 턴이 `--resume` 으로 이어 간다.
    expect(sub.sessionId).toBe(SESSION);
    // 종전엔 주기 대조도 이 탭을 내리지 못했다 — 이제 내릴 것이 남아 있지 않다.
    expect(m.reconcileDeadActiveSubs()).toEqual([]);
  });
});

describe('[중지]는 그 자리에서 내린다 — close 를 기다리지 않는다', () => {
  it('붙든 쉬는 탭 — 곧바로 idle, 죽어 가는 자식이 흘린 늦은 끝 칩이 붙듦을 다시 걸지 않는다', () => {
    const { m, priv, sub, child, seen } = restingPromotedTab({ notified: true });

    expect(m.stop(sub.id)).toBe(true);
    expect(sub.status).toBe('idle');
    expect(seen[seen.length - 1]).toBe('idle');
    expect(priv.bgPromotedSubs.has(sub.id)).toBe(false);

    m.noteStreamTaskChip(sub.id, 'task_notification', { id: 'late-shell', status: 'completed', summary: '늦게 온 끝' });
    expect(priv.noticeResumeHolds.has(sub.id)).toBe(false);
    expect(sub.status).toBe('idle');

    child.emit('close', null);
    expect(sub.status).toBe('idle');
  });

  it('살아 있는 백단 자식 덕에 떠 있던 쉬는 탭 — 곧바로 idle', () => {
    const { m, sub, child, seen } = restingPromotedTab({ notified: false });

    expect(m.stop(sub.id)).toBe(true);
    expect(sub.status).toBe('idle');
    expect(seen[seen.length - 1]).toBe('idle');

    child.emit('close', null);
    expect(sub.status).toBe('idle');
  });

  it('전체 중지도 같다 — 살아 있던 백단 자식 덕에 떠 있던 쉬는 탭이 곧바로 idle', () => {
    const { m, sub, child, seen } = restingPromotedTab({ notified: false });

    expect(m.stopAll(AGENT)).toEqual([sub.id]);
    expect(sub.status).toBe('idle');
    expect(seen[seen.length - 1]).toBe('idle');

    child.emit('close', null);
    expect(sub.status).toBe('idle');
  });

  it('전체 중지 — 붙든 쉬는 탭도 곧바로 idle', () => {
    const { m, sub } = restingPromotedTab({ notified: true });

    expect(m.stopAll(AGENT)).toEqual([sub.id]);
    expect(sub.status).toBe('idle');
  });
});
