import { describe, expect, it } from 'vitest';
import type { QueuedCommand } from '@vibisual/shared';
import { captureAgentWorkCommandIds, followsWaitingSessionCommand, hasUnfinishedCommandDependencies } from './agentWorkDependencies.js';

const cmd = (id: string, subAgentId = 'old', status: QueuedCommand['status'] = 'queued'): QueuedCommand => ({ id, subAgentId, status, text: id, timestamp: 1 });
const owner = (sessionId: string) => sessionId === 'parent' || sessionId === 'alias' ? 'agent-a' : 'agent-b';

describe('new task dependencies', () => {
  it('captures only prior unfinished work owned by this agent, including parent aliases', () => {
    const old = cmd('old', 'old', 'executing');
    const queue = [old, cmd('queued'), cmd('done', 'old', 'completed'), cmd('failed', 'old', 'error')];
    const queues = new Map([['parent', queue], ['alias', [cmd('alias-work')]], ['foreign', [cmd('foreign-work')]]]);
    const ids = captureAgentWorkCommandIds(queues, 'parent', owner);
    expect(ids).toEqual(['old', 'queued', 'alias-work']);
    queue.push(cmd('later'));
    expect(ids).toEqual(['old', 'queued', 'alias-work']);
  });

  it('waits until all captured work ends but never waits for later submissions', () => {
    const old = cmd('old', 'old', 'executing');
    const queued = cmd('queued');
    const next = { ...cmd('new', 'new'), waitForCommandIds: ['old', 'queued'] };
    const queue = [old, queued, next];
    const queues = new Map([['parent', queue]]);
    expect(hasUnfinishedCommandDependencies(next, queues, 'parent', owner)).toBe(true);
    old.status = 'completed';
    expect(hasUnfinishedCommandDependencies(next, queues, 'parent', owner)).toBe(true);
    queue.push(cmd('later', 'old', 'executing'));
    queued.status = 'error';
    expect(hasUnfinishedCommandDependencies(next, queues, 'parent', owner)).toBe(false);
  });

  it('deleted dependencies and foreign commands with identical IDs do not hold the new task', () => {
    const next = { ...cmd('new', 'new'), waitForCommandIds: ['deleted', 'foreign-only'] };
    const queues = new Map([['parent', [next]], ['foreign', [cmd('deleted'), cmd('foreign-only')]]]);
    expect(hasUnfinishedCommandDependencies(next, queues, 'parent', owner)).toBe(false);
    expect(hasUnfinishedCommandDependencies(cmd('ordinary'), queues, 'parent', owner)).toBe(false);
  });

  it('a follow-up cannot overtake the waiting first command in its new session', () => {
    const old = cmd('old', 'old', 'executing');
    const first = { ...cmd('first', 'new'), waitForCommandIds: ['old'] };
    const follow = cmd('follow', 'new');
    const sibling = cmd('sibling', 'another');
    const queue = [old, first, follow, sibling];
    const queues = new Map([['parent', queue]]);
    const waits = (command: QueuedCommand) => hasUnfinishedCommandDependencies(command, queues, 'parent', owner);
    expect(followsWaitingSessionCommand(follow, queue, waits)).toBe(true);
    expect(followsWaitingSessionCommand(sibling, queue, waits)).toBe(false);
    old.status = 'completed';
    expect(followsWaitingSessionCommand(follow, queue, waits)).toBe(false);
  });

  it('reordering a same-session dependency below its waiter does not deadlock it', () => {
    const old = cmd('old');
    const first = { ...cmd('first'), waitForCommandIds: ['old'] };
    const queue = [first, old];
    const queues = new Map([['parent', queue]]);
    const waits = (command: QueuedCommand) => hasUnfinishedCommandDependencies(command, queues, 'parent', owner);
    expect(waits(first)).toBe(true);
    expect(followsWaitingSessionCommand(old, queue, waits)).toBe(false);
  });
});
