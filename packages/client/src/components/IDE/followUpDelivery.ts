import type { LiveFollowUpDelivery, QueuedCommand } from '@vibisual/shared';

export interface FollowUpDeliveryDisplay {
  state: LiveFollowUpDelivery['state'] | 'waiting' | 'delivered';
  reason?: LiveFollowUpDelivery['reason'];
}

export function followUpDeliveryOf(command: Pick<QueuedCommand, 'dispatchMode' | 'liveDelivery'>): FollowUpDeliveryDisplay | undefined {
  if (command.dispatchMode !== 'steer') return undefined;
  return command.liveDelivery ?? { state: 'waiting' };
}

/**
 * Unknown delivery must not offer a second send or erase the only visible record.
 * `received` is already in the engine queue (§5.5 #17-18 ⑫) — a second send would apply it twice.
 */
export function isFollowUpDeliveryLocked(delivery: FollowUpDeliveryDisplay | undefined): boolean {
  return delivery?.state === 'sending' || delivery?.state === 'received' || delivery?.state === 'uncertain';
}

export function sameFollowUpDelivery(a: FollowUpDeliveryDisplay | undefined, b: FollowUpDeliveryDisplay | undefined): boolean {
  return a?.state === b?.state && a?.reason === b?.reason;
}
