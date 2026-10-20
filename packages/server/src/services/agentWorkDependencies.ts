import type { QueuedCommand } from '@vibisual/shared';

type Queues = ReadonlyMap<string, readonly QueuedCommand[]>;
type AgentForSession = (sessionId: string) => string | null | undefined;
const unfinished = (command: QueuedCommand): boolean => command.status === 'queued' || command.status === 'executing';

function ownQueues(queues: Queues, sessionId: string, agentForSession: AgentForSession): readonly QueuedCommand[][] {
  const agentId = agentForSession(sessionId);
  const result: QueuedCommand[][] = [];
  for (const [id, queue] of queues) {
    if (id === sessionId || (agentId && agentForSession(id) === agentId)) result.push([...queue]);
  }
  return result;
}

/** Snapshot only IDs already accepted in this agent's queues, including aliases of its parent session. */
export function captureAgentWorkCommandIds(queues: Queues, sessionId: string, agentForSession: AgentForSession): string[] {
  return [...new Set(ownQueues(queues, sessionId, agentForSession).flatMap((queue) => queue.filter(unfinished).map((command) => command.id)))];
}

/** Completion, error, cancellation, or removal all release the captured dependency. */
export function hasUnfinishedCommandDependencies(command: QueuedCommand, queues: Queues, sessionId: string, agentForSession: AgentForSession): boolean {
  if (!command.waitForCommandIds?.length) return false;
  const ids = new Set(command.waitForCommandIds);
  return ownQueues(queues, sessionId, agentForSession).some((queue) => queue.some((candidate) =>
    candidate.id !== command.id && ids.has(candidate.id) && unfinished(candidate)));
}

/** A follow-up must not overtake a waiting first request in its new conversation. */
export function followsWaitingSessionCommand(command: QueuedCommand, queue: readonly QueuedCommand[], waits: (candidate: QueuedCommand) => boolean): boolean {
  for (const prior of queue) {
    if (prior === command) break;
    if (prior.status === 'queued' && prior.subAgentId === command.subAgentId && waits(prior)
      // Reordering a dependency below its waiter must not deadlock the same session.
      && !prior.waitForCommandIds?.includes(command.id)) return true;
  }
  return false;
}
