import { describe, expect, it } from 'vitest';
import type { QueuedCommand, SubAgentStreamEvent } from '@vibisual/shared';
import { buildBaseItems, IncrementalStreamParser, sameStreamItem, type BaseItemsResult, type StreamSystem } from './streamItems.js';

const detail = 'stream disconnected before completion: websocket closed by server before response.completed';
const retry = (attempt: number) => `Reconnecting... ${attempt}/5 (${detail})`;
const fallback = `Falling back from WebSockets to HTTPS transport. ${detail}`;
const command = (id = 'a', status: QueuedCommand['status'] = 'executing', timestamp = 1): QueuedCommand => ({
  id, text: `work ${id}`, status, timestamp, startedAt: timestamp, subAgentId: 'S',
});
const evt = (id: string, eventType: SubAgentStreamEvent['eventType'], content: string, extra: Partial<SubAgentStreamEvent> = {}): SubAgentStreamEvent => ({
  id, eventType, content, timestamp: 10 + Number(id.replace(/\D/g, '') || 0),
  parentAgentId: 'P', subAgentId: 'S', turnId: 'a', ...extra,
});
const notices = (base: BaseItemsResult): StreamSystem[] => base.items.filter((item): item is StreamSystem => item.kind === 'system' && !!item.transportRecovery);

function assertPrefixes(events: SubAgentStreamEvent[], commands: QueuedCommand[] = [command()]): void {
  const parser = new IncrementalStreamParser();
  for (let length = 0; length <= events.length; length++) {
    const prefix = events.slice(0, length);
    expect(parser.sync(prefix, commands)).toEqual(buildBaseItems(prefix, commands));
  }
}

