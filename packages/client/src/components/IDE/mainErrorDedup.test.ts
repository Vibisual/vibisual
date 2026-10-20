import { describe, expect, it, vi } from 'vitest';
import type { QueuedCommand, SubAgent, SubAgentStreamEvent } from '@vibisual/shared';
vi.mock('./IDETerminalPanes.js', () => ({ IDETerminalPanes: () => null }));
import { buildEntries } from './IDEMainArea.js';

const DETAIL = 'Selected model is at capacity. Please try a different model.';
const formatError = (error: { detail?: string }): string => `Failure: ${error.detail ?? ''}`;
const sub = (id: string): SubAgent => ({ id, sessionId: id, label: id, parentAgentId: 'P', status: 'error', createdAt: 0, lastActivityAt: 0 });
const command = (id: string, subAgentId = 'S', timestamp = 1): QueuedCommand => ({
  id, subAgentId, text: 'Work', status: 'error', timestamp, startedAt: timestamp,
  error: { code: 'cli', engine: 'codex', detail: DETAIL },
});
const event = (id: string, content: string, turnId = 'a', subAgentId = 'S'): SubAgentStreamEvent => ({
  id, content, turnId, subAgentId, parentAgentId: 'P', eventType: 'error', timestamp: id === 'raw' ? 2 : 3,
});

describe('main transcript provider failures', () => {
  it.each([null, 'S'])('shows one rich error in view %s, preserving raw detail and search text', (selected) => {
    const events = [event('raw', DETAIL), event('typed', `[cli@codex] ${DETAIL}`)];
    const entries = buildEntries([command('a')], [sub('S')], { S: events }, selected, [], formatError);
    expect(entries.filter((entry) => entry.type === 'error')).toEqual([
      expect.objectContaining({ id: 'raw', timestamp: 2, text: `Failure: ${DETAIL}`, error: { code: 'cli', engine: 'codex', detail: DETAIL } }),
    ]);
  });

  it('keeps different commands and sessions while coalescing each terminal duplicate', () => {
    const entries = buildEntries(
      [command('a'), command('b', 'S', 4), command('c', 'T')], [sub('S'), sub('T')],
      {
        S: [event('raw', DETAIL), event('typed', `[cli@codex] ${DETAIL}`), event('b', `[cli@codex] ${DETAIL}`, 'b')],
        T: [event('raw-t', DETAIL, 'c', 'T'), event('typed-t', `[cli@codex] ${DETAIL}`, 'c', 'T')],
      }, null, [], formatError,
    );
    expect(entries.filter((entry) => entry.type === 'error').map((entry) => entry.id)).toEqual(['raw', 'b', 'raw-t']);
  });

  it('retains structured saved failures when no error stream remains', () => {
    const saved = command('a');
    const entries = buildEntries([saved], [sub('S')], {}, null, [], formatError);
    expect(entries.find((entry) => entry.id === 'cmderr-a')).toMatchObject({ error: saved.error, text: `Failure: ${DETAIL}` });
  });
});
