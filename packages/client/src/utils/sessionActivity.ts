import type { QueuedCommand, SubAgent, SubAgentStreamEvent } from '@vibisual/shared';

/** Activity uses server timestamps, never the time a history page was downloaded. */
export function sessionLastActivityAt(
  subs: readonly SubAgent[],
  streams: Readonly<Record<string, readonly SubAgentStreamEvent[]>>,
  commands: readonly QueuedCommand[],
  sessionId: string | null,
): number | null {
  let last = 0;
  const note = (at: number | undefined): void => {
    if (typeof at === 'number' && Number.isFinite(at) && at > last) last = at;
  };
  for (const sub of subs) {
    if (sessionId !== null && sub.id !== sessionId) continue;
    note(sub.lastActivityAt);
    // Events are grouped by turn, so the final array entry need not be the newest.
    for (const event of streams[sub.id] ?? []) {
      if (event.subAgentId === sub.id) note(event.timestamp);
    }
  }
  for (const command of commands) {
    if (command.status !== 'executing') continue;
    if (sessionId !== null && command.subAgentId !== sessionId) continue;
    note(command.startedAt ?? command.timestamp);
  }
  return last > 0 ? last : null;
}
