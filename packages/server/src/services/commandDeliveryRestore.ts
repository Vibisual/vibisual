import type { QueuedCommand } from '@vibisual/shared';

/** Restored live inputs cannot resume delivery to the previous process's active turn. */
export function restoreCommandDelivery(command: QueuedCommand): QueuedCommand {
  if (command.liveDelivery?.state === 'sending') {
    return { ...command, liveDelivery: { state: 'uncertain', reason: 'deliveryUnknown' } };
  }
  if (command.status === 'queued' && command.dispatchMode === 'steer' && !command.liveDelivery) {
    return { ...command, liveDelivery: { state: 'unavailable', reason: 'noActiveTurn' } };
  }
  return command;
}
