import { describe, expect, it, vi } from 'vitest';
import type { QueuedCommand, SubAgent, SubAgentStreamEvent } from '@vibisual/shared';
vi.mock('./IDETerminalPanes.js', () => ({ IDETerminalPanes: () => null }));
import { buildEntries } from './IDEMainArea.js';
import { buildBaseItems, IncrementalStreamParser } from './streamItems.js';

const NOTICE = 'This session was recorded with model `gpt-6-astra` but is resuming with `gpt-6.1-sol`. Consider switching back to `gpt-6-astra` as it may affect Codex performance.';
const CODE_MODE = 'Code Mode is unavailable because failed to spawn code-mode host /opt/codex/codex-code-mode-host: host executable was not found. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.';
const TIER = 'Configured service tier `priority` is not advertised as supported for model `gpt-reserve` and will be omitted from requests.';
const NOTICES = [NOTICE, CODE_MODE, TIER];
const RETRY = 'Reconnecting... 2/5 (stream disconnected before completion: websocket closed by server before response.completed)';
const formatError = (error: { detail?: string }): string => `Failure: ${error.detail ?? ''}`;
const command = (status: QueuedCommand['status'] = 'executing'): QueuedCommand => ({
  id: 'a', text: 'Work', status, timestamp: 1, startedAt: 1, subAgentId: 'S',
});
const sub = (): SubAgent => ({
  id: 'S', sessionId: 'thread', label: 'Session', parentAgentId: 'P', status: 'active', createdAt: 0, lastActivityAt: 0,
});
const event = (id: number, eventType: SubAgentStreamEvent['eventType'], content: string): SubAgentStreamEvent => ({
  id: `e${id}`, eventType, content, timestamp: id + 10, parentAgentId: 'P', subAgentId: 'S', turnId: 'a',
});

function assertPrefixes(events: SubAgentStreamEvent[], commands: QueuedCommand[] = [command()]): void {
  const parser = new IncrementalStreamParser();
  for (let length = 0; length <= events.length; length++) {
    const prefix = events.slice(0, length);
    expect(parser.sync(prefix, commands)).toEqual(buildBaseItems(prefix, commands));
  }
}

