import { describe, expect, it } from 'vitest';
import { cellSource, cellText, findTable, newTable, renderTable, tableEdit, tableEnter, tableMove, tsvToTable, writeTable } from './tableEditing.js';

const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |';
const at = (value: string, needle: string): number => value.indexOf(needle) + needle.length;

describe('findTable', () => {
  it('reads the table under the caret with its row and column', () => {
    const found = findTable(`intro\n\n${TABLE}\n\nafter`, at(`intro\n\n${TABLE}`, '| 1 | 2'));
    expect(found).toMatchObject({ head: ['a', 'b'], align: [null, null], rows: [['1', '2']], row: 1, col: 1, start: 7 });
    expect(found?.end).toBe(7 + TABLE.length);
  });
  it('treats the delimiter line as the header row', () => {
    expect(findTable(TABLE, at(TABLE, '| ---'))).toMatchObject({ row: 0, col: 0 });
  });
  it('ignores lines with pipes that have no delimiter row, and prose above a table', () => {
    expect(findTable('a | b\nc | d', 2)).toBeNull();
    expect(findTable(`x | y\n${TABLE}`, 2)).toBeNull();
    expect(findTable('plain', 2)).toBeNull();
  });
  it('pads ragged rows, keeps escaped pipes in one cell and reads alignment', () => {
    const found = findTable('| a | b | c |\n|:--|:-:|--:|\n| x \\| y |', 3);
    expect(found?.rows).toEqual([['x \\| y', '', '']]);
    expect(found?.align).toEqual(['left', 'center', 'right']);
  });
  it('keeps the indentation of a table nested in a list', () => {
    const value = '  | a |\n  | --- |\n  | 1 |';
    const next = tableMove(value, at(value, '| 1'), false);
    expect(next?.value).toBe('  | a |\n  | --- |\n  | 1 |\n  |  |');
  });
});

describe('tableMove', () => {
  it('moves to the next cell and skips the delimiter line', () => {
    const first = tableMove(TABLE, 3, false);
    expect(first?.value).toBe(TABLE); expect(first?.start).toBe(at(TABLE, '| a | b'));
    const down = tableMove(TABLE, first?.start ?? 0, false);
    expect(down?.start).toBe(at(TABLE, '| 1'));
  });
  it('adds a row after the last cell', () => {
    const next = tableMove(TABLE, TABLE.length - 2, false);
    expect(next?.value).toBe(`${TABLE}\n|  |  |`);
    expect(next?.start).toBe(TABLE.length + 3);
  });
  it('moves backwards and stops at the first header cell', () => {
    expect(tableMove(TABLE, at(TABLE, '| 1'), true)?.start).toBe(at(TABLE, '| a | b'));
    expect(tableMove(TABLE, 3, true)?.start).toBe(3);
  });
  it('returns null outside a table', () => { expect(tableMove('- item', 3, false)).toBeNull(); });
});

describe('tableEnter', () => {
  it('adds a row below the current one', () => {
    const next = tableEnter(TABLE, 3);
    expect(next?.value).toBe('| a | b |\n| --- | --- |\n|  |  |\n| 1 | 2 |');
    expect(next?.start).toBe(at('| a | b |\n| --- | --- |\n| ', '| --- | --- |\n| '));
  });
  it('removes an empty last row and leaves the table', () => {
    const value = `${TABLE}\n|  |  |\nafter`;
    const next = tableEnter(value, at(value, '| 2 |\n| '));
    expect(next?.value).toBe(`${TABLE}\n\n\nafter`);
    expect(next?.start).toBe(TABLE.length + 2);
  });
});

describe('tableEdit', () => {
  it('adds and deletes a column at the caret', () => {
    const added = tableEdit(TABLE, 3, 'addCol');
    expect(added?.value).toBe('| a |  | b |\n| --- | --- | --- |\n| 1 |  | 2 |');
    expect(tableEdit(added?.value ?? '', added?.start ?? 0, 'deleteCol')?.value).toBe(TABLE);
  });
  it('deletes a body row but never the header', () => {
    expect(tableEdit(TABLE, at(TABLE, '| 1'), 'deleteRow')?.value).toBe('| a | b |\n| --- | --- |');
    expect(tableEdit(TABLE, 3, 'deleteRow')).toBeNull();
  });
  it('removes the whole table when its only column is deleted', () => {
    expect(tableEdit('x\n\n| a |\n| --- |\ny', 6, 'deleteCol')?.value).toBe('x\n\ny');
  });
  it('toggles the alignment of the caret column', () => {
    const centered = tableEdit(TABLE, at(TABLE, '| a | b'), 'center');
    expect(centered?.value).toBe('| a | b |\n| --- | :---: |\n| 1 | 2 |');
    expect(tableEdit(centered?.value ?? '', centered?.start ?? 0, 'center')?.value).toBe(TABLE);
  });
});

describe('table text', () => {
  it('builds an empty table with the caret in the first header cell', () => {
    expect(newTable(2, 2)).toEqual({ text: '|  |  |\n| --- | --- |\n|  |  |', caret: 2 });
    expect(newTable(1, 1).text).toBe('|  |\n| --- |');
  });
  it('writes a grid result over the table under the caret only', () => {
    const value = `top\n\n${TABLE}\n\nend`;
    const next = writeTable(value, 8, { head: ['x'], align: ['right'], rows: [['1'], ['2']] });
    expect(next?.value).toBe('top\n\n| x |\n| ---: |\n| 1 |\n| 2 |\n\nend');
  });
  it('round-trips pipes through the grid editor', () => {
    expect(cellText('a \\| b')).toBe('a | b');
    expect(cellSource(' a | b\nc ')).toBe('a \\| b c');
    expect(cellSource('a \\| b')).toBe('a \\| b');
  });
  it('places the caret at the end of the requested cell', () => {
    const { text, caret } = renderTable({ head: ['ab', 'c'], align: [null, null], rows: [['1', '22']] }, '', 1, 1);
    expect(text.slice(0, caret)).toBe('| ab | c |\n| --- | --- |\n| 1 | 22');
  });
});

describe('tsvToTable', () => {
  it('converts spreadsheet rows, first row as header', () => {
    expect(tsvToTable('name\tqty\r\npen\t2\r\n', 12)).toBe('| name | qty |\n| --- | --- |\n| pen | 2 |');
  });
  it('leaves single rows, ragged rows, wide sheets and tab-indented code alone', () => {
    expect(tsvToTable('a\tb', 12)).toBeNull();
    expect(tsvToTable('a\tb\nc', 12)).toBeNull();
    expect(tsvToTable('a\tb\tc\n1\t2\t3', 2)).toBeNull();
    expect(tsvToTable('\tif (x) {\n\treturn;', 12)).toBeNull();
  });
});
