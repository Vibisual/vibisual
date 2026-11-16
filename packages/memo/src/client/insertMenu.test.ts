import { describe, expect, it } from 'vitest';
import { filterInserts, INSERT_IDS, insertTable, mirrorParts, pasteEdit, runInsert, runSlash, slashQuery, type InsertId, type MirrorPart } from './insertMenu.js';

const stamp = { date: 'DATE', time: 'TIME' };
const label = (id: InsertId): string => ({ table: '표', todo: '체크박스' } as Partial<Record<InsertId, string>>)[id] ?? id;
const joined = (body: string, parts: MirrorPart[]): string => parts.map(part => part.kind === 'text' ? part.text : part.kind === 'task' ? body.slice(part.at - 1, part.at + 2) : '').join('');

describe('slashQuery', () => {
  it('opens at a line start or after whitespace', () => {
    expect(slashQuery('/', 1, 1)).toEqual({ from: 0, query: '' });
    expect(slashQuery('note\n/ta', 8, 8)).toEqual({ from: 5, query: 'ta' });
    expect(slashQuery('do /표', 5, 5)).toEqual({ from: 3, query: '표' });
  });
  it('stays closed inside words, paths, dates and selections', () => {
    expect(slashQuery('and/or', 6, 6)).toBeNull();
    expect(slashQuery('11/11', 5, 5)).toBeNull();
    expect(slashQuery(' /a/b', 5, 5)).toBeNull();
    expect(slashQuery('/a b', 4, 4)).toBeNull();
    expect(slashQuery('/ab', 1, 3)).toBeNull();
  });
  it('does not mistake the cut of a long line for a line start', () => {
    const line = `${'x'.repeat(40)}/abc`;
    expect(slashQuery(line, line.length, line.length)).toBeNull();
    expect(slashQuery(`/${'y'.repeat(30)}`, 31, 31)).toBeNull();
  });
});

describe('filterInserts', () => {
  it('lists everything for an empty query', () => { expect(filterInserts('', label)).toEqual([...INSERT_IDS]); });
  it('matches translated names and English aliases', () => {
    expect(filterInserts('표', label)).toEqual(['table']);
    expect(filterInserts('TODO', label)).toEqual(['todo']);
    expect(filterInserts('grid', label)).toEqual(['table']);
    expect(filterInserts('zzz', label)).toEqual([]);
  });
});

describe('runInsert', () => {
  it('sets a line prefix without toggling it off', () => {
    expect(runInsert('todo', 'buy milk', 3, 3, stamp).value).toBe('- [ ] buy milk');
    expect(runInsert('todo', '- [ ] buy milk', 8, 8, stamp).value).toBe('- [ ] buy milk');
    expect(runInsert('quote', 'said', 0, 0, stamp).value).toBe('> said');
    expect(runInsert('h2', '- item', 0, 0, stamp).value).toBe('## item');
  });
  it('puts blocks on their own lines with blank lines around', () => {
    expect(runInsert('divider', 'a', 1, 1, stamp)).toEqual({ value: 'a\n\n---\n', start: 7, end: 7 });
    expect(runInsert('divider', 'a\n\nb', 1, 1, stamp).value).toBe('a\n\n---\n\nb');
    const code = runInsert('code', '', 0, 0, stamp);
    expect(code.value).toBe('```\n\n```\n'); expect(code.start).toBe(4);
    const table = runInsert('table', 'a\n', 2, 2, stamp);
    expect(table.value).toBe('a\n\n|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n'); expect(table.start).toBe(5);
  });
  it('inserts stamps and links at the caret', () => {
    expect(runInsert('date', 'on ', 3, 3, stamp)).toEqual({ value: 'on DATE', start: 7, end: 7 });
    expect(runInsert('link', 'see docs', 4, 8, stamp)).toEqual({ value: 'see [docs]()', start: 11, end: 11 });
    expect(runInsert('link', 'https://a.dev', 0, 13, stamp)).toEqual({ value: '[](https://a.dev)', start: 1, end: 1 });
  });
  it('replaces the slash word with the chosen item', () => {
    expect(runSlash('todo', 'milk /to', 5, 8, stamp).value).toBe('- [ ] milk ');
    expect(runSlash('time', 'at /now', 3, 7, stamp).value).toBe('at TIME');
  });
  it('inserts a table of the picked size', () => {
    expect(insertTable('', 0, 0, 2, 3).value).toBe('|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n');
  });
});

describe('pasteEdit', () => {
  it('turns an address pasted over selected words into a link', () => {
    expect(pasteEdit('read this', 5, 9, ' https://a.dev ')).toEqual({ value: 'read [this](https://a.dev)', start: 26, end: 26 });
  });
  it('keeps the default paste for plain text, bare carets and address-over-address', () => {
    expect(pasteEdit('read this', 5, 9, 'hello')).toBeNull();
    expect(pasteEdit('read this', 9, 9, 'https://a.dev')).toBeNull();
    expect(pasteEdit('https://old.dev', 0, 15, 'https://a.dev')).toBeNull();
  });
  it('turns spreadsheet cells into a table but not inside an existing table', () => {
    expect(pasteEdit('list', 4, 4, 'a\tb\n1\t2')?.value).toBe('list\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n');
    expect(pasteEdit('| a |\n| --- |\n| 1 |', 3, 3, 'a\tb\n1\t2')).toBeNull();
  });
  it('separates Markdown tables from surrounding paragraphs and preserves their source', () => {
    const table = '| **name** | state |\n| :--- | ---: |\n| a \\| b | `done` |';
    expect(pasteEdit('beforeafter', 6, 6, table)?.value).toBe(`before\n\n${table}\n\nafter`);
    expect(pasteEdit('', 0, 0, `intro\n\n${table}\n\noutro`)?.value).toBe(`intro\n\n${table}\n\noutro\n`);
    expect(pasteEdit('', 0, 0, 'flattened', '', table)?.value).toBe(`${table}\n`);
  });
  it('does not transform table examples inside code fences or an existing cell', () => {
    const table = '| a | b |\n| --- | --- |\n| 1 | 2 |';
    expect(pasteEdit('', 0, 0, `\`\`\`\n${table}\n\`\`\``)).toBeNull();
    expect(pasteEdit(table, 3, 3, table)).toBeNull();
    expect(pasteEdit(table, 0, table.length, table)?.value).toBe(`${table}\n`);
  });
});

describe('mirrorParts', () => {
  it('marks checkbox brackets and keeps the text identical', () => {
    const body = '- [ ] a\n  1. [x] b\ntext [ ] not a task';
    const parts = mirrorParts(body, null, true);
    expect(parts.filter(part => part.kind === 'task')).toEqual([{ kind: 'task', at: 3, checked: false }, { kind: 'task', at: 14, checked: true }]);
    expect(joined(body, parts)).toBe(body);
  });
  it('places the anchor at the slash and omits tasks when locked', () => {
    const body = '- [ ] a /ta';
    const parts = mirrorParts(body, 8, true);
    expect(parts.map(part => part.kind)).toEqual(['text', 'task', 'text', 'anchor', 'text']);
    expect(joined(body, parts)).toBe(body);
    expect(mirrorParts(body, null, false)).toEqual([{ kind: 'text', text: body }]);
    expect(mirrorParts('', 0, true)).toEqual([{ kind: 'anchor' }]);
  });
});
