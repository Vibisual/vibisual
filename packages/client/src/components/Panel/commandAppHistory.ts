import type { BashEntry } from '@vibisual/shared';

/** References into the existing history, never another persisted command/output copy. */
export interface CommandHistoryRow {
  key: string;
  entry: BashEntry;
}

function compareRows(a: CommandHistoryRow, b: CommandHistoryRow): number {
  return b.entry.timestamp - a.entry.timestamp || a.key.localeCompare(b.key);
}

/**
 * Only called for the selected Bash/app panel. `limit` = the `마지막 20개만 유지` checkbox (`MAX_COMMAND_APP_HISTORY` = `MAX_FILE_EDITS`);
 * `null` = unchecked, list every retained entry (retention is the server's separate axis).
 */
export function commandHistoryRows(
  history: Readonly<Record<string, readonly BashEntry[]>>,
  nodeId: string,
  app: boolean,
  limit: number | null,
): CommandHistoryRow[] {
  const max = limit === null ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(limit));
  const rows: CommandHistoryRow[] = [];
  const collect = (owner: string, entries: readonly BashEntry[]): void => {
    for (const entry of entries) {
      // Node membership includes project/installation identity. App names alone do not.
      if (app && !entry.appNodeIds?.includes(nodeId)) continue;
      const row = { key: JSON.stringify([owner, entry.id]), entry };
      // Old checkpoints can contain duplicated tool ids. Keep the newest record
      // while retaining the source owner as part of its identity.
      const duplicate = rows.findIndex((existing) => existing.key === row.key);
      if (duplicate >= 0) {
        if (compareRows(row, rows[duplicate]!) >= 0) continue;
        rows.splice(duplicate, 1);
      }
      if (rows.length >= max && (rows.length === 0 || compareRows(row, rows[rows.length - 1]!) >= 0)) continue;
      let low = 0;
      let high = rows.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (compareRows(row, rows[mid]!) < 0) high = mid;
        else low = mid + 1;
      }
      rows.splice(low, 0, row);
      if (rows.length > max) rows.pop();
    }
  };
  if (app) {
    for (const owner in history) collect(owner, history[owner]!);
  } else {
    collect(nodeId, history[nodeId] ?? []);
  }
  return rows;
}
