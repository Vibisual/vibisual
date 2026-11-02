import type { LiveFollowUpDelivery, QueuedCommand } from '@vibisual/shared';
import { isSlashCommandText } from './turnPrompt.js';

export interface LiveFollowUpOptions {
  /** Resolve on every mutation: completion in another tab can replace the queue array. */
  getQueue(): QueuedCommand[] | undefined;
  canSend(subAgentId: string): boolean;
  /** false = definitely not delivered; rejection = acknowledgement could not be confirmed. */
  send(subAgentId: string, input: { id: string; text: string; attachments?: string[] }): Promise<boolean>;
  onChange(): void;
  onSettled(): void;
}

const pendingCommands = new Set<string>();
const pendingSessions = new Set<string>();

export function isLiveFollowUpPending(commandId: string): boolean {
  return pendingCommands.has(commandId);
}

export function isLiveFollowUpLocked(command: QueuedCommand): boolean {
  return isLiveFollowUpPending(command.id)
    || command.liveDelivery?.state === 'sending' || command.liveDelivery?.state === 'uncertain';
}

function needsOwnTurn(command: QueuedCommand): boolean {
  return Boolean(command.edgeId || command.orchestraRunId || command.silent
    || command.executionRequirements || command.runLimits || command.waitForCommandIds?.length
    || isSlashCommandText(command.text));
}

function sameAppSelection(a: QueuedCommand, b: QueuedCommand): boolean {
  if (a.appNodesOff !== b.appNodesOff) return false;
  const aIds = a.appNodeIds ?? [];
  const bIds = b.appNodeIds ?? [];
  return aIds.length === bIds.length && aIds.every((id, index) => id === bIds[index]);
}

/** Only explicit steer inputs use this path. It never interrupts, merges prompt text, or starts another turn. */
export function trySendLiveFollowUp(incoming: QueuedCommand, options: LiveFollowUpOptions): boolean {
  if (incoming.status !== 'queued' || incoming.dispatchMode !== 'steer') return false;
  if (isLiveFollowUpLocked(incoming)) return true;
  if (incoming.liveDelivery?.state === 'unavailable') return false;
  const queue = options.getQueue();
  if (!queue?.includes(incoming)) return false;
  const unavailable = (reason: LiveFollowUpDelivery['reason']): false => {
    incoming.liveDelivery = { state: 'unavailable', reason };
    options.onChange();
    return false;
  };
  const subId = incoming.subAgentId;
  if (!subId) return unavailable('noActiveTurn');
  if (pendingSessions.has(subId)) return true;
  const active = queue.filter((command) => command.subAgentId === subId && command.status === 'executing');
  if (active.length !== 1) return unavailable('noActiveTurn');
  const base = active[0]!;
  if (needsOwnTurn(base) || needsOwnTurn(incoming) || !sameAppSelection(base, incoming)) return unavailable('turnScope');
  if (!options.canSend(subId)) return unavailable('unsupported');

  const submitted = {
    id: incoming.id, text: incoming.text, timestamp: incoming.timestamp,
    ...(incoming.attachments?.length ? { attachments: [...incoming.attachments] } : {}),
  };
  pendingCommands.add(incoming.id);
  pendingSessions.add(subId);
  incoming.liveDelivery = { state: 'sending' };
  options.onChange();
  void (async () => {
    try {
      const accepted = await options.send(subId, submitted);
      if (!accepted) {
        incoming.liveDelivery = { state: 'unavailable', reason: 'deliveryRejected' };
      } else {
        // Keep a stable independent message ID, original input and attachments in history.
        // The engine adapter delays completion until this acknowledgement has been recorded.
        base.followUps = [...(base.followUps ?? []), { ...submitted, deliveredAt: Date.now() }];
        const currentQueue = options.getQueue();
        const currentIndex = currentQueue?.indexOf(incoming) ?? -1;
        if (currentIndex >= 0) currentQueue!.splice(currentIndex, 1);
      }
    } catch {
      // The provider may already have read it. Keep the input visible and never replay it.
      incoming.liveDelivery = { state: 'uncertain', reason: 'deliveryUnknown' };
    } finally {
      pendingCommands.delete(incoming.id);
      pendingSessions.delete(subId);
      options.onChange();
      options.onSettled();
    }
  })();
  return true;
}
