import { describe, expect, it } from 'vitest';
import type { QueuedCommand, SubAgentStreamEvent } from '@vibisual/shared';
import { buildBaseItems, IncrementalStreamParser, type StreamError } from './streamItems.js';
import { describeCommandError, parseStreamErrorContent } from './commandError.js';

const DETAIL = 'Selected model is at capacity. Please try a different model.';
const RESPONSE = JSON.stringify({ type: 'error', status: 503, error: { type: 'model_capacity_exceeded', message: DETAIL } });
const command = (id = 'a', timestamp = 1): QueuedCommand => ({
  id, text: `work ${id}`, status: 'executing', timestamp, startedAt: timestamp, subAgentId: 'S',
});
const event = (id: number, content: string, extra: Partial<SubAgentStreamEvent> = {}): SubAgentStreamEvent => ({
  id: `e${id}`, eventType: 'error', content, timestamp: id + 10,
  parentAgentId: 'P', subAgentId: 'S', turnId: 'a', ...extra,
});
const errors = (events: SubAgentStreamEvent[], commands: QueuedCommand[] = [command()]): StreamError[] => (
  buildBaseItems(events, commands).items.filter((item): item is StreamError => item.kind === 'error')
);

function assertPrefixes(events: SubAgentStreamEvent[], commands: QueuedCommand[] = [command()]): void {
  const parser = new IncrementalStreamParser();
  for (let length = 0; length <= events.length; length++) {
    const prefix = events.slice(0, length);
    expect(parser.sync(prefix, commands)).toEqual(buildBaseItems(prefix, commands));
  }
}

