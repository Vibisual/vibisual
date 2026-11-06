import { randomUUID } from 'node:crypto';
import { isLockedLiveFollowUpRecord } from '@vibisual/shared';
import type { LiveFollowUpDelivery, QueuedCommand } from '@vibisual/shared';
import { isSlashCommandText } from './turnPrompt.js';

export interface LiveFollowUpOptions {
  /** Resolve on every mutation: completion in another tab can replace the queue array. */
  getQueue(): QueuedCommand[] | undefined;
  canSend(subAgentId: string): boolean;
  /**
   * false = definitely not delivered; rejection = acknowledgement could not be confirmed.
   * `onReceived` = the engine queued it and will apply it at its next step boundary (§5.5 #17-18 ⑫).
   */
  send(subAgentId: string, input: { id: string; text: string; attachments?: string[]; messageId?: string }, onReceived: () => void): Promise<boolean>;
  onChange(): void;
  /** The session accepts its next live input; the engine queue keeps the order from here. */
  onReceived(): void;
  onSettled(): void;
}

const pendingCommands = new Set<string>();
/** Session → the input it is still sending. Released on receipt, not only on settlement. */
const pendingSessions = new Map<string, string>();

export function isLiveFollowUpPending(commandId: string): boolean {
  return pendingCommands.has(commandId);
}

export function isLiveFollowUpLocked(command: QueuedCommand): boolean {
  const state = command.liveDelivery?.state;
  return isLiveFollowUpPending(command.id) || state === 'sending' || state === 'received' || state === 'uncertain';
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
  // §5.5 #17-18 ⑬ — the key to settle this input from the engine transcript if its receipt stays unconfirmed.
  const messageId = randomUUID();
  incoming.liveTarget = { commandId: base.id, messageId };
  pendingCommands.add(incoming.id);
  pendingSessions.set(subId, incoming.id);
  incoming.liveDelivery = { state: 'sending' };
  options.onChange();
  const releaseSession = (): void => {
    if (pendingSessions.get(subId) === incoming.id) pendingSessions.delete(subId);
  };
  const received = (): void => {
    if (!pendingCommands.has(incoming.id) || incoming.liveDelivery?.state !== 'sending') return;
    incoming.liveDelivery = { state: 'received', receivedAt: Date.now() };
    releaseSession();
    options.onChange();
    options.onReceived();
  };
  void (async () => {
    try {
      const accepted = await options.send(subId, { ...submitted, messageId }, received);
      if (!accepted) {
        incoming.liveDelivery = { state: 'unavailable', reason: 'deliveryRejected' };
        delete incoming.liveTarget;
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
      incoming.liveDelivery = { state: 'uncertain', reason: 'deliveryUnknown', decidedAt: Date.now() };
    } finally {
      pendingCommands.delete(incoming.id);
      releaseSession();
      options.onChange();
      options.onSettled();
    }
  })();
  return true;
}

/**
 * §5.5 #17-18 ⑬ — the turn a locked record was sent into. Prefer the stored key; a keyed turn that is gone
 * is not guessed. Legacy records without a key use the same session's latest command dispatched at or before the input.
 */
export function findLiveFollowUpBase(command: QueuedCommand, candidates: Iterable<QueuedCommand>): QueuedCommand | null {
  const keyed = command.liveTarget?.commandId;
  let latest: QueuedCommand | null = null;
  for (const candidate of candidates) {
    if (candidate === command || candidate.subAgentId !== command.subAgentId) continue;
    if (keyed) {
      if (candidate.id === keyed) return candidate;
      continue;
    }
    if (candidate.dispatchMode === 'steer' || candidate.silent) continue;
    if (candidate.status === 'queued' && candidate.startedAt === undefined) continue;
    const at = candidate.startedAt ?? candidate.timestamp;
    if (at > command.timestamp) continue;
    if (!latest || at >= (latest.startedAt ?? latest.timestamp)) latest = candidate;
  }
  return latest;
}

/**
 * §5.5 #17-18 ⑬ — the engine's own record shows it took a locked input: move it to its turn as a delivered
 * message (where accepted inputs live, §5.5 #17-18 ⑥-6 (b)) and out of the queue. Returns whether it moved.
 */
export function settleLockedLiveFollowUp(
  queue: QueuedCommand[], command: QueuedCommand, base: QueuedCommand, deliveredAt: number,
): boolean {
  if (!isLockedLiveFollowUpRecord(command)) return false;
  const index = queue.indexOf(command);
  if (index < 0) return false;
  if (!base.followUps?.some((message) => message.id === command.id)) {
    base.followUps = [...(base.followUps ?? []), {
      id: command.id, text: command.text, timestamp: command.timestamp, deliveredAt,
      ...(command.attachments?.length ? { attachments: [...command.attachments] } : {}),
    }];
  }
  queue.splice(index, 1);
  return true;
}
