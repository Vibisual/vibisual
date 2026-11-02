import { describe, expect, it, vi } from 'vitest';
import type { QueuedCommand, SubAgent, SubAgentStreamEvent } from '@vibisual/shared';
vi.mock('./IDETerminalPanes.js', () => ({ IDETerminalPanes: () => null }));
import { applyMainDensity, buildEntries, groupEntries } from './IDEMainArea.js';

const STOP = '[Stopped by user]';
const formatError = (error: { detail?: string }): string => error.detail ?? '';
const sub = (id = 'S'): SubAgent => ({
  id, sessionId: id, label: id, parentAgentId: 'P', status: 'idle', createdAt: 0, lastActivityAt: 0,
});
const command = (overrides: Partial<QueuedCommand> = {}): QueuedCommand => ({
  id: 'a', subAgentId: 'S', text: 'Work', status: 'completed', timestamp: 10, startedAt: 10,
  stopReason: 'cancelled', result: STOP, ...overrides,
});
const event = (id: string, content: string, timestamp: number, overrides: Partial<SubAgentStreamEvent> = {}): SubAgentStreamEvent => ({
  id, content, timestamp, eventType: 'result', turnId: 'a', subAgentId: 'S', parentAgentId: 'P', ...overrides,
});

describe('main transcript stop boundaries', () => {
  it.each([null, 'S'])('replaces marker-only saved results with one stop in view %s', (selected) => {
    const entries = buildEntries([command()], [sub()], {}, selected, [], formatError);
    expect(entries.map((entry) => entry.id)).toEqual(['cmd-a', 'turnstop-a']);
    expect(entries[1]).toMatchObject({ type: 'turnstop', text: 'stop', stopLabelKey: 'ide.turnStop.cancelled' });
    expect(entries.some((entry) => entry.text.includes(STOP))).toBe(false);
    for (const density of ['compact', 'standard', 'raw'] as const) {
      expect(applyMainDensity(groupEntries(entries), density).map((item) => item.id)).toEqual(['cmd-a', 'turnstop-a']);
    }
  });

  it('keeps a partial saved answer when the only result event is a stop marker', () => {
    const entries = buildEntries([command({ result: `${STOP}\n\nPartial answer` })], [sub()], {
      S: [event('stop-result', STOP, 30)],
    }, null, [], formatError);
    expect(entries.map((entry) => entry.id)).toEqual(['cmd-a', 'cmdres-a', 'turnstop-a']);
    expect(entries[1]?.text).toBe('Partial answer');
  });

  it('strips only result prefixes while preserving ordinary assistant and tool content', () => {
    const entries = buildEntries([command()], [sub()], {
      S: [
        event('literal', STOP, 20, { eventType: 'text' }),
        event('tool', STOP, 21, { eventType: 'tool_use', toolName: 'Read' }),
        event('answer', `${STOP}\n\nPartial answer`, 30),
      ],
    }, null, [], formatError);
    expect(entries.find((entry) => entry.id === 'literal')?.text).toBe(STOP);
    expect(entries.find((entry) => entry.id === 'tool')?.text).toBe(STOP);
    expect(entries.find((entry) => entry.id === 'answer')?.text).toBe('Partial answer');
    expect(entries.filter((entry) => entry.type === 'turnstop')).toHaveLength(1);
  });

  it('recognizes a legacy saved stop even without stopReason', () => {
    const entries = buildEntries([command({ stopReason: undefined })], [sub()], {}, null, [], formatError);
    expect(entries.map((entry) => entry.id)).toEqual(['cmd-a', 'turnstop-a']);
  });

  it('keeps each stopped session boundary with its own output in the combined view', () => {
    const entries = buildEntries([
      command(), command({ id: 'b', subAgentId: 'T', timestamp: 40, startedAt: 40 }),
    ], [sub(), sub('T')], {
      S: [event('s-answer', 'S answer', 20)],
      T: [event('t-answer', 'T answer', 50, { turnId: 'b', subAgentId: 'T' })],
    }, null, [], formatError);
    expect(entries.map((entry) => entry.id)).toEqual(['cmd-a', 's-answer', 'turnstop-a', 'cmd-b', 't-answer', 'turnstop-b']);
    expect(entries.find((entry) => entry.id === 'turnstop-a')?.sessionLabel).toBe('S');
    expect(entries.find((entry) => entry.id === 'turnstop-b')?.sessionLabel).toBe('T');
  });

  it('keeps late output before its stop and next turn while preserving original times', () => {
    const entries = buildEntries([
      command(), command({ id: 'b', timestamp: 40, startedAt: 40, stopReason: 'end_turn', result: '' }),
    ], [sub()], {
      S: [event('late', 'Late partial answer', 60), event('next', 'Next answer', 50, { turnId: 'b' })],
    }, null, [], formatError);
    expect(entries.map((entry) => entry.id)).toEqual(['cmd-a', 'late', 'turnstop-a', 'cmd-b', 'next']);
    expect(entries.find((entry) => entry.id === 'late')).toMatchObject({ timestamp: 60, sortTimestamp: 39.5 });
    const grouped = groupEntries(entries);
    const finalOrder = [...grouped].sort((a, b) => (a.sortTimestamp ?? a.timestamp) - (b.sortTimestamp ?? b.timestamp));
    expect(finalOrder.map((item) => item.id)).toEqual(entries.map((entry) => entry.id));
  });

  it('does not add a stop for running, error, ordinary completed, or silent commands', () => {
    for (const override of [
      { status: 'executing' }, { status: 'error' }, { stopReason: 'end_turn', result: 'Done' }, { silent: true },
    ] as Partial<QueuedCommand>[]) {
      const entries = buildEntries([command(override)], [sub()], {}, null, [], formatError);
      expect(entries.some((entry) => entry.type === 'turnstop')).toBe(false);
    }
  });
});
