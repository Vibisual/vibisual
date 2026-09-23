import type { QueuedCommand } from '@vibisual/shared';

/** Remove the whole selection before callbacks can pump the remaining queue. */
export function discardSessionQueuedCommands(
  queues: Map<string, QueuedCommand[]>,
  parentSessionId: string | null,
  subIds: ReadonlySet<string>,
  onDiscard: (command: QueuedCommand) => void,
): void {
  if (!parentSessionId) return;
  const queue = queues.get(parentSessionId);
  if (!queue) return;
  const discarded = queue.filter((command) => command.status === 'queued' && !!command.subAgentId && subIds.has(command.subAgentId));
  if (!discarded.length) return;
  const removed = new Set(discarded);
  queues.set(parentSessionId, queue.filter((command) => !removed.has(command)));
  for (const command of discarded) onDiscard(command);
}
