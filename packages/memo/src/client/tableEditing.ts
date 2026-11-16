import { lineEnd, lineStart, type TextEdit } from './textEditing.js';

export type TableAlign = 'left' | 'center' | 'right' | null;
/** 칸은 원문 글자 그대로다('\|' 이스케이프 포함). */
export interface TableModel { head: string[]; align: TableAlign[]; rows: string[][] }
/** row 0 은 머리 행, 1 이상은 rows[row - 1]. 구분 줄 위의 커서는 머리 행으로 친다. */
export interface TableAt extends TableModel { start: number; end: number; indent: string; row: number; col: number }
export type TableOp = 'addRow' | 'addCol' | 'deleteRow' | 'deleteCol' | 'left' | 'center' | 'right';

const DELIM = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

function isRow(line: string): boolean { return line.includes('|') && !line.trimStart().startsWith('>'); }

function splitCells(line: string): string[] {
  const text = line.trim();
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && text[i + 1] === '|') { cell += '\\|'; i++; }
    else if (ch === '|') { cells.push(cell); cell = ''; }
    else cell += ch;
  }
  cells.push(cell);
  if (text.startsWith('|')) cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return cells.map(value => value.trim());
}

function alignOf(cell: string): TableAlign {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
}

function columnAt(line: string, offset: number): number {
  let pipes = 0;
  for (let i = 0; i < offset && i < line.length; i++) {
    if (line[i] === '\\') i++;
    else if (line[i] === '|') pipes++;
  }
  return line.trimStart().startsWith('|') ? pipes - 1 : pipes;
}

function pad<T>(cells: readonly T[], size: number, fill: T): T[] {
  return Array.from({ length: size }, (_, i) => cells[i] ?? fill);
}

export function findTable(value: string, at: number): TableAt | null {
  const cur = lineStart(value, at);
  if (!isRow(value.slice(cur, lineEnd(value, cur)))) return null;
  let top = cur;
  while (top > 0) {
    const ps = lineStart(value, top - 1);
    if (!isRow(value.slice(ps, top - 1))) break;
    top = ps;
  }
  let bottom = lineEnd(value, cur);
  while (bottom < value.length) {
    const ne = lineEnd(value, bottom + 1);
    if (!isRow(value.slice(bottom + 1, ne))) break;
    bottom = ne;
  }
  const lines = value.slice(top, bottom).split('\n');
  const delim = lines.findIndex((line, i) => i > 0 && DELIM.test(line));
  if (delim < 1) return null;
  const headLine = lines[delim - 1] ?? '';
  let start = top;
  for (let i = 0; i < delim - 1; i++) start += (lines[i]?.length ?? 0) + 1;
  if (cur < start) return null;
  const current = value.slice(start, cur).split('\n').length - 1;
  const head = splitCells(headLine);
  const marks = splitCells(lines[delim] ?? '');
  const rows = lines.slice(delim + 1).map(splitCells);
  const cols = Math.max(1, head.length, marks.length, ...rows.map(row => row.length));
  const col = columnAt(value.slice(cur, lineEnd(value, cur)), at - cur);
  return {
    start, end: bottom, indent: /^\s*/.exec(headLine)?.[0] ?? '',
    head: pad(head, cols, ''), align: pad(marks.map(alignOf), cols, null), rows: rows.map(row => pad(row, cols, '')),
    row: current < 2 ? 0 : current - 1, col: Math.min(cols - 1, Math.max(0, col)),
  };
}

const DELIM_CELL: Record<'left' | 'center' | 'right' | 'none', string> = { left: ':---', center: ':---:', right: '---:', none: '---' };
function rowText(indent: string, cells: readonly string[]): string { return `${indent}|${cells.map(cell => ` ${cell} `).join('|')}|`; }

/** 표를 글자로 쓰고, (row, col) 칸 내용 끝의 자리(표 시작 기준)를 함께 준다. */
export function renderTable(table: TableModel, indent = '', row = 0, col = 0): { text: string; caret: number } {
  const lines = [rowText(indent, table.head), rowText(indent, table.align.map(align => DELIM_CELL[align ?? 'none'])), ...table.rows.map(cells => rowText(indent, cells))];
  const index = row === 0 ? 0 : row + 1;
  const cells = row === 0 ? table.head : table.rows[row - 1] ?? [];
  let caret = indent.length + 2;
  for (let i = 0; i < index; i++) caret += (lines[i]?.length ?? 0) + 1;
  for (let i = 0; i < col; i++) caret += (cells[i]?.length ?? 0) + 3;
  return { text: lines.join('\n'), caret: caret + (cells[col]?.length ?? 0) };
}

