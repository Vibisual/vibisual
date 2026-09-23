import { expect, it } from 'vitest';
import type { QueuedCommand } from '@vibisual/shared';
import { discardSessionQueuedCommands } from './sessionCommandDiscard.js';

it('closing several tabs removes all their waiting commands before completion callbacks dispatch again', () => {
  const command = (id: string, subAgentId: string, status: QueuedCommand['status'] = 'queued'): QueuedCommand =>
    ({ id, subAgentId, status, text: id, timestamp: 1 });
  const active = command('active-a', 'a', 'executing');
  const sibling = command('sibling', 'c');
  const otherProject = command('other-project', 'd');
  const queues = new Map([['project-a', [active, command('wait-a', 'a'), command('wait-b', 'b'), sibling]], ['project-b', [otherProject]]]);
  const notified: string[] = [];
  discardSessionQueuedCommands(queues, 'project-a', new Set(['a', 'b']), (removed) => {
    // A synchronous completion callback sees no work that could revive the tabs being closed.
    expect(queues.get('project-a')).toEqual([active, sibling]);
    notified.push(removed.id);
  });
  expect(notified).toEqual(['wait-a', 'wait-b']);
  expect(queues.get('project-b')).toEqual([otherProject]);
  discardSessionQueuedCommands(queues, 'project-a', new Set(['a', 'b']), () => { throw new Error('already discarded'); });
});
