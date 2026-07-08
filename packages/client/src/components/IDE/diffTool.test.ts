import { describe, it, expect } from 'vitest';
import { parseEditToolInput, computeLineDiff, summarizeEdit } from './diffTool.js';

describe('parseEditToolInput', () => {
  it('parses Edit into one hunk', () => {
    const input = JSON.stringify({ file_path: '/a/b.ts', old_string: 'foo', new_string: 'bar' });
    const parsed = parseEditToolInput('Edit', input);
    expect(parsed).toEqual({ toolName: 'Edit', filePath: '/a/b.ts', mode: 'edit', hunks: [{ oldText: 'foo', newText: 'bar' }] });
  });

  it('parses Write as create (old empty)', () => {
    const input = JSON.stringify({ file_path: 'c.md', content: 'hello\nworld' });
    const parsed = parseEditToolInput('Write', input);
    expect(parsed?.mode).toBe('create');
    expect(parsed?.hunks).toEqual([{ oldText: '', newText: 'hello\nworld' }]);
  });

  it('parses MultiEdit into multiple hunks, skipping malformed', () => {
    const input = JSON.stringify({
      file_path: 'x.ts',
      edits: [{ old_string: 'a', new_string: 'b' }, { bogus: true }, { old_string: 'c', new_string: 'd' }],
    });
    const parsed = parseEditToolInput('MultiEdit', input);
    expect(parsed?.hunks).toHaveLength(2);
  });

  it('parses NotebookEdit with new_source', () => {
    const input = JSON.stringify({ notebook_path: 'n.ipynb', new_source: 'print(1)' });
    const parsed = parseEditToolInput('NotebookEdit', input);
    expect(parsed?.mode).toBe('edit');
    expect(parsed?.hunks[0]?.newText).toBe('print(1)');
  });

  it('returns null for non-edit tools', () => {
    expect(parseEditToolInput('Bash', JSON.stringify({ command: 'ls' }))).toBeNull();
  });

  it('returns null for incomplete/invalid JSON (streaming)', () => {
    expect(parseEditToolInput('Edit', '{"file_path":"a","old_str')).toBeNull();
    expect(parseEditToolInput('Edit', JSON.stringify({ file_path: 'a' }))).toBeNull();
  });
});

describe('computeLineDiff', () => {
  it('marks a replaced line and numbers both sides', () => {
    const rows = computeLineDiff('one\ntwo\nthree', 'one\nTWO\nthree');
    expect(rows.map((r) => r.type)).toEqual(['equal', 'replace', 'equal']);
    const replace = rows[1]!;
    expect(replace.left).toEqual({ no: 2, text: 'two' });
    expect(replace.right).toEqual({ no: 2, text: 'TWO' });
  });

  it('pure add on create (old empty) → all insert with null left', () => {
    const rows = computeLineDiff('', 'a\nb');
    expect(rows.map((r) => r.type)).toEqual(['insert', 'insert']);
    expect(rows.every((r) => r.left === null && r.right !== null)).toBe(true);
    expect(rows[1]!.right).toEqual({ no: 2, text: 'b' });
  });

  it('pure delete → all delete with null right', () => {
    const rows = computeLineDiff('a\nb', '');
    expect(rows.map((r) => r.type)).toEqual(['delete', 'delete']);
    expect(rows.every((r) => r.right === null)).toBe(true);
  });

  it('highlights only the changed word tokens on a replace row', () => {
    const rows = computeLineDiff('const a = 1;', 'const a = 2;');
    const replace = rows.find((r) => r.type === 'replace')!;
    const changedLeft = (replace.leftSpans ?? []).filter((s) => s.changed).map((s) => s.text);
    const changedRight = (replace.rightSpans ?? []).filter((s) => s.changed).map((s) => s.text);
    expect(changedLeft).toContain('1;');
    expect(changedRight).toContain('2;');
    // unchanged prefix stays unchanged on both sides
    expect((replace.leftSpans ?? []).some((s) => s.text === 'const' && !s.changed)).toBe(true);
  });

  it('ignores a single trailing newline (no phantom empty row)', () => {
    const rows = computeLineDiff('a\nb\n', 'a\nb\n');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.type === 'equal')).toBe(true);
  });
});

describe('summarizeEdit', () => {
  it('counts added/removed lines across hunks', () => {
    const parsed = parseEditToolInput('MultiEdit', JSON.stringify({
      file_path: 'x',
      edits: [{ old_string: 'a\nb', new_string: 'a\nB' }, { old_string: 'gone', new_string: '' }],
    }))!;
    const { added, removed } = summarizeEdit(parsed);
    expect(removed).toBeGreaterThanOrEqual(added);
    expect(added).toBe(1);   // 'b'→'B'
    expect(removed).toBe(2); // 'b'→'B' + 'gone'→(deleted)
  });
});
