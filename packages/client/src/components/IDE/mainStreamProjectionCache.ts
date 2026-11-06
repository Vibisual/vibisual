import type { QueuedCommand, SubAgentStreamEvent } from '@vibisual/shared';

interface ProjectionInput {
  readonly events: readonly SubAgentStreamEvent[];
  readonly anchors: readonly { id: string; ts: number }[];
  readonly commands: readonly QueuedCommand[];
  readonly running: boolean;
  readonly label: string | undefined;
  readonly formatError: unknown;
}

interface ProjectionRecord<T> {
  events: SubAgentStreamEvent[];
  anchors: Array<{ id: string; ts: number }>;
  commands: Array<{ id: string; status: QueuedCommand['status'] }>;
  running: boolean;
  label: string | undefined;
  formatError: unknown;
  rows: readonly T[];
}

function sameEvent(a: SubAgentStreamEvent, b: SubAgentStreamEvent): boolean {
  return a.id === b.id && a.subAgentId === b.subAgentId && a.parentAgentId === b.parentAgentId
    && Object.is(a.timestamp, b.timestamp) && a.eventType === b.eventType && a.content === b.content
    && a.toolName === b.toolName && a.toolUseId === b.toolUseId && a.imagePath === b.imagePath
    && a.turnId === b.turnId && a.nestedUnderToolUseId === b.nestedUnderToolUseId;
}

/**
 * One projection per currently supplied session. Replaying a changed session is deliberate:
 * late events, truncation and error/recovery promotion can alter earlier rows. Unchanged
 * sessions reuse their rows without reparsing large text. Primitive snapshots also detect
 * callers replacing or mutating an event in place; array identity alone is not a cache key.
 */
export class MainStreamProjectionCache<T> {
  private sessions = new Map<string, ProjectionRecord<T>>();

  retain(sessionIds: ReadonlySet<string>): void {
    for (const id of this.sessions.keys()) if (!sessionIds.has(id)) this.sessions.delete(id);
  }

  get(id: string, input: ProjectionInput): readonly T[] | undefined {
    const saved = this.sessions.get(id);
    if (!saved || saved.running !== input.running || saved.label !== input.label || saved.formatError !== input.formatError
      || saved.events.length !== input.events.length || saved.anchors.length !== input.anchors.length
      || saved.commands.length !== input.commands.length) return undefined;
    for (let i = 0; i < input.anchors.length; i++) {
      const a = saved.anchors[i]!, b = input.anchors[i]!;
      if (a.id !== b.id || !Object.is(a.ts, b.ts)) return undefined;
    }
    // These are the only command fields TransportRecoveryAccumulator.projectStopped reads.
    // Dispatch timing is already represented by the exact anchor list above.
    for (let i = 0; i < input.commands.length; i++) {
      const a = saved.commands[i]!, b = input.commands[i]!;
      if (a.id !== b.id || a.status !== b.status) return undefined;
    }
    for (let i = 0; i < input.events.length; i++) if (!sameEvent(saved.events[i]!, input.events[i]!)) return undefined;
    return saved.rows;
  }

  set(id: string, input: ProjectionInput, rows: readonly T[]): void {
    this.sessions.set(id, {
      events: input.events.map((event) => ({ ...event })),
      anchors: input.anchors.map((anchor) => ({ ...anchor })),
      commands: input.commands.map(({ id: commandId, status }) => ({ id: commandId, status })),
      running: input.running, label: input.label, formatError: input.formatError, rows,
    });
  }
}
