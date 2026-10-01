import { describe, expect, it } from 'vitest';
import { SESSION_NO_RESPONSE_MS } from '@vibisual/shared';
import type { QueuedCommand, RunningSubagentTask, SubAgent, SubAgentStreamEvent } from '@vibisual/shared';
import {
  liveLineActivityAt, liveLineClockFrom, liveLineStalled, sessionHiddenTurnRunning, sessionLastActivityAt, sessionTurnStartedAt,
} from './sessionActivity.js';

const sub = (id: string, lastActivityAt: number): SubAgent => ({
  id, parentAgentId: 'agent', sessionId: id, label: id, status: 'active', createdAt: 1, lastActivityAt,
});
const event = (subAgentId: string, timestamp: number): SubAgentStreamEvent => ({
  id: `${subAgentId}-${timestamp}`, subAgentId, parentAgentId: 'agent', timestamp,
  eventType: 'system', content: '[status]',
});
const command = (subAgentId: string, startedAt: number): QueuedCommand => ({
  id: subAgentId, subAgentId, timestamp: 1, startedAt, status: 'executing', text: 'work',
});

describe('session activity while the graph snapshot stays unchanged', () => {
  it('counts a live event even when the snapshot still has the turn start time', () => {
    expect(sessionLastActivityAt([sub('a', 1_000)], { a: [event('a', 265_000)] }, [], 'a')).toBe(265_000);
  });

  it('does not turn restored history into new activity or move the clock backwards', () => {
    expect(sessionLastActivityAt([sub('a', 265_000)], { a: [event('a', 1_000)] }, [], 'a')).toBe(265_000);
  });

  it('uses event time even when turn grouping leaves an older event at the end', () => {
    expect(sessionLastActivityAt([sub('a', 1_000)], {
      a: [event('a', 265_000), event('a', 2_000)],
    }, [], 'a')).toBe(265_000);
  });

  it('ignores another session and its commands, while the agent view includes both', () => {
    const subs = [sub('a', 1_000), sub('b', 200_000)];
    const streams = { a: [event('a', 2_000)], b: [event('b', 265_000)] };
    const commands = [command('b', 300_000)];
    expect(sessionLastActivityAt(subs, streams, commands, 'a')).toBe(2_000);
    expect(sessionLastActivityAt(subs, streams, commands, null)).toBe(300_000);
  });

  it('includes the current command start but excludes commands still queued', () => {
    expect(sessionLastActivityAt([sub('a', 1_000)], {}, [command('a', 265_000)], 'a')).toBe(265_000);
    expect(sessionLastActivityAt([sub('a', 1_000)], {}, [
      { ...command('a', 265_000), status: 'queued' },
    ], 'a')).toBe(1_000);
  });

  it('does not manufacture a timestamp when the inputs are missing or invalid', () => {
    expect(sessionLastActivityAt([], {}, [], null)).toBeNull();
    expect(sessionLastActivityAt([sub('a', NaN)], {
      a: [event('a', Infinity), event('a', -10), event('b', 265_000)],
    }, [], 'a')).toBeNull();
  });
});

// §2.4 — the live line used to age from the last *visible* line only. After a silent
// pre-compaction (§5.3 #9-1 (P)) that line was the previous turn's end, so a command that
// had just started opened as "last update 8m ago" and looked stalled.
describe('live line clock', () => {
  it('takes the later of the last visible line and the session activity', () => {
    expect(liveLineActivityAt(100_000, 265_000)).toBe(265_000);
    expect(liveLineActivityAt(300_000, 265_000)).toBe(300_000);
  });

  it('skips a missing or invalid side and stays null when neither side is usable', () => {
    expect(liveLineActivityAt(undefined, 265_000)).toBe(265_000);
    expect(liveLineActivityAt(NaN, 265_000)).toBe(265_000);
    expect(liveLineActivityAt(265_000, null)).toBe(265_000);
    expect(liveLineActivityAt(Infinity, -10)).toBeNull();
    expect(liveLineActivityAt(0, undefined)).toBeNull();
    expect(liveLineActivityAt(undefined, undefined)).toBeNull();
  });

  // §5.5 #17-10 ⑥-6 (2026-09-28) — the hidden turn is no longer "unknown": the command the user
  // just typed inherits it, so the clock counts from the moment the compaction went out (= input).
  it('keeps counting from the session activity while a hidden turn runs', () => {
    expect(liveLineActivityAt(100_000, 265_000)).toBe(265_000);
  });
});

// §2.4 — when the live line turns into "last update N ago". One predicate for both tabs.
describe('live line stall', () => {
  const LIMIT = SESSION_NO_RESPONSE_MS;

  it('stalls a running line only once the silence reaches the threshold', () => {
    expect(liveLineStalled('working', LIMIT - 1)).toBe(false);
    expect(liveLineStalled('working', LIMIT)).toBe(true);
    expect(liveLineStalled('thinking', LIMIT + 60_000)).toBe(true);
  });

  it('never stalls a line that is only queued, or one without a clock', () => {
    expect(liveLineStalled('waiting', LIMIT * 10)).toBe(false);
    expect(liveLineStalled('working', null)).toBe(false);
  });

  // §5.3 #9-1 (P) — the server withholds every line of the hidden turn and a compaction can take
  // longer than the threshold, so "no update" would be a claim without evidence. The inherited
  // command must keep looking like it is working.
  it('never stalls while a hidden turn runs, however long it takes', () => {
    expect(liveLineStalled('working', LIMIT * 3, true)).toBe(false);
    expect(liveLineStalled('thinking', LIMIT * 3, true)).toBe(false);
  });
});