describe('transport recovery episodes', () => {
  it('coalesces legacy errors and new system notices, preserving first identity and latest detail', () => {
    const events = [evt('e1', 'error', retry(2)), evt('e2', 'system', retry(3)), evt('e3', 'system', fallback)];
    assertPrefixes(events);
    const base = buildBaseItems(events, [command()]);
    expect(base.items.filter((item) => item.kind === 'error')).toEqual([]);
    expect(notices(base)).toEqual([{
      kind: 'system', id: 'e1', content: fallback, timestamp: 11,
      transportRecovery: { notice: { kind: 'fallback' }, state: 'recovering' },
    }]);
  });

  it('replaces changing rows without mutating earlier incremental snapshots', () => {
    const parser = new IncrementalStreamParser();
    const events = [evt('e1', 'error', retry(2))];
    const before = notices(parser.sync(events, [command()]))[0]!;
    events.push(evt('e2', 'system', fallback));
    const during = notices(parser.sync(events, [command()]))[0]!;
    events.push(evt('e3', 'text', 'The work has resumed.'));
    const after = notices(parser.sync(events, [command()]))[0]!;
    expect(before.content).toBe(retry(2));
    expect(before.transportRecovery?.state).toBe('recovering');
    expect(during.transportRecovery?.state).toBe('recovering');
    expect(after.transportRecovery?.state).toBe('resumed');
    expect(after.id).toBe(before.id);
    expect(during).not.toBe(before);
    expect(after).not.toBe(during);
    expect(sameStreamItem(during, after)).toBe(false);
  });

  it.each(['text', 'thinking', 'tool_use', 'result'] as const)('only substantive %s in the same known turn confirms resumed work', (eventType) => {
    const events = [evt('e1', 'error', retry(2)), evt('e2', eventType, 'new work')];
    assertPrefixes(events);
    expect(notices(buildBaseItems(events, [command()]))[0]?.transportRecovery?.state).toBe('resumed');
  });

  it('does not treat heartbeats, empty text, housekeeping, or an old tool result as recovery', () => {
    const events = [
      evt('e0', 'tool_use', 'long running command'),
      evt('e1', 'error', retry(2)),
      evt('e2', 'system', '[thinking_tokens]'),
      evt('e3', 'text', '  '),
      evt('e4', 'system', '[commands_changed]'),
      evt('e5', 'tool_result', 'old tool finished'),
      evt('e6', 'system', retry(3)),
    ];
    assertPrefixes(events);
    expect(notices(buildBaseItems(events, [command()]))).toHaveLength(1);
    expect(notices(buildBaseItems(events, [command()]))[0]?.transportRecovery?.state).toBe('recovering');
  });

  it('starts another episode after work actually resumed and keeps failures visible', () => {
    const events = [
      evt('e1', 'error', retry(2)), evt('e2', 'text', 'working'),
      evt('e3', 'system', retry(1)), evt('e4', 'error', `[cli@codex] ${detail}`),
    ];
    assertPrefixes(events);
    const base = buildBaseItems(events, [command()]);
    expect(notices(base).map((item) => item.transportRecovery?.state)).toEqual(['resumed', 'ended']);
    expect(base.items.filter((item) => item.kind === 'error')).toHaveLength(1);
  });

  it('does not hide command failure detail merely because legacy retry errors exist', () => {
    const failed = { ...command('a', 'error'), error: { code: 'cli' as const, engine: 'codex' as const, detail: 'terminal failure' } };
    const events = [evt('e1', 'error', retry(5)), evt('e2', 'error', fallback)];
    assertPrefixes(events, [failed]);
    const base = buildBaseItems(events, [failed]);
    expect(base.items.find((item) => item.kind === 'command')).toMatchObject({ error: failed.error });
    expect(notices(base)[0]?.transportRecovery?.state).toBe('ended');
    events.push(evt('e3', 'error', '[cli@codex] terminal failure'));
    expect(buildBaseItems(events, [failed]).items.find((item) => item.kind === 'command')).toMatchObject({ error: undefined });
  });

  it.each([
    { turnId: 'b' },
    { nestedUnderToolUseId: 'nested-task' },
  ])('does not use different turn/owner work to recover an earlier episode: %j', (scope) => {
    const events = [evt('e1', 'error', retry(2)), evt('e2', 'text', 'other work', scope), evt('e3', 'system', retry(3))];
    assertPrefixes(events);
    const rows = notices(buildBaseItems(events, [command()]));
    expect(rows).toHaveLength(2);
    expect(rows.map((item) => item.transportRecovery?.state)).toEqual(['ended', 'recovering']);
  });

  it('coalesces adjacent unknown history but never infers recovery without a known turn', () => {
    const events = [evt('e1', 'error', retry(2), { turnId: undefined }), evt('e2', 'system', fallback, { turnId: undefined }), evt('e3', 'text', 'unanchored work', { turnId: undefined })];
    assertPrefixes(events, []);
    expect(notices(buildBaseItems(events, []))).toHaveLength(1);
    expect(notices(buildBaseItems(events, []))[0]?.transportRecovery?.state).toBe('ended');
  });

  it('projects a stopped command without claiming success while another command keeps the session busy', () => {
    const parser = new IncrementalStreamParser();
    const events = [evt('e1', 'system', retry(2))];
    const commands = [command(), command('b', 'executing', 100)];
    const before = notices(parser.sync(events, commands))[0]!;
    const finished = [{ ...commands[0]!, status: 'completed' as const }, commands[1]!];
    const after = parser.sync(events, finished);
    expect(after).toEqual(buildBaseItems(events, finished));
    expect(before.transportRecovery?.state).toBe('recovering');
    expect(notices(after)[0]?.transportRecovery?.state).toBe('ended');
    expect(notices(parser.sync(events, commands))[0]?.transportRecovery?.state).toBe('recovering');
  });

  it('shows ended when the session stops or only waits, even if display commands still say executing', () => {
    const events = [evt('e1', 'system', fallback)];
    const parser = new IncrementalStreamParser();
    for (const [busy, waiting] of [[true, false], [false, false], [true, true]] as const) {
      const full = buildBaseItems(events, [command()], busy, waiting);
      expect(parser.sync(events, [command()], busy, waiting)).toEqual(full);
      expect(notices(full)[0]?.transportRecovery?.state).toBe(busy && !waiting ? 'recovering' : 'ended');
    }
  });

  it('rebuilds after a front trim and command turn attribution changes', () => {
    const parser = new IncrementalStreamParser();
    const events = [evt('e1', 'text', 'before'), evt('e2', 'error', retry(2)), evt('e3', 'system', fallback), evt('e4', 'text', 'after')];
    parser.sync(events.slice(0, 3), [command()]);
    expect(parser.sync(events.slice(2), [command()])).toEqual(buildBaseItems(events.slice(2), [command()]));
    const restored = events.map((event) => ({ ...event, turnId: undefined }));
    const commands = [command(), command('b', 'executing', 14)];
    expect(parser.sync(restored, commands)).toEqual(buildBaseItems(restored, commands));
    expect(notices(parser.sync(restored, commands))[0]?.transportRecovery?.state).toBe('ended');
  });
});
