import { withComputeMemory } from '@vibisual/compute';

/** Only numeric plans cross Wasm. Text, UI objects, IDs and translated messages stay here. */
export interface MainSortEntry {
  readonly type: string;
  readonly timestamp: number;
  readonly sortTimestamp?: number;
  readonly sessionLabel?: string;
}

const boundaryRank = (entry: MainSortEntry): number => entry.type === 'command' ? -1 : entry.type === 'turnstop' ? 1 : 0;

export function orderMainEntries<T extends MainSortEntry>(entries: readonly T[]): T[] {
  const count = entries.length;
  if (count < 2) return [...entries];
  // Array.sort's NaN comparator can be non-transitive. Keep its historical V8 behavior
  // for malformed times; valid finite times and queued Infinity remain Rust-owned.
  if (entries.some((entry) => Number.isNaN(entry.sortTimestamp ?? entry.timestamp) || Number.isNaN(entry.timestamp))) {
    return [...entries].sort((a, b) => (a.sortTimestamp ?? a.timestamp) - (b.sortTimestamp ?? b.timestamp)
      || boundaryRank(a) - boundaryRank(b) || a.timestamp - b.timestamp);
  }
  return withComputeMemory(count * 20, count * 4, ({ exports, memory }, input, output) => {
    const sortTimes = new Float64Array(memory.buffer, input, count);
    const timestamps = new Float64Array(memory.buffer, input + count * 8, count);
    const ranks = new Int32Array(memory.buffer, input + count * 16, count);
    for (let i = 0; i < count; i++) {
      const entry = entries[i]!;
      sortTimes[i] = entry.sortTimestamp ?? entry.timestamp;
      timestamps[i] = entry.timestamp;
      ranks[i] = boundaryRank(entry);
    }
    const written = exports.stream_order(input, input + count * 8, input + count * 16, count, output);
    if (written !== count) throw new Error('Rust stream ordering did not produce a complete plan');
    const indices = new Uint32Array(memory.buffer, output, count);
    return Array.from(indices, (index) => entries[index]!);
  });
}

/** Exclusive ends of adjacent text or tool/result runs; labels retain strict equality. */
export function mainEntryRunEnds(entries: readonly MainSortEntry[]): Uint32Array {
  const count = entries.length;
  if (count === 0) return new Uint32Array(0);
  return withComputeMemory(count * 8, count * 4, ({ exports, memory }, input, output) => {
    const types = new Uint32Array(memory.buffer, input, count);
    const sessions = new Uint32Array(memory.buffer, input + count * 4, count);
    const labels = new Map<string | undefined, number>();
    for (let i = 0; i < count; i++) {
      const entry = entries[i]!;
      types[i] = entry.type === 'text' ? 1 : entry.type === 'tool_use' ? 2 : entry.type === 'tool_result' ? 3 : 0;
      let label = labels.get(entry.sessionLabel);
      if (label === undefined) { label = labels.size; labels.set(entry.sessionLabel, label); }
      sessions[i] = label;
    }
    const written = exports.stream_runs(input, input + count * 4, count, output);
    if (written !== count) throw new Error('Rust stream grouping did not produce a complete plan');
    return new Uint32Array(memory.buffer, output, count).slice();
  });
}

/** The event's own turn stamp wins, including stamps absent from the command queue. */
export function mainStreamTurnIds(
  events: readonly { timestamp: number; turnId?: string }[],
  anchors: readonly { ts: number; id: string }[],
): Array<string | null> {
  const count = events.length;
  if (count === 0 || anchors.length === 0) return events.map((event) => event.turnId || null);
  return withComputeMemory((count + anchors.length) * 8, count * 4, ({ exports, memory }, input, output) => {
    const times = new Float64Array(memory.buffer, input, count);
    const anchorTimes = new Float64Array(memory.buffer, input + count * 8, anchors.length);
    for (let i = 0; i < count; i++) times[i] = events[i]!.timestamp;
    for (let i = 0; i < anchors.length; i++) anchorTimes[i] = anchors[i]!.ts;
    const written = exports.stream_turns(input, count, input + count * 8, anchors.length, output);
    if (written !== count) throw new Error('Rust stream turn lookup did not produce a complete plan');
    const indices = new Uint32Array(memory.buffer, output, count);
    return Array.from(indices, (index, i) => events[i]!.turnId || (index === 0xffff_ffff ? null : anchors[index]!.id));
  });
}