describe('duplicate provider errors', () => {
  it('keeps one row with the terminal engine and original identity, without mutating history', () => {
    const parser = new IncrementalStreamParser();
    const raw = event(1, DETAIL);
    const terminal = event(2, `[cli@codex] ${DETAIL}`);
    const before = parser.sync([raw], [command()]).items.find((item) => item.kind === 'error')!;
    const after = parser.sync([raw, terminal], [command()]);
    expect(after).toEqual(buildBaseItems([raw, terminal], [command()]));
    expect(after.items.filter((item) => item.kind === 'error')).toEqual([
      { kind: 'error', id: raw.id, timestamp: raw.timestamp, content: terminal.content },
    ]);
    expect(before).toMatchObject({ content: DETAIL });
    expect(raw.content).toBe(DETAIL);
    assertPrefixes([raw, terminal, event(3, DETAIL)]);
  });

  it('also coalesces a usage-limit terminal envelope and a later raw repeat', () => {
    const detail = "You've hit your usage limit.";
    const events = [event(1, detail), event(2, `[usageLimit@codex] ${detail}`), event(3, detail)];
    assertPrefixes(events);
    expect(errors(events)).toEqual([{ kind: 'error', id: 'e1', timestamp: 11, content: events[1]!.content }]);
  });

  it.each(['a', undefined])('retains the original JSON diagnostic and terminal links with turn stamp %s', (turnId) => {
    const raw = event(1, RESPONSE);
    const terminal = event(2, `[cli@codex] ${DETAIL}`, { turnId });
    const events = [raw, terminal];
    assertPrefixes(events, []);
    const rows = errors(events, []);
    expect(rows).toEqual([
      { kind: 'error', id: raw.id, timestamp: raw.timestamp, content: `[cli@codex] ${RESPONSE}` },
    ]);
    const description = describeCommandError(parseStreamErrorContent(rows[0]!.content));
    expect(description.detail).toBe(RESPONSE);
    expect(description.guidance?.links.map((link) => new URL(link.href).hostname))
      .toEqual(['developers.openai.com', 'status.openai.com']);
    expect(raw.content).toBe(RESPONSE);
    expect(terminal.content).toBe(`[cli@codex] ${DETAIL}`);
  });

  it('keeps the terminal envelope when the full JSON diagnostic arrives later', () => {
    const events = [event(1, `[cli@codex] ${DETAIL}`), event(2, RESPONSE), event(3, DETAIL)];
    assertPrefixes(events);
    expect(errors(events)).toEqual([
      { kind: 'error', id: 'e1', timestamp: 11, content: `[cli@codex] ${RESPONSE}` },
    ]);
  });

  it('preserves distinct JSON payloads and an ambiguous terminal message', () => {
    const otherResponse = JSON.stringify({ ...JSON.parse(RESPONSE), request_id: 'another-request' });
    const events = [event(1, RESPONSE), event(2, otherResponse), event(3, `[cli@codex] ${DETAIL}`)];
    assertPrefixes(events);
    expect(errors(events).map((row) => row.content)).toEqual(events.map((item) => item.content));
    expect(errors([event(1, RESPONSE), event(2, `[cli@codex] ${otherResponse}`)])).toHaveLength(2);
  });

  it('does not merge unrecognized JSON errors, raw-only variants, or merely the same guidance kind', () => {
    for (const [raw, terminal] of [
      [JSON.stringify({ error: { message: 'Unrecognized failure' } }), '[cli@codex] Unrecognized failure'],
      [RESPONSE, DETAIL],
      [RESPONSE, '[cli@codex] Selected model is at capacity. Retry tomorrow.'],
    ]) {
      const events = [event(1, raw!), event(2, terminal!)];
      assertPrefixes(events);
      expect(errors(events)).toHaveLength(2);
    }
  });

  it('does not merge JSON and plain errors across engines or owners', () => {
    for (const scope of [{ turnId: 'b' }, { subAgentId: 'other' }, { parentAgentId: 'other' }, { nestedUnderToolUseId: 'nested' }]) {
      const events = [event(1, RESPONSE), event(2, `[cli@codex] ${DETAIL}`, scope)];
      assertPrefixes(events);
      expect(errors(events)).toHaveLength(2);
    }
    const events = [event(1, `[cli@codex] ${RESPONSE}`), event(2, `[cli@claude] ${DETAIL}`)];
    assertPrefixes(events);
    expect(errors(events)).toHaveLength(2);
  });

  it('coalesces a legacy terminal error missing its turn stamp when command history is absent', () => {
    // failCommand used to run after currentTurnId was cleared. Restored streams may
    // outlive their command anchors, leaving just the raw event with a turn stamp.
    const events = [event(1, DETAIL), event(2, `[cli@codex] ${DETAIL}`, { turnId: undefined })];
    assertPrefixes(events, []);
    expect(errors(events, [])).toEqual([
      { kind: 'error', id: 'e1', timestamp: 11, content: events[1]!.content },
    ]);
    expect(events[1]!.turnId).toBeUndefined();
  });

  it.each([
    { eventType: 'text' as const, content: 'Resumed work' },
    { eventType: 'thinking' as const, content: 'Thinking' },
    { eventType: 'system' as const, content: '[status] running' },
    { eventType: 'error' as const, content: 'Another failure' },
  ])('keeps an unowned terminal error after intervening activity: %j', (intervening) => {
    const events = [event(1, DETAIL), event(2, intervening.content, intervening), event(3, `[cli@codex] ${DETAIL}`, { turnId: undefined })];
    assertPrefixes(events, []);
    expect(errors(events, []).filter((item) => item.content.includes(DETAIL))).toHaveLength(2);
  });

  it('does not guess legacy terminal ownership across sessions, nested tasks, or command boundaries', () => {
    for (const scope of [{ subAgentId: 'other' }, { parentAgentId: 'other' }, { nestedUnderToolUseId: 'nested' }]) {
      const events = [event(1, DETAIL), event(2, `[cli@codex] ${DETAIL}`, { turnId: undefined, ...scope })];
      assertPrefixes(events, []);
      expect(errors(events, [])).toHaveLength(2);
    }
    const events = [event(1, DETAIL), event(2, `[cli@codex] ${DETAIL}`, { turnId: undefined })];
    const commands = [command('a'), command('b', 12)];
    assertPrefixes(events, commands);
    expect(errors(events, commands)).toHaveLength(2);
  });

  it.each([
    { turnId: 'b' },
    { subAgentId: 'other' },
    { parentAgentId: 'other' },
    { nestedUnderToolUseId: 'nested' },
  ])('does not merge a different command/session/owner: %j', (scope) => {
    const events = [event(1, DETAIL), event(2, `[cli@codex] ${DETAIL}`, scope)];
    assertPrefixes(events);
    expect(errors(events)).toHaveLength(2);
  });

  it('keeps different engines and does not guess ownership of an unlabelled repeat', () => {
    const events = [event(1, DETAIL), event(2, `[cli@codex] ${DETAIL}`), event(3, `[cli@claude] ${DETAIL}`), event(4, DETAIL)];
    assertPrefixes(events);
    expect(errors(events).map((item) => item.content)).toEqual([events[1]!.content, events[2]!.content, DETAIL]);
  });

  it('keeps different diagnostics, other failure codes, empty details, and foreign envelopes', () => {
    const events = [
      event(1, DETAIL), event(2, '[cli@codex] A different failure'),
      event(3, `[spawn@codex] ${DETAIL}`), event(4, `[exit:1@codex] ${DETAIL}`),
      event(5, `[future@codex] ${DETAIL}`), event(6, '[cli@codex]'), event(7, '[cli@codex]'),
    ];
    assertPrefixes(events);
    expect(errors(events)).toHaveLength(events.length);
  });

  it('uses dispatched command boundaries for unstamped events, but never merges unowned history', () => {
    const events = [event(1, DETAIL, { turnId: undefined }), event(2, `[cli@codex] ${DETAIL}`, { turnId: undefined })];
    assertPrefixes(events, []);
    expect(errors(events, [])).toHaveLength(2);
    const commands = [command('a'), command('b', 12)];
    assertPrefixes(events, commands);
    expect(errors(events, commands)).toHaveLength(2);
    assertPrefixes(events, [command()]);
    expect(errors(events, [command()])).toHaveLength(1);
  });

  it('preserves pending tool indices and rebuilds after a front trim or attribution change', () => {
    const events = [
      event(1, DETAIL),
      event(2, 'echo ok', { eventType: 'tool_use', toolName: 'Bash' }),
      event(3, `[cli@codex] ${DETAIL}`),
      event(4, 'ok', { eventType: 'tool_result', toolName: 'Bash' }),
      event(5, 'another failure'),
    ];
    assertPrefixes(events);
    expect(buildBaseItems(events, [command()]).items.find((item) => item.kind === 'tool')).toMatchObject({ output: 'ok' });
    const parser = new IncrementalStreamParser();
    parser.sync(events, [command()]);
    expect(parser.sync(events.slice(2), [command()])).toEqual(buildBaseItems(events.slice(2), [command()]));
    const unmarked = events.map((item) => ({ ...item, turnId: undefined }));
    parser.sync(unmarked, [command()]);
    const commands = [command(), command('b', 13)];
    expect(parser.sync(unmarked, commands)).toEqual(buildBaseItems(unmarked, commands));
  });
});
