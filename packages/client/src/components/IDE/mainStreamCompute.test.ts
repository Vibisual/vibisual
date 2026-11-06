import { describe, expect, it, vi } from 'vitest';
import type { QueuedCommand, SubAgent, SubAgentStreamEvent } from '@vibisual/shared';
import { mainEntryRunEnds, mainStreamTurnIds, orderMainEntries, type MainSortEntry } from './mainStreamCompute.js';
import { MainStreamProjectionCache } from './mainStreamProjectionCache.js';
import { turnOfEvent } from './streamItems.js';

vi.mock('./IDETerminalPanes.js', () => ({ IDETerminalPanes: () => null }));
import { applyMainDensity, buildEntries, groupEntries } from './IDEMainArea.js';

type Entry = MainSortEntry & { id: string; text: string };

// The pre-migration comparator is the oracle, including JS's NaN/falsy behavior.
function legacyOrder<T extends MainSortEntry>(entries: readonly T[]): T[] {
  const rank = (entry: MainSortEntry): number => entry.type === 'command' ? -1 : entry.type === 'turnstop' ? 1 : 0;
  return [...entries].sort((a, b) => (a.sortTimestamp ?? a.timestamp) - (b.sortTimestamp ?? b.timestamp)
    || rank(a) - rank(b) || a.timestamp - b.timestamp);
}

function legacyRunEnds(entries: readonly MainSortEntry[]): Uint32Array {
  const ends = Uint32Array.from(entries, (_, i) => i + 1);
  for (let i = 0; i < entries.length;) {
    const start = entries[i]!;
    let j = i + 1;
    if (start.type === 'text') {
      while (j < entries.length && entries[j]!.type === 'text' && entries[j]!.sessionLabel === start.sessionLabel) j++;
    } else if (start.type === 'tool_use') {
      while (j < entries.length && entries[j]!.type === 'tool_result') j++;
    }
    ends[i] = j;
    i = j;
  }
  return ends;
}

function randomEntries(count: number, seed = 7): Entry[] {
  let state = seed;
  const next = (): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
  const types = ['text', 'command', 'tool_use', 'tool_result', 'turnstop', 'error', 'step'];
  const labels = [undefined, '', 'same', 'same', '다른 세션'];
  return Array.from({ length: count }, (_, i) => ({
    id: `id-${i % 11}`, text: String(i), type: types[next() % types.length]!,
    timestamp: next() % 30, sortTimestamp: i % 4 === 0 ? next() % 30 : undefined,
    sessionLabel: labels[next() % labels.length],
  }));
}

