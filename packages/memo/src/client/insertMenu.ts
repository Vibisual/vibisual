import { MEMO } from '../config.js';
import { clipboardHtmlToMarkdown } from '../clipboardMarkdown.js';
import { findTable, newTable, tsvToTable } from './tableEditing.js';
import { insertBlock, isUrl, lineStart, linkSelection, taskMarks, toggleLinePrefix, type TextEdit } from './textEditing.js';

export const INSERT_IDS = ['todo', 'bullet', 'number', 'table', 'h1', 'h2', 'h3', 'quote', 'code', 'divider', 'link', 'date', 'time'] as const;
export type InsertId = typeof INSERT_IDS[number];

/** 번역된 이름 말고도 어느 언어 자판에서나 칠 수 있는 영문 낱말로 찾게 한다. */
const ALIASES: Record<InsertId, readonly string[]> = {
  todo: ['todo', 'check', 'task'], bullet: ['bullet', 'list', 'ul'], number: ['number', 'ol', '1'], table: ['table', 'grid'],
  h1: ['h1', 'heading1', 'title'], h2: ['h2', 'heading2'], h3: ['h3', 'heading3'], quote: ['quote'], code: ['code'],
  divider: ['divider', 'hr', 'line'], link: ['link', 'url'], date: ['date', 'today'], time: ['time', 'now'],
};
const PREFIX: Partial<Record<InsertId, string>> = { todo: '- [ ] ', bullet: '- ', number: '1. ', h1: '# ', h2: '## ', h3: '### ', quote: '> ' };
const CODE_BLOCK = '```\n\n```';
const SLASH = /(^|\s)\/([^\s/]*)$/;

/** 커서 바로 앞이 줄 처음이나 빈칸 뒤의 '/낱말' 이면 그 자리와 낱말을 준다. */
export function slashQuery(value: string, start: number, end: number): { from: number; query: string } | null {
  if (start !== end) return null;
  const ls = lineStart(value, start);
  const from = Math.max(ls, start - MEMO.slashQueryMax - 2);
  const m = SLASH.exec(value.slice(from, start));
  if (!m || (m[2]?.length ?? 0) > MEMO.slashQueryMax) return null;
  // 잘라 낸 창의 맨 앞은 줄 처음이 아닐 수 있다.
  if (m.index === 0 && !m[1] && from > ls) return null;
  return { from: start - (m[2]?.length ?? 0) - 1, query: m[2] ?? '' };
}

export function filterInserts(query: string, label: (id: InsertId) => string): InsertId[] {
  const q = query.toLowerCase();
  if (!q) return [...INSERT_IDS];
  return INSERT_IDS.filter(id => label(id).toLowerCase().includes(q) || ALIASES[id].some(alias => alias.startsWith(q)));
}

export interface InsertStamp { date: string; time: string }
export function insertStamp(now: Date, locale?: string): InsertStamp {
  return { date: now.toLocaleDateString(locale, { dateStyle: 'full' }), time: now.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) };
}

export function runInsert(id: InsertId, value: string, start: number, end: number, stamp: InsertStamp): TextEdit {
  const prefix = PREFIX[id];
  if (prefix) return toggleLinePrefix(value, start, end, prefix, true);
  if (id === 'table') { const table = newTable(MEMO.tableDefaultRows, MEMO.tableDefaultCols); return insertBlock(value, start, end, table.text, [table.caret, table.caret]); }
  if (id === 'code') return insertBlock(value, start, end, CODE_BLOCK, [4, 4]);
  if (id === 'divider') return insertBlock(value, start, end, '---');
  if (id === 'link') return linkSelection(value, start, end);
  const text = id === 'date' ? stamp.date : stamp.time;
  return { value: value.slice(0, start) + text + value.slice(end), start: start + text.length, end: start + text.length };
}

/** '/낱말' 을 지우고 그 자리에 고른 항목을 넣는다. */
export function runSlash(id: InsertId, value: string, from: number, caret: number, stamp: InsertStamp): TextEdit {
  return runInsert(id, value.slice(0, from) + value.slice(caret), from, from, stamp);
}

export function insertTable(value: string, start: number, end: number, rows: number, cols: number): TextEdit {
  const table = newTable(rows, cols);
  return insertBlock(value, start, end, table.text, [table.caret, table.caret]);
}

function hasMarkdownTable(text: string): boolean {
  let offset = 0; let fence = '';
  for (const line of text.split('\n')) {
    const mark = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (mark) { if (!fence) fence = mark; else if (mark[0] === fence[0] && mark.length >= fence.length) fence = ''; }
    else if (!fence && line.includes('|') && findTable(text, offset)) return true;
    offset += line.length + 1;
  }
  return false;
}

/** 원문 표를 우선 보존하고, HTML 표와 탭 구분 글자는 기존 본문 형식으로 바꾼다. */
export function pasteEdit(value: string, start: number, end: number, text: string, html = '', markdown = ''): TextEdit | null {
  const selected = value.slice(start, end);
  const url = text.trim();
  if (selected.trim() && !selected.includes('\n') && isUrl(url) && !isUrl(selected.trim())) return linkSelection(value, start, end, url);
  const current = findTable(value, start);
  if (current && (start > current.start || end < current.end)) return null;
  const rich = hasMarkdownTable(markdown) ? markdown : hasMarkdownTable(text) ? text : clipboardHtmlToMarkdown(html);
  if (rich) return insertBlock(value, start, end, rich.trim());
  if (!text.includes('\t')) return null;
  const table = tsvToTable(text, MEMO.tableMaxCols);
  return table ? insertBlock(value, start, end, table) : null;
}

export type MirrorPart = { kind: 'text'; text: string } | { kind: 'task'; at: number; checked: boolean } | { kind: 'anchor' };
/**
 * 본문을 겹침 층에 그릴 조각으로 나눈다: 체크박스 표식('[ ]' 세 글자)과 anchor 자리의 폭 없는 닻.
 * 조각의 글자를 이으면 본문과 같아야 한다 — 층이 입력 칸과 같은 자리에 줄바꿈돼야 표식이 글자 위에 선다.
 */
export function mirrorParts(body: string, anchor: number | null, tasks: boolean): MirrorPart[] {
  const parts: MirrorPart[] = [];
  let at = 0;
  let pending = anchor;
  const text = (to: number): void => {
    if (pending !== null && pending <= to) {
      if (pending > at) { parts.push({ kind: 'text', text: body.slice(at, pending) }); at = pending; }
      parts.push({ kind: 'anchor' });
      pending = null;
    }
    if (to > at) parts.push({ kind: 'text', text: body.slice(at, to) });
    at = to;
  };
  for (const mark of tasks ? taskMarks(body) : []) {
    text(mark.at - 1);
    parts.push({ kind: 'task', at: mark.at, checked: mark.checked });
    at = mark.at + 2;
  }
  text(body.length);
  return parts;
}
