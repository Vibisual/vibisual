import { readCodexTransportNotice, type CodexTransportNotice, type QueuedCommand, type SubAgentStreamEvent } from '@vibisual/shared';
import type { StreamItemFull, StreamSystem } from './streamItems.js';

/** Display state only: ended records an attempt without claiming that it recovered. */
export interface StreamTransportRecovery {
  notice: CodexTransportNotice;
  state: 'recovering' | 'resumed' | 'ended';
}

interface OpenRecovery {
  index: number;
  turnId: string | null;
  owner: string | undefined;
}

function isRecoveryEvidence(evt: SubAgentStreamEvent): boolean {
  // An old tool can finish while the model connection is still down. Likewise, heartbeats and
  // housekeeping system messages are not evidence that model output has resumed.
  return (evt.eventType === 'text' || evt.eventType === 'thinking'
    || evt.eventType === 'tool_use' || evt.eventType === 'result') && evt.content.trim() !== '';
}

/**
 * One transport episode in the raw event stream. Both parsers (and the main transcript) feed
 * each event once. Indices stay stable because this only appends or replaces existing objects.
 */
export class TransportRecoveryAccumulator {
  private open: OpenRecovery | null = null;

  private settle(items: StreamItemFull[], state: 'resumed' | 'ended'): void {
    if (!this.open) return;
    const item = items[this.open.index];
    if (item?.kind === 'system' && item.transportRecovery) {
      items[this.open.index] = { ...item, transportRecovery: { ...item.transportRecovery, state } };
    }
    this.open = null;
  }

  /** Returns true only when this event is a transport notice and its normal row must be omitted. */
  consume(evt: SubAgentStreamEvent, turnId: string | null, items: StreamItemFull[]): boolean {
    if (this.open && (this.open.turnId !== turnId || this.open.owner !== evt.nestedUnderToolUseId)) {
      this.settle(items, 'ended');
    }

    const notice = readCodexTransportNotice(evt);
    if (notice) {
      if (this.open) {
        const previous = items[this.open.index] as StreamSystem;
        items[this.open.index] = {
          ...previous, content: evt.content, transportRecovery: { notice, state: 'recovering' },
        };
      } else {
        this.open = { index: items.length, turnId, owner: evt.nestedUnderToolUseId };
        items.push({
          kind: 'system', id: evt.id, content: evt.content, timestamp: evt.timestamp,
          transportRecovery: { notice, state: 'recovering' },
        });
      }
      return true;
    }

    if (evt.eventType === 'error') this.settle(items, 'ended');
    else if (isRecoveryEvidence(evt)) {
      // Unanchored restored history cannot prove that later work belongs to the same turn.
      this.settle(items, turnId === null ? 'ended' : 'resumed');
    }
    return false;
  }

  /**
   * Project current command/session state onto a caller-owned output array. Keep the accumulator's
   * raw state intact so status-only changes need no raw-event replay and late real output still wins.
   */
  projectStopped(items: StreamItemFull[], commands: readonly QueuedCommand[] | undefined, sessionRunning: boolean): void {
    if (!this.open) return;
    const command = this.open.turnId === null ? undefined : commands?.find((cmd) => cmd.id === this.open!.turnId);
    if (sessionRunning && (!command || command.status === 'executing')) return;
    const item = items[this.open.index];
    if (item?.kind === 'system' && item.transportRecovery) {
      items[this.open.index] = { ...item, transportRecovery: { ...item.transportRecovery, state: 'ended' } };
    }
  }
}

export function sameTransportRecovery(a?: StreamTransportRecovery, b?: StreamTransportRecovery): boolean {
  if (a === b) return true;
  if (!a || !b || a.state !== b.state || a.notice.kind !== b.notice.kind) return false;
  return a.notice.kind === 'fallback'
    || (b.notice.kind === 'reconnecting' && a.notice.attempt === b.notice.attempt && a.notice.maxAttempts === b.notice.maxAttempts);
}