describe('hidden turn (silent pre-compaction)', () => {
  const silent = (subAgentId: string, status: QueuedCommand['status']): QueuedCommand => ({
    ...command(subAgentId, 265_000), id: `silent-${subAgentId}`, status, silent: true, text: '/compact',
  });

  it('counts only an executing silent command of this session', () => {
    expect(sessionHiddenTurnRunning([silent('a', 'executing')], 'a')).toBe(true);
    expect(sessionHiddenTurnRunning([silent('a', 'queued')], 'a')).toBe(false);
    expect(sessionHiddenTurnRunning([silent('a', 'completed')], 'a')).toBe(false);
    expect(sessionHiddenTurnRunning([command('a', 265_000)], 'a')).toBe(false);
    expect(sessionHiddenTurnRunning([silent('b', 'executing')], 'a')).toBe(false);
  });

  it('lets the agent view see a hidden turn in any session', () => {
    expect(sessionHiddenTurnRunning([silent('b', 'executing')], null)).toBe(true);
    expect(sessionHiddenTurnRunning([], null)).toBe(false);
  });
});

// §5.5 #17-10 ⑥-6 (turn clock) — the live line used to show the time since the last activity.
// That clock rewinds to zero on every line, so a busy turn only ever showed `0s` / `1s`.
// The usual elapsed time now counts from the start of the work being shown.
describe('turn clock start', () => {
  const queued = (subAgentId: string, timestamp: number): QueuedCommand => ({
    id: `${subAgentId}-q-${timestamp}`, subAgentId, timestamp, status: 'queued', text: 'next',
  });
  const done = (subAgentId: string, startedAt: number): QueuedCommand => ({
    ...command(subAgentId, startedAt), id: `${subAgentId}-done-${startedAt}`, status: 'completed',
  });
  const task = (subAgentId: string, startedAt: number): RunningSubagentTask => ({
    id: `task-${subAgentId}-${startedAt}`, parentAgentId: 'agent', subAgentId, startedAt,
    origin: 'hook', subagentType: 'general-purpose',
  });

  it('counts a running turn from when its command went out, or from its queue time', () => {
    expect(sessionTurnStartedAt([command('a', 265_000)], [], 'a', false)).toBe(265_000);
    expect(sessionTurnStartedAt([
      { id: 'a', subAgentId: 'a', timestamp: 200_000, status: 'executing', text: 'work' },
    ], [], 'a', false)).toBe(200_000);
  });

  it('takes the latest start across sessions, and only this session in a session tab', () => {
    const commands = [command('a', 100_000), command('b', 265_000)];
    expect(sessionTurnStartedAt(commands, [], null, false)).toBe(265_000);
    expect(sessionTurnStartedAt(commands, [], 'a', false)).toBe(100_000);
    expect(sessionTurnStartedAt(commands, [], 'c', false)).toBeNull();
  });

  it('counts a waiting line from when its first command joined the queue', () => {
    const commands = [queued('a', 300_000), queued('a', 265_000), done('a', 100_000), queued('b', 1_000)];
    expect(sessionTurnStartedAt(commands, [], 'a', true)).toBe(265_000);
  });

  it('keeps the last dispatched command as the clock while work continues without one', () => {
    // A revived turn, or background children still running after the command ended.
    expect(sessionTurnStartedAt([queued('a', 400_000)], [done('a', 265_000), done('a', 100_000)], 'a', false)).toBe(265_000);
    expect(sessionTurnStartedAt([done('a', 300_000)], [done('a', 265_000)], 'a', false)).toBe(300_000);
  });

  it('falls back to the earliest running child only when no command ever went out', () => {
    // A hook-observed agent has no command queue; its background children are what keep it running.
    const shell: RunningSubagentTask = { id: 'shell', parentAgentId: 'agent', subAgentId: 'a', startedAt: 50_000, origin: 'stream' };
    const tasks = [task('a', 300_000), task('a', 265_000), task('b', 100_000), shell];
    expect(sessionTurnStartedAt([], [], 'a', false, tasks)).toBe(265_000);
    expect(sessionTurnStartedAt([], [], null, false, tasks)).toBe(100_000);
    // A dispatched command still wins, because the children belong to it.
    expect(sessionTurnStartedAt([], [done('a', 280_000)], 'a', false, tasks)).toBe(280_000);
    // A shell alone does not make the session run, so it gives no clock either.
    expect(sessionTurnStartedAt([], [], 'a', false, [shell])).toBeNull();
  });

  it('does not manufacture a start from missing or invalid times', () => {
    expect(sessionTurnStartedAt([], [], 'a', false)).toBeNull();
    expect(sessionTurnStartedAt([], [], 'a', true)).toBeNull();
    expect(sessionTurnStartedAt([queued('a', 0)], [], 'a', true)).toBeNull();
    expect(sessionTurnStartedAt([command('a', NaN)], [done('a', -5)], 'a', false, [task('a', Infinity)])).toBeNull();
  });
});

describe('live line clock start', () => {
  it('counts from the turn start normally and from the last update once stalled', () => {
    expect(liveLineClockFrom(false, 100_000, 265_000, 300_000)).toBe(100_000);
    expect(liveLineClockFrom(true, 100_000, 265_000, 300_000)).toBe(265_000);
  });

  it('never borrows the other clock, and never shows an unknown or future start as zero', () => {
    expect(liveLineClockFrom(false, null, 265_000, 300_000)).toBeNull();
    expect(liveLineClockFrom(true, 100_000, null, 300_000)).toBeNull();
    expect(liveLineClockFrom(false, 0, null, 300_000)).toBeNull();
    expect(liveLineClockFrom(false, 400_000, null, 300_000)).toBeNull();
    expect(liveLineClockFrom(false, undefined, undefined, 300_000)).toBeNull();
  });
});