describe('Codex session advisories in restored transcripts', () => {
  it.each(NOTICES)('displays legacy errors and new notices while preserving stored records: %s', (notice) => {
    const events = [event(1, 'error', notice), event(2, 'system', notice), event(3, 'text', 'Working with the selected model.')];
    const before = structuredClone(events);
    assertPrefixes(events);
    const base = buildBaseItems(events, [command()]);
    expect(base.items.filter((item) => item.kind === 'error')).toEqual([]);
    expect(base.items.filter((item) => item.kind === 'system')).toEqual([
      { kind: 'system', id: 'e1', content: notice, timestamp: 11 },
      { kind: 'system', id: 'e2', content: notice, timestamp: 12 },
    ]);
    expect(base.items.find((item) => item.kind === 'command')).toMatchObject({ status: 'executing' });
    expect(base.agentBusy).toBe(true);
    expect(events).toEqual(before);
  });

  it.each(NOTICES)('keeps saved terminal failure when only an advisory remains: %s', (notice) => {
    const failed = { ...command('error'), error: { code: 'cli' as const, engine: 'codex' as const, detail: 'Model unavailable' } };
    const events = [event(1, 'error', notice)];
    assertPrefixes(events, [failed]);
    expect(buildBaseItems(events, [failed]).items.find((item) => item.kind === 'command')).toMatchObject({ error: failed.error });
    for (const selected of [null, 'S']) {
      const entries = buildEntries([failed], [sub()], { S: events }, selected, [], formatError);
      expect(entries.filter((entry) => entry.type === 'error')).toEqual([
        expect.objectContaining({ id: 'cmderr-a', text: 'Failure: Model unavailable', error: failed.error }),
      ]);
    }
  });

  it.each(NOTICES)('preserves explicit terminal failures that repeat the advisory: %s', (notice) => {
    const terminal = `[cli@codex] ${notice}`;
    const events = [event(1, 'error', notice), event(2, 'error', terminal)];
    assertPrefixes(events);
    expect(buildBaseItems(events, [command()]).items.filter((item) => item.kind === 'error')).toEqual([
      { kind: 'error', id: 'e2', content: terminal, timestamp: 12 },
    ]);
    const entries = buildEntries([command()], [sub()], { S: events }, null, [], formatError);
    expect(entries.filter((entry) => entry.type === 'error')).toEqual([
      expect.objectContaining({ id: 'e2', error: { code: 'cli', engine: 'codex', detail: notice } }),
    ]);
  });

  it('retains real model failures alongside the advisory', () => {
    const detail = "The selected model is not supported when using Codex with a ChatGPT account.";
    const events = [event(1, 'error', NOTICE), event(2, 'error', detail)];
    assertPrefixes(events);
    expect(buildBaseItems(events, [command()]).items.filter((item) => item.kind === 'error')).toEqual([
      { kind: 'error', id: 'e2', content: detail, timestamp: 12 },
    ]);
  });

  it('does not reclassify assistant text or tool output quoting the advisory', () => {
    const events = [event(1, 'text', NOTICE), event(2, 'tool_result', NOTICE)];
    assertPrefixes(events);
    const items = buildBaseItems(events, [command()]).items;
    expect(items.find((item) => item.id === 'e1')).toMatchObject({ kind: 'text', content: NOTICE });
    expect(items.find((item) => item.id === 'e2')).toMatchObject({ kind: 'system', content: NOTICE });
    const entries = buildEntries([command()], [sub()], { S: events }, null, [], formatError);
    expect(entries.find((entry) => entry.id === 'e1')).toMatchObject({ type: 'text', text: NOTICE });
    expect(entries.find((entry) => entry.id === 'e2')).toMatchObject({ type: 'tool_result', text: NOTICE });
  });

  it('does not end a transport recovery episode when a restored advisory follows it', () => {
    const events = [event(1, 'error', RETRY), event(2, 'error', NOTICE)];
    assertPrefixes(events);
    expect(buildBaseItems(events, [command()]).items.find((item) => item.id === 'e1')).toMatchObject({
      kind: 'system', transportRecovery: { state: 'recovering' },
    });
    events.push(event(3, 'text', 'Resumed'));
    assertPrefixes(events);
    expect(buildBaseItems(events, [command()]).items.find((item) => item.id === 'e1')).toMatchObject({
      transportRecovery: { state: 'resumed' },
    });
  });

  it.each([null, 'S'])('uses the same advisory display in main transcript view %s', (selected) => {
    const events = NOTICES.map((notice, index) => event(index + 1, 'error', notice));
    const entries = buildEntries([command()], [sub()], { S: events }, selected, [], formatError);
    for (const raw of events) {
      expect(entries.find((entry) => entry.id === raw.id)).toMatchObject({ type: 'system', text: raw.content });
      expect(entries.find((entry) => entry.id === raw.id)).not.toHaveProperty('error');
      expect(raw.eventType).toBe('error');
    }
    expect(entries.some((entry) => entry.type === 'error')).toBe(false);
  });

  it.each(NOTICES)('restores nested historical advisory envelopes as readable notices: %s', (notice) => {
    const content = JSON.stringify({ type: 'error', error: { message: notice } });
    const raw = event(1, 'error', content);
    const events = [raw];
    assertPrefixes(events);
    expect(buildBaseItems(events, [command()]).items.find((item) => item.id === raw.id)).toEqual({
      kind: 'system', id: 'e1', content: notice, timestamp: 11,
    });
    for (const selected of [null, 'S']) {
      const entries = buildEntries([command()], [sub()], { S: events }, selected, [], formatError);
      expect(entries.find((entry) => entry.id === raw.id)).toMatchObject({ type: 'system', text: notice });
      expect(entries.some((entry) => entry.type === 'error')).toBe(false);
    }
    expect(raw).toMatchObject({ eventType: 'error', content });
  });

  it.each([
    { type: 'error', error: { message: 'The selected model is not supported.' } },
    { type: 'error', message: 'Terminal provider failure', error: { message: NOTICE } },
    { type: 'turn.failed', error: { message: NOTICE } },
  ])('retains genuine or explicit terminal JSON failures: %j', (envelope) => {
    const content = JSON.stringify(envelope);
    const events = [event(1, 'error', content)];
    assertPrefixes(events);
    expect(buildBaseItems(events, [command()]).items.find((item) => item.id === 'e1')).toMatchObject({ kind: 'error', content });
    expect(buildEntries([command()], [sub()], { S: events }, null, [], formatError).find((entry) => entry.id === 'e1')).toMatchObject({ type: 'error' });
  });

  it('keeps incremental rebuilds consistent after history is trimmed and a command finishes', () => {
    const events = [event(1, 'text', 'Before'), event(2, 'error', NOTICE), event(3, 'text', 'After')];
    const parser = new IncrementalStreamParser();
    parser.sync(events.slice(0, 2), [command()]);
    expect(parser.sync(events, [command()])).toEqual(buildBaseItems(events, [command()]));
    const restored = events.slice(1);
    expect(parser.sync(restored, [command('completed')])).toEqual(buildBaseItems(restored, [command('completed')]));
  });
});
