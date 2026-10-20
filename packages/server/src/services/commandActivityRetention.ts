import { COMMAND_ACTIVITY_LIMITS, MAX_BASH_HISTORY } from '@vibisual/shared';
import type { BashEntry } from '@vibisual/shared';

function clipped(text: string, max: number): string {
  if (text.length <= max) return text;
  // V8 sliced strings can retain the original multi-megabyte output backing store.
  // Materialize only the bounded prefix, preserving UTF-16 code units.
  return Buffer.from(text.slice(0, max), 'utf16le').toString('utf16le');
}

/** Bounds apply to the existing activity slice, including old checkpoints. No second log. */
export function boundedBashEntry(entry: BashEntry): BashEntry {
  const limits = COMMAND_ACTIVITY_LIMITS;
  const command = clipped(entry.command, limits.commandChars);
  const output = entry.output === undefined ? undefined : clipped(entry.output, limits.outputChars);
  return {
    ...entry,
    command,
    ...(output !== undefined ? { output } : {}),
    ...(entry.command.length > command.length ? { commandTruncated: true } : {}),
    ...(entry.output && entry.output.length > (output?.length ?? 0) ? { outputTruncated: true } : {}),
    ...(entry.cwd ? { cwd: clipped(entry.cwd, limits.pathChars) } : {}),
    ...(entry.apps ? { apps: entry.apps.slice(0, limits.targetsPerCommand).map((app) => ({
      id: clipped(app.id, limits.pathChars), name: clipped(app.name, 160), detection: 'command' as const,
      ...(app.executable ? { executable: clipped(app.executable, limits.pathChars) } : {}),
      ...(app.iconSource ? { iconSource: clipped(app.iconSource, limits.pathChars) } : {}),
      ...(app.projectPath ? { projectPath: clipped(app.projectPath, limits.pathChars) } : {}),
    })) } : {}),
    ...(entry.appNodeIds ? { appNodeIds: entry.appNodeIds.slice(0, limits.targetsPerCommand).map((id) => clipped(id, 256)) } : {}),
  };
}

/** Conservative UTF-16 payload estimate; includes metadata, not just terminal output. */
export function bashEntryBytes(entry: BashEntry): number {
  let chars = entry.id.length + entry.command.length + (entry.output?.length ?? 0) + (entry.cwd?.length ?? 0);
  for (const app of entry.apps ?? []) chars += app.id.length + app.name.length + (app.executable?.length ?? 0) + (app.iconSource?.length ?? 0) + (app.projectPath?.length ?? 0);
  for (const id of entry.appNodeIds ?? []) chars += id.length;
  return chars * 2 + 256;
}

/** A restored 'running' marker is history, not evidence of a currently live invocation. */
export function restoredBashEntry(entry: BashEntry): BashEntry {
  return boundedBashEntry(entry.status === 'running' ? { ...entry, status: undefined } : entry);
}

export interface RemovedBashEntry { sessionId: string; entry: BashEntry }

/** Bounded work during live use (at most the retained 500 entries plus the new one).
 * Prefer completed history over running calls, but never exceed the hard memory budget.
 * Callers remove matching index references; untouched session arrays retain identity.
 */
export function trimCommandActivity(history: Map<string, BashEntry[]>): RemovedBashEntry[] {
  const limits = COMMAND_ACTIVITY_LIMITS;
  const removed: RemovedBashEntry[] = [];
  const all: Array<RemovedBashEntry & { bytes: number }> = [];
  let bytes = 0;
  for (const [sessionId, list] of history) {
    if (list.length > MAX_BASH_HISTORY) {
      for (const entry of list.splice(MAX_BASH_HISTORY)) removed.push({ sessionId, entry });
    }
    if (!list.length) { history.delete(sessionId); continue; }
    for (const entry of list) {
      const size = bashEntryBytes(entry);
      bytes += size;
      all.push({ sessionId, entry, bytes: size });
    }
  }
  if (all.length <= limits.historyEntries && bytes <= limits.historyBytes && history.size <= limits.historySessions) return removed;
  // Sort only when an actual limit is exceeded, never for every hook.
  all.sort((a, b) => Number(a.entry.status === 'running') - Number(b.entry.status === 'running')
    || a.entry.timestamp - b.entry.timestamp);
  let count = all.length;
  for (const candidate of all) {
    if (count <= limits.historyEntries && bytes <= limits.historyBytes && history.size <= limits.historySessions) break;
    const list = history.get(candidate.sessionId);
    if (!list) continue;
    const index = list.indexOf(candidate.entry);
    if (index < 0) continue;
    list.splice(index, 1);
    if (!list.length) history.delete(candidate.sessionId);
    removed.push(candidate);
    count--;
    bytes -= candidate.bytes;
  }
  return removed;
}
