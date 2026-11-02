import type { QueuedCommand } from '@vibisual/shared';

/**
 * Put the explicitly selected immediate follow-up before this session's queued work.
 * Call after settling a silent-compaction heir, before interruption can synchronously complete the turn and dispatch the next entry.
 * Other entries keep their identity, contents and relative order.
 */
export function prioritizeImmediateFollowUp(queue: QueuedCommand[], command: QueuedCommand): boolean {
  if (command.status !== 'queued' || command.dispatchMode !== 'immediate' || !command.subAgentId) return false;
  const commandIndex = queue.indexOf(command);
  if (commandIndex < 0) return false;
  const firstQueuedIndex = queue.findIndex((entry, index) => index < commandIndex
    && entry.status === 'queued' && entry.subAgentId === command.subAgentId);
  if (firstQueuedIndex < 0) return false;

  queue.splice(commandIndex, 1);
  queue.splice(firstQueuedIndex, 0, command);
  return true;
}
