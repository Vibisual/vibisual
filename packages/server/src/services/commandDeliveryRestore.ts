import type { QueuedCommand } from '@vibisual/shared';

/**
 * Restored live inputs cannot resume delivery to the previous process's active turn.
 * Called through `Array.map` — keep a single parameter (a second one would receive the index).
 */
export function restoreCommandDelivery(command: QueuedCommand): QueuedCommand {
  // §5.5 #17-18 ⑫ — a received input died with the old process's queue; whether it ran is unknown.
  if (command.liveDelivery?.state === 'sending' || command.liveDelivery?.state === 'received') {
    // §5.5 #17-18 ⑥-6 — the bubble was trailing the old output; it stays there, not at its input time.
    return { ...command, liveDelivery: { state: 'uncertain', reason: 'deliveryUnknown', decidedAt: Date.now() } };
  }
  if (command.status === 'queued' && command.dispatchMode === 'steer' && !command.liveDelivery) {
    return { ...command, liveDelivery: { state: 'unavailable', reason: 'noActiveTurn' } };
  }
  return command;
}
