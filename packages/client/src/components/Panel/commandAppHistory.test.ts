import { describe, expect, it } from 'vitest';
import type { BashEntry } from '@vibisual/shared';
import { MAX_COMMAND_APP_HISTORY, MAX_FILE_EDITS } from '@vibisual/shared';
import { commandHistoryRows } from './commandAppHistory.js';

const entry = (id: string, timestamp: number, appNodeIds?: string[]): BashEntry => ({
  id, timestamp, command: 'UnrealEditor.exe Demo.uproject', appNodeIds,
});

describe('command app history projection', () => {
  it('uses exact app node membership across owners, never a matching app name in another project', () => {
    const first = entry('same-tool-id', 1, ['app-project-a']);
    const second = entry('same-tool-id', 2, ['app-project-a']);
    const otherProject = entry('another', 3, ['app-project-b']);
    const rows = commandHistoryRows({ 'bash-a': [first], 'bash-b': [second, otherProject], legacy: [entry('old', 9)] }, 'app-project-a', true, MAX_COMMAND_APP_HISTORY);
    expect(rows.map((row) => row.entry)).toEqual([second, first]);
    expect(rows[0]!.entry).toBe(second);
    expect(rows[1]!.entry).toBe(first);
    expect(new Set(rows.map((row) => row.key)).size).toBe(2);
  });

  // §5.1 · §7.3 — 파일 버블과 같은 `마지막 20개만 유지` 규칙.
  it('follows the file bubble rule: the checked box keeps the newest MAX_FILE_EDITS references', () => {
    expect(MAX_COMMAND_APP_HISTORY).toBe(MAX_FILE_EDITS);
    const entries = Array.from({ length: 600 }, (_, i) => entry(`${i}`, i, ['app']));
    const before = entries.slice();
    const rows = commandHistoryRows({ owner: entries }, 'app', true, MAX_COMMAND_APP_HISTORY);
    expect(rows).toHaveLength(MAX_COMMAND_APP_HISTORY);
    expect(rows[0]!.entry).toBe(entries[599]);
    expect(rows[MAX_COMMAND_APP_HISTORY - 1]!.entry).toBe(entries[600 - MAX_COMMAND_APP_HISTORY]);
    expect(entries).toEqual(before);
  });

  it('the unchecked box lists every retained record (no screen cap — retention is the server axis)', () => {
    const entries = Array.from({ length: 120 }, (_, i) => entry(`${i}`, i, ['app']));
    const rows = commandHistoryRows({ a: entries.slice(0, 60), b: entries.slice(60) }, 'app', true, null);
    expect(rows).toHaveLength(120);
    expect(rows[0]!.entry).toBe(entries[119]);
    expect(rows[119]!.entry).toBe(entries[0]);
  });

  it('keeps ordinary Bash scoped to its own history and resolves updated entries by the same key', () => {
    const running = entry('run', 2);
    const rows = commandHistoryRows({ owner: [running], other: [entry('run', 3)] }, 'owner', false, MAX_COMMAND_APP_HISTORY);
    const completed: BashEntry = { ...running, status: 'success', output: 'done' };
    const next = commandHistoryRows({ owner: [completed] }, 'owner', false, MAX_COMMAND_APP_HISTORY);
    expect(rows).toHaveLength(1);
    expect(next[0]!.key).toBe(rows[0]!.key);
    expect(next[0]!.entry).toBe(completed);
  });

  it('collapses duplicate source ids from older checkpoints without merging different owners', () => {
    const older = entry('same', 1, ['app']);
    const newer = entry('same', 2, ['app']);
    const rows = commandHistoryRows({ owner: [older, newer, newer], other: [older] }, 'app', true, MAX_COMMAND_APP_HISTORY);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.entry).toBe(newer);
    expect(new Set(rows.map((row) => row.key)).size).toBe(2);
  });
});