describe('Rust main transcript numeric plans', () => {
  it('handles empty input without allocating a runtime buffer', () => {
    expect(orderMainEntries([])).toEqual([]);
    expect(mainEntryRunEnds([])).toEqual(new Uint32Array(0));
    expect(mainStreamTurnIds([], [])).toEqual([]);
  });

  it('preserves stable ties, duplicate IDs, explicit sort keys and infinite pending times', () => {
    const entries: Entry[] = [
      { id: 'same', type: 'text', timestamp: 10, text: 'first' },
      { id: 'same', type: 'turnstop', timestamp: 10, text: 'stop' },
      { id: 'pending1', type: 'command', timestamp: Infinity, text: '' },
      { id: 'command', type: 'command', timestamp: 10, text: '' },
      { id: 'same', type: 'text', timestamp: 10, text: 'second' },
      { id: 'late', type: 'text', timestamp: 25, sortTimestamp: 10, text: '' },
      { id: 'pending2', type: 'command', timestamp: Infinity, text: '' },
      { id: 'before', type: 'system', timestamp: -Infinity, text: '' },
      { id: 'zero', type: 'text', timestamp: -0, text: '' },
    ];
    const before = entries.slice();
    expect(orderMainEntries(entries)).toEqual(legacyOrder(entries));
    expect(orderMainEntries(entries).map((entry) => entries.indexOf(entry))).toEqual(legacyOrder(entries).map((entry) => entries.indexOf(entry)));
    expect(entries).toEqual(before);
  });

  it('uses the legacy non-transitive comparator only for malformed NaN timestamps', () => {
    const entries = randomEntries(150);
    entries[4] = { ...entries[4]!, timestamp: NaN };
    entries[11] = { ...entries[11]!, sortTimestamp: NaN };
    expect(orderMainEntries(entries)).toEqual(legacyOrder(entries));
  });

  it.each([1, 2, 17, 600, 40_000])('matches legacy sort and grouping for %i entries, including Wasm memory growth', (count) => {
    const entries = randomEntries(count);
    const expected = legacyOrder(entries);
    const actual = orderMainEntries(entries);
    expect(actual).toEqual(expected);
    expect(mainEntryRunEnds(actual)).toEqual(legacyRunEnds(expected));
    // A later small call must not reuse a detached view or a freed result buffer.
    expect(orderMainEntries(entries.slice(0, 2))).toEqual(legacyOrder(entries.slice(0, 2)));
  });

  it('retains undefined versus empty labels and matches adjacent tool/result grouping across sessions', () => {
    const entries: Entry[] = [
      { id: 'a', type: 'text', text: 'A', timestamp: 1 },
      { id: 'b', type: 'text', text: 'B', timestamp: 2 },
      { id: 'c', type: 'text', text: 'C', timestamp: 3, sessionLabel: '' },
      { id: 'orphan', type: 'tool_result', text: '', timestamp: 4 },
      { id: 'tool', type: 'tool_use', text: '', timestamp: 5, sessionLabel: 'one' },
      { id: 'result', type: 'tool_result', text: '', timestamp: 6, sessionLabel: 'two' },
      { id: 'active', type: 'tool_use', text: '', timestamp: 7 },
    ];
    expect(mainEntryRunEnds(entries)).toEqual(new Uint32Array([2, 2, 3, 4, 6, 6, 7]));
  });

  it('matches turnOfEvent for explicit stamps, equal anchors, absent commands, NaN and infinity', () => {
    const anchors = [{ ts: 10, id: 'a' }, { ts: 10, id: 'b' }, { ts: 20, id: 'c' }];
    const events = [
      { timestamp: 0 }, { timestamp: 10 }, { timestamp: 19 }, { timestamp: 20 },
      { timestamp: NaN }, { timestamp: Infinity }, { timestamp: -Infinity },
      { timestamp: 0, turnId: 'unknown-stamped-turn' }, { timestamp: 20, turnId: '' },
    ];
    for (const current of [anchors, [], [{ ts: NaN, id: 'nan' }, ...anchors]]) {
      expect(mainStreamTurnIds(events, current)).toEqual(events.map((event) => turnOfEvent(event as SubAgentStreamEvent, current)));
    }
  });
});

