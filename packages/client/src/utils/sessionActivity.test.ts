import { describe, expect, it } from 'vitest';
import type { QueuedCommand, SubAgent, SubAgentStreamEvent } from '@vibisual/shared';
import { sessionLastActivityAt } from './sessionActivity.js';

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