function replace(value: string, table: TableAt, row: number, col: number): TextEdit {
  const { text, caret } = renderTable(table, table.indent, row, col);
  return { value: value.slice(0, table.start) + text + value.slice(table.end), start: table.start + caret, end: table.start + caret };
}

function blank(table: TableModel): string[] { return table.head.map(() => ''); }

/** Tab·Shift+Tab: 옆 칸으로. 마지막 칸에서는 새 행을 만든다. */
export function tableMove(value: string, at: number, back: boolean): TextEdit | null {
  const table = findTable(value, at);
  if (!table) return null;
  const last = table.head.length - 1;
  let { row, col } = table;
  if (back) {
    if (col > 0) col--;
    else if (row > 0) { row--; col = last; }
  } else if (col < last) col++;
  else {
    row++; col = 0;
    if (row > table.rows.length) table.rows.push(blank(table));
  }
  return replace(value, table, row, col);
}

/** Enter: 아래에 행을 더한다. 빈 마지막 행에서는 그 행을 지우고 표 아래로 나간다. */
export function tableEnter(value: string, at: number): TextEdit | null {
  const table = findTable(value, at);
  if (!table) return null;
  if (table.row > 0 && table.row === table.rows.length && (table.rows[table.row - 1] ?? []).every(cell => !cell)) {
    table.rows.pop();
    const { text } = renderTable(table, table.indent);
    const caret = table.start + text.length + 2;
    return { value: `${value.slice(0, table.start)}${text}\n\n${value.slice(table.end)}`, start: caret, end: caret };
  }
  table.rows.splice(table.row, 0, blank(table));
  return replace(value, table, table.row + 1, 0);
}

export function tableEdit(value: string, at: number, op: TableOp): TextEdit | null {
  const table = findTable(value, at);
  if (!table) return null;
  const { row, col } = table;
  if (op === 'addRow') { table.rows.splice(row, 0, blank(table)); return replace(value, table, row + 1, col); }
  if (op === 'addCol') {
    table.head.splice(col + 1, 0, ''); table.align.splice(col + 1, 0, null);
    for (const cells of table.rows) cells.splice(col + 1, 0, '');
    return replace(value, table, row, col + 1);
  }
  if (op === 'deleteRow') {
    if (row === 0) return null;
    table.rows.splice(row - 1, 1);
    return replace(value, table, Math.min(row, table.rows.length), col);
  }
  if (op === 'deleteCol') {
    if (table.head.length === 1) {
      const end = value[table.end] === '\n' ? table.end + 1 : table.end;
      return { value: value.slice(0, table.start) + value.slice(end), start: table.start, end: table.start };
    }
    table.head.splice(col, 1); table.align.splice(col, 1);
    for (const cells of table.rows) cells.splice(col, 1);
    return replace(value, table, row, Math.min(col, table.head.length - 1));
  }
  table.align[col] = table.align[col] === op ? null : op;
  return replace(value, table, row, col);
}

/** 격자 편집이 돌려준 표로 커서 자리의 표를 바꿔 쓴다. */
export function writeTable(value: string, at: number, model: TableModel): TextEdit | null {
  const table = findTable(value, at);
  if (!table) return null;
  const next: TableAt = { ...table, ...model };
  return replace(value, next, Math.min(table.row, model.rows.length), Math.min(table.col, model.head.length - 1));
}

/** rows 는 머리 행을 포함한 줄 수다. */
export function newTable(rows: number, cols: number): { text: string; caret: number } {
  const head = Array.from({ length: Math.max(1, cols) }, () => '');
  return renderTable({ head, align: head.map(() => null), rows: Array.from({ length: Math.max(0, rows - 1) }, () => [...head]) });
}

export function cellText(raw: string): string { return raw.replace(/\\\|/g, '|'); }
export function cellSource(text: string): string { return text.replace(/\r?\n/g, ' ').replace(/\\?\|/g, '\\|').trim(); }

/**
 * 스프레드시트에서 복사한 탭 구분 글자를 표로 바꾼다. 두 줄 이상·열 수 일정일 때만이고,
 * 모든 줄의 첫 칸이 비면 탭으로 들여쓴 코드로 보고 건드리지 않는다.
 */
export function tsvToTable(text: string, maxCols: number): string | null {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  const rows = lines.map(line => line.split('\t').map(cellSource));
  const cols = rows[0]?.length ?? 0;
  if (rows.length < 2 || cols < 2 || cols > maxCols || rows.some(row => row.length !== cols) || rows.every(row => !row[0])) return null;
  const [head = [], ...body] = rows;
  return renderTable({ head, align: head.map(() => null), rows: body }).text;
}
