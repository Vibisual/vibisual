import { describe, expect, it } from 'vitest';
import type { QueuedCommand } from '@vibisual/shared';
import { prioritizeImmediateFollowUp } from './immediateFollowUpQueue.js';

function command(id: string, partial: Partial<QueuedCommand> = {}): QueuedCommand {
  return { id, text: id, timestamp: 1, subAgentId: 'session-a', status: 'queued', dispatchMode: 'merge', ...partial };
}

describe('prioritizeImmediateFollowUp', () => {
  it('runs the selected follow-up next while preserving earlier waiting inputs and other sessions', () => {
    const active = command('active', { status: 'executing' });
    const otherQueued = command('other-queued', { subAgentId: 'session-b' });
    const waiting = command('waiting', { dispatchMode: 'wait' });
    const otherActive = command('other-active', { subAgentId: 'session-b', status: 'executing' });
    const merge = command('merge');
    const immediate = command('immediate', { dispatchMode: 'immediate', attachments: ['image.png'] });
    const queue = [active, otherQueued, waiting, otherActive, merge, immediate];
    const originalEntries = [...queue];
    const originalContents = structuredClone(queue);

    expect(prioritizeImmediateFollowUp(queue, immediate)).toBe(true);
    expect(queue).toEqual([active, otherQueued, immediate, waiting, otherActive, merge]);
    expect(queue.filter((entry) => entry !== immediate)).toEqual(originalEntries.slice(0, -1));
    expect(originalEntries).toEqual(originalContents);
    for (const entry of originalEntries) expect(queue.find((candidate) => candidate.id === entry.id)).toBe(entry);
    expect(queue.find((entry) => entry.status === 'queued' && entry.subAgentId === 'session-a')).toBe(immediate);
    expect(prioritizeImmediateFollowUp(queue, immediate)).toBe(false);
    expect(queue).toEqual([active, otherQueued, immediate, waiting, otherActive, merge]);
  });

  it('prioritizes the specifically selected immediate input without discarding earlier immediate inputs', () => {
    const earlier = command('earlier', { dispatchMode: 'immediate' });
    const selected = command('selected', { dispatchMode: 'immediate' });
    const later = command('later');
    const queue = [earlier, selected, later];
    expect(prioritizeImmediateFollowUp(queue, selected)).toBe(true);
    expect(queue).toEqual([selected, earlier, later]);
  });

  it('is idempotent and leaves completed, executing and other-session entries ahead of an already-next input', () => {
    const done = command('done', { status: 'completed' });
    const active = command('active', { status: 'executing' });
    const other = command('other', { subAgentId: 'session-b' });
    const immediate = command('immediate', { dispatchMode: 'immediate' });
    const later = command('later');
    const queue = [done, active, other, immediate, later];
    expect(prioritizeImmediateFollowUp(queue, immediate)).toBe(false);
    expect(queue).toEqual([done, active, other, immediate, later]);
    expect(prioritizeImmediateFollowUp(queue, later)).toBe(false);
  });

  it.each([undefined, 'wait', 'merge'] as const)('never reprioritizes dispatch mode %s', (dispatchMode) => {
    const first = command('first');
    const selected = command('selected', { dispatchMode });
    const queue = [first, selected];
    expect(prioritizeImmediateFollowUp(queue, selected)).toBe(false);
    expect(queue).toEqual([first, selected]);
  });

  it.each(['executing', 'completed', 'error'] as const)('never moves a command already %s', (status) => {
    const first = command('first');
    const selected = command('selected', { status, dispatchMode: 'immediate' });
    const queue = [first, selected];
    expect(prioritizeImmediateFollowUp(queue, selected)).toBe(false);
    expect(queue).toEqual([first, selected]);
  });

  it.each([null, ''])('does not treat an unassigned session %j as a shared queue', (subAgentId) => {
    const first = command('first', { subAgentId });
    const selected = command('selected', { subAgentId, dispatchMode: 'immediate' });
    const queue = [first, selected];
    expect(prioritizeImmediateFollowUp(queue, selected)).toBe(false);
    expect(queue).toEqual([first, selected]);
  });

  it('does not insert a missing command or a stale copy of one with the same id', () => {
    const first = command('first');
    const selected = command('selected', { dispatchMode: 'immediate' });
    const queue = [first, selected];
    expect(prioritizeImmediateFollowUp([], selected)).toBe(false);
    expect(prioritizeImmediateFollowUp(queue, { ...selected })).toBe(false);
    expect(prioritizeImmediateFollowUp(queue, command('missing', { dispatchMode: 'immediate' }))).toBe(false);
    expect(queue).toEqual([first, selected]);
  });
});
