import { describe, expect, it, vi } from 'vitest';
import type { QueuedCommand, SubAgent, SubAgentStreamEvent } from '@vibisual/shared';
// The pure transcript builders do not mount the terminal or need a browser terminal implementation.
vi.mock('./IDETerminalPanes.js', () => ({ IDETerminalPanes: () => null }));
import { applyMainDensity, buildEntries, groupEntries } from './IDEMainArea.js';

const RETRY = 'Reconnecting... 2/5 (stream disconnected before completion: websocket closed by server before response.completed)';
const FALLBACK = 'Falling back from WebSockets to HTTPS transport. stream disconnected before completion: websocket closed by server before response.completed';
const formatError = (error: { detail?: string }): string => `Failure: ${error.detail ?? ''}`;

function sub(id: string, status: SubAgent['status'] = 'active'): SubAgent {
  return { id, sessionId: id, label: id, parentAgentId: 'P', status, createdAt: 0, lastActivityAt: 0 };
}
function command(subAgentId: string, status: QueuedCommand['status'] = 'executing'): QueuedCommand {
  return { id: `cmd-${subAgentId}`, text: 'Work', timestamp: 1, startedAt: 1, subAgentId, status };
}
function event(id: string, subAgentId: string, eventType: SubAgentStreamEvent['eventType'], content: string, timestamp: number): SubAgentStreamEvent {
  return { id, subAgentId, parentAgentId: 'P', turnId: `cmd-${subAgentId}`, eventType, content, timestamp };
}

describe('main transcript transport recovery', () => {
  it('coalesces persisted errors and new system notices, with hidden thinking proving resumption', () => {
    const events = [event('r1', 'S', 'error', RETRY, 2), event('r2', 'S', 'system', FALLBACK, 3), event('think', 'S', 'thinking', 'Working again', 4)];
    for (const selected of [null, 'S']) {
      const entries = buildEntries([command('S')], [sub('S')], { S: events }, selected, [], formatError);
      const recoveries = entries.filter((entry) => entry.transportRecovery);
      expect(recoveries).toHaveLength(1);
      expect(recoveries[0]).toMatchObject({ id: 'r1', type: 'system', text: FALLBACK, transportRecovery: { state: 'resumed', notice: { kind: 'fallback' } } });
      expect(entries.some((entry) => entry.type === 'error')).toBe(false);
      expect(entries.some((entry) => entry.type === 'thinking')).toBe(false);
    }
  });

  it('does not keep one session recovering because another session is active', () => {
    const entries = buildEntries(
      [command('old'), command('live')], [sub('old', 'idle'), sub('live')],
      { old: [event('r1', 'old', 'error', RETRY, 2)], live: [event('r2', 'live', 'error', RETRY, 2)] },
      null, [], formatError,
    );
    expect(entries.find((entry) => entry.id === 'r1')?.transportRecovery?.state).toBe('ended');
    expect(entries.find((entry) => entry.id === 'r2')?.transportRecovery?.state).toBe('recovering');
  });

  it('keeps saved final failure visible when only a retry error remains in the stream', () => {
    const failed = { ...command('S', 'error'), error: { code: 'exit' as const, detail: 'Network unavailable' } };
    const entries = buildEntries([failed], [sub('S', 'error')], { S: [event('r1', 'S', 'error', RETRY, 2)] }, null, [], formatError);
    expect(entries.find((entry) => entry.id === 'r1')?.transportRecovery?.state).toBe('ended');
    expect(entries.filter((entry) => entry.type === 'error')).toEqual([
      expect.objectContaining({ id: 'cmderr-cmd-S', text: 'Failure: Network unavailable' }),
    ]);
  });

  it('does not revive a queued command that displayCommands promoted for presentation', () => {
    const entries = buildEntries(
      [command('S')], [sub('S')], { S: [event('r1', 'S', 'system', RETRY, 2)] },
      null, [], formatError, [command('S', 'queued')],
    );
    expect(entries.find((entry) => entry.id === 'r1')?.transportRecovery?.state).toBe('ended');
  });

  it('keeps recovery outside tool groups in all three densities', () => {
    const events = [event('tool1', 'S', 'tool_use', '{}', 2), event('r1', 'S', 'error', RETRY, 3), event('tool2', 'S', 'tool_use', '{}', 4)];
    const entries = buildEntries([command('S')], [sub('S')], { S: events }, null, [], formatError);
    for (const density of ['compact', 'standard', 'raw'] as const) {
      const items = applyMainDensity(groupEntries(entries), density);
      expect(items.filter((item) => item.kind === undefined && item.transportRecovery)).toHaveLength(1);
      expect(items.filter((item) => item.kind === 'group').every((item) => item.entries.every((entry) => !entry.transportRecovery))).toBe(true);
    }
  });
});