describe('main transcript rendering contracts through Rust', () => {
  const sub = (id: string, label: string): SubAgent => ({
    id, label, sessionId: id, parentAgentId: 'P', status: 'idle', createdAt: 0, lastActivityAt: 0,
  });
  const event = (id: string, subAgentId: string, eventType: SubAgentStreamEvent['eventType'], content: string, timestamp: number, toolName?: string): SubAgentStreamEvent => ({
    id, subAgentId, parentAgentId: 'P', eventType, content, timestamp, toolName,
  });

  it('keeps the historical label-based text merge and first ID while using the last actual timestamp', () => {
    const streams = {
      S: [event('duplicate', 'S', 'text', 'A', 1), event('b', 'S', 'text', 'B', 3)],
      T: [event('duplicate', 'T', 'text', 'T', 2)],
    };
    const flat = buildEntries([], [sub('S', 'same'), sub('T', 'same')], streams, null, [], () => '');
    expect(flat).toHaveLength(1);
    expect(flat[0]).toMatchObject({ id: 'duplicate', text: 'ATB', timestamp: 1, endedAt: 3, sessionLabel: 'same' });
    expect(streams.S.map((entry) => entry.content)).toEqual(['A', 'B']);
  });

  it('preserves plan promotion, orphan results, tool activity and all density outputs', () => {
    const events = [
      event('orphan', 'S', 'tool_result', 'orphan result', 1),
      event('plan', 'S', 'tool_use', '{"todos":[{"content":"Do it","status":"pending","activeForm":"Doing it"}]}', 2, 'TodoWrite'),
      event('plan-result', 'S', 'tool_result', 'saved', 3),
      event('tool', 'S', 'tool_use', '{}', 4, 'Read'),
      event('tool-result', 'S', 'tool_result', 'file', 5),
      event('active', 'S', 'tool_use', '{}', 6, 'Grep'),
      event('body', 'S', 'text', 'Every paragraph remains', 7),
    ];
    const flat = buildEntries([], [sub('S', 'S')], { S: events }, null, [], () => '');
    const grouped = groupEntries(flat);
    expect(grouped.map((item) => item.id)).toEqual(['orphan', 'plan-plan', 'grp-tool', 'grp-active', 'body']);
    expect(grouped[2]).toMatchObject({ isActive: false, entries: [expect.objectContaining({ id: 'tool' }), expect.objectContaining({ id: 'tool-result' })] });
    expect(grouped[3]).toMatchObject({ isActive: true });
    expect(applyMainDensity(grouped, 'raw').map((item) => item.id)).toEqual(['orphan', 'plan-plan', 'grp-tool', 'grp-active', 'body']);
    expect(applyMainDensity(grouped, 'standard').map((item) => item.id)).toEqual(['orphan', 'plan-plan', 'grp-tool', 'body']);
    expect(applyMainDensity(grouped, 'compact').map((item) => item.id)).toEqual(['orphan', 'plan-plan', 'body']);
  });

  it('reuses unchanged session rows while rebuilding only the session receiving events', () => {
    const cache = new MainStreamProjectionCache<ReturnType<typeof buildEntries>[number]>();
    const subs = [sub('S', 'S'), sub('T', 'T')];
    const streams = { S: [event('s', 'S', 'tool_use', 'first', 1)], T: [event('t', 'T', 'tool_use', 'second', 2)] };
    const format = (): string => '';
    const first = buildEntries([], subs, streams, null, [], format, [], undefined, cache);
    streams.S = [...streams.S, event('new', 'S', 'tool_result', 'done', 3)];
    const second = buildEntries([], subs, streams, null, [], format, [], undefined, cache);
    expect(second).toEqual(buildEntries([], subs, streams, null, [], format));
    expect(second.find((row) => row.id === 't')).toBe(first.find((row) => row.id === 't'));
    expect(second.find((row) => row.id === 's')).not.toBe(first.find((row) => row.id === 's'));
  });

  it('invalidates cached projections for edits, front trimming, labels, locale, command boundaries and status', () => {
    const cache = new MainStreamProjectionCache<ReturnType<typeof buildEntries>[number]>();
    const subs = [sub('S', 'S')];
    subs[0]!.status = 'active';
    const commands: QueuedCommand[] = [{ id: 'a', subAgentId: 'S', text: 'Work', timestamp: 1, startedAt: 1, status: 'executing' }];
    const streams = { S: [
      event('retry', 'S', 'system', 'Reconnecting... 2/5', 2),
      event('error', 'S', 'error', '[cli@codex] Capacity exceeded', 3),
    ] };
    let format = (error: { detail?: string }): string => `English: ${error.detail}`;
    const check = (): void => {
      const cached = buildEntries(commands, subs, streams, null, [], format, commands, undefined, cache);
      const fresh = buildEntries(commands, subs, streams, null, [], format);
      expect(cached).toEqual(fresh);
      for (const density of ['raw', 'standard', 'compact'] as const) {
        expect(applyMainDensity(groupEntries(cached), density)).toEqual(applyMainDensity(groupEntries(fresh), density));
      }
    };
    check(); check();
    commands[0]!.status = 'completed'; check();
    subs[0]!.status = 'idle'; check();
    streams.S[1]!.content = '[cli@codex] Different failure'; check();
    streams.S[1]!.turnId = 'unknown'; check();
    streams.S[1]!.timestamp = 0; check();
    streams.S[1]!.nestedUnderToolUseId = 'nested'; check();
    commands[0]!.startedAt = -10; check();
    subs[0]!.label = 'renamed'; check();
    format = (error) => `한국어: ${error.detail}`; check();
    streams.S = streams.S.slice(1); check();
    streams.S.unshift(event('late', 'S', 'text', 'Late earlier history', -20)); check();
    streams.S = []; check();
  });

  it('does not retain a stop sort override on a reused cached row after cancellation is removed', () => {
    const cache = new MainStreamProjectionCache<ReturnType<typeof buildEntries>[number]>();
    const commands: QueuedCommand[] = [
      { id: 'a', subAgentId: 'S', text: 'A', timestamp: 1, startedAt: 1, status: 'completed', stopReason: 'cancelled' },
      { id: 'b', subAgentId: 'S', text: 'B', timestamp: 10, startedAt: 10, status: 'completed' },
    ];
    const streams = { S: [{ ...event('late-tool', 'S', 'tool_use', '{}', 30), turnId: 'a' }] };
    const subs = [sub('S', 'S')];
    const format = (): string => '';
    const stopped = buildEntries(commands, subs, streams, null, [], format, commands, undefined, cache);
    expect(stopped.find((row) => row.id === 'late-tool')?.sortTimestamp).toBe(9.5);
    commands[0]!.stopReason = 'end_turn';
    const resumed = buildEntries(commands, subs, streams, null, [], format, commands, undefined, cache);
    expect(resumed).toEqual(buildEntries(commands, subs, streams, null, [], format));
    expect(resumed.find((row) => row.id === 'late-tool')?.sortTimestamp).toBeUndefined();
  });
});
