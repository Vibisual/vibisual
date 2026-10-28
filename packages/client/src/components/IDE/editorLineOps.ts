import { applyDedent, INDENT_UNIT, type EditResult } from './editorModel.js';

/**
 * §5.5 #17-27 ⑲ 편집창 줄 편집 명령의 순수 계산. 키(`shared/keymap.ts` editor 묶음)와 동작은 VS Code 를 따른다.
 * 모든 편집은 (본문, 선택 시작, 끝) → `EditResult`(새 본문 + 새 선택), 할 일이 없으면 `null` — 캐럿 위치까지 시험으로 고정한다.
 */

/** 주석 기호 — 줄 주석(`//`)과 블록 주석(`/*`·`*\/`). 언어에 없으면 `null`. */
export interface CommentTokens {
  line: string | null;
  block: readonly [string, string] | null;
}

/** `offset` 이 있는 줄의 머리. */
export function lineStartAt(text: string, offset: number): number {
  return text.lastIndexOf('\n', offset - 1) + 1;
}

/** `offset` 이 있는 줄의 끝(줄바꿈 앞). */
export function lineEndAt(text: string, offset: number): number {
  const nl = text.indexOf('\n', offset);
  return nl < 0 ? text.length : nl;
}

/** `offset` 이 있는 줄 번호(1-based). */
export function lineNumberAt(text: string, offset: number): number {
  let line = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) line += 1;
  return line;
}

/** 덮는 줄 [from, to) — `to` 는 마지막 줄 끝(줄바꿈 앞). 여러 줄 선택의 끝이 다음 줄 첫 칸이면 그 줄은 넣지 않는다(VS Code 와 같다). */
export function selectedLineBlock(text: string, start: number, end: number): { from: number; to: number } {
  const last = end > start && end === lineStartAt(text, end) ? end - 1 : end;
  const from = lineStartAt(text, start);
  return { from, to: lineEndAt(text, Math.max(from, last)) };
}

/** 묶음 안의 줄들 — 각 줄의 머리 위치와 글자. */
function linesIn(text: string, from: number, to: number): Array<{ at: number; text: string }> {
  const out: Array<{ at: number; text: string }> = [];
  let at = from;
  for (const line of text.slice(from, to).split('\n')) {
    out.push({ at, text: line });
    at += line.length + 1;
  }
  return out;
}

/** 줄 앞 공백(스페이스·탭)의 글자 수. */
function indentWidth(line: string): number {
  return /^[ \t]*/.exec(line)![0].length;
}

/** 한 자리를 고치는 편집 하나(`at` 에서 `remove` 글자를 지우고 `insert` 를 넣는다). */
interface Splice {
  at: number;
  remove: number;
  insert: string;
}

/** 편집을 지난 위치(지운 구간 안이면 그 시작). `stayBeforeInsert` — 그 자리에 넣은 글자 앞에 남는다(줄 머리 선택이 넣은 기호까지 덮어야 다시 눌러 되돌린다). */
function mapThrough(offset: number, splices: readonly Splice[], stayBeforeInsert: boolean): number {
  let delta = 0;
  for (const s of splices) {
    if (s.at > offset) break;
    if (s.at === offset && s.remove === 0 && stayBeforeInsert) break;
    if (s.at + s.remove <= offset) {
      delta += s.insert.length - s.remove;
      continue;
    }
    return s.at + delta;
  }
  return offset + delta;
}

/** 겹치지 않는 편집들(위치 오름차순)을 한 번에 적용하고 선택을 함께 옮긴다. */
function applySplices(text: string, splices: readonly Splice[], start: number, end: number): EditResult | null {
  if (splices.length === 0) return null;
  let out = '';
  let cursor = 0;
  for (const s of splices) {
    out += text.slice(cursor, s.at) + s.insert;
    cursor = s.at + s.remove;
  }
  out += text.slice(cursor);
  const ranged = end > start;
  return {
    text: out,
    selectionStart: mapThrough(start, splices, ranged),
    selectionEnd: mapThrough(end, splices, false),
  };
}

// ─── 줄 복사·이동·삭제 ───────────────────────────────────────────────────────

/** 줄 묶음을 한 벌 더 — 아래로 복사는 선택이 새 벌로 내려가고, 위로 복사는 제자리(위 벌)에 남는다. */
export function copyLines(text: string, start: number, end: number, dir: 'up' | 'down'): EditResult {
  const { from, to } = selectedLineBlock(text, start, end);
  const block = text.slice(from, to);
  const next = `${text.slice(0, to)}\n${block}${text.slice(to)}`;
  const shift = dir === 'down' ? block.length + 1 : 0;
  return { text: next, selectionStart: start + shift, selectionEnd: end + shift };
}

/** 줄 묶음을 위·아래 줄과 맞바꾼다. 맨 위·맨 아래에서는 할 일이 없다(`null`). */
export function moveLines(text: string, start: number, end: number, dir: 'up' | 'down'): EditResult | null {
  const { from, to } = selectedLineBlock(text, start, end);
  const block = text.slice(from, to);
  if (dir === 'up') {
    if (from === 0) return null;
    const prevStart = lineStartAt(text, from - 1);
    const prevLine = text.slice(prevStart, from - 1);
    const next = `${text.slice(0, prevStart)}${block}\n${prevLine}${text.slice(to)}`;
    const shift = -(prevLine.length + 1);
    return { text: next, selectionStart: start + shift, selectionEnd: end + shift };
  }
  if (to >= text.length) return null;
  const nextEnd = lineEndAt(text, to + 1);
  const nextLine = text.slice(to + 1, nextEnd);
  const next = `${text.slice(0, from)}${nextLine}\n${block}${text.slice(nextEnd)}`;
  const shift = nextLine.length + 1;
  return { text: next, selectionStart: start + shift, selectionEnd: end + shift };
}

/** 줄 묶음을 지운다 — 캐럿은 그 자리에 올라온 줄의 같은 칸(줄이 짧으면 끝)으로 간다. */
export function deleteLines(text: string, start: number, end: number): EditResult | null {
  if (text.length === 0) return null;
  const { from, to } = selectedLineBlock(text, start, end);
  const column = start - lineStartAt(text, start);
  let a = from;
  let b = to;
  if (b < text.length) b += 1; // 뒤 줄바꿈까지
  else if (a > 0) a -= 1;      // 마지막 줄이면 앞 줄바꿈을 지운다
  const next = text.slice(0, a) + text.slice(b);
  const lineStart = a === from ? from : lineStartAt(next, a);
  const caret = Math.min(lineStart + column, lineEndAt(next, lineStart));
  return { text: next, selectionStart: caret, selectionEnd: caret };
}

/** 아래(또는 위)에 빈 줄을 넣고 캐럿을 그 줄로 — 들여쓰기는 지금 줄을 잇는다. */
export function insertLine(text: string, start: number, end: number, where: 'below' | 'above'): EditResult {
  if (where === 'below') {
    const ls = lineStartAt(text, end);
    const le = lineEndAt(text, end);
    const indent = text.slice(ls, ls + indentWidth(text.slice(ls, le)));
    const caret = le + 1 + indent.length;
    return { text: `${text.slice(0, le)}\n${indent}${text.slice(le)}`, selectionStart: caret, selectionEnd: caret };
  }
  const ls = lineStartAt(text, start);
  const indent = text.slice(ls, ls + indentWidth(text.slice(ls, lineEndAt(text, start))));
  const caret = ls + indent.length;
  return { text: `${text.slice(0, ls)}${indent}\n${text.slice(ls)}`, selectionStart: caret, selectionEnd: caret };
}

/** 줄 고르기(Ctrl+L) — 줄바꿈까지 통째로, 이미 줄 단위면 한 줄 더. 본문은 바꾸지 않는다. */
export function selectLines(text: string, start: number, end: number): EditResult {
  const { from, to } = selectedLineBlock(text, start, end);
  const wholeLines = start === from && end > start && end === to + 1;
  const stop = wholeLines ? lineEndAt(text, end) + 1 : to + 1;
  return { text, selectionStart: from, selectionEnd: Math.min(text.length, stop) };
}

// ─── 들여쓰기 ─────────────────────────────────────────────────────────────────

/** 줄 머리에 민다(Ctrl+] — `Tab` 과 달리 캐럿 자리가 아니다). 여러 줄이면 빈 줄은 건드리지 않는다(VS Code 와 같다). */
export function indentLines(text: string, start: number, end: number, unit: string = INDENT_UNIT): EditResult | null {
  const { from, to } = selectedLineBlock(text, start, end);
  const lines = linesIn(text, from, to);
  const multi = lines.length > 1;
  const splices = lines
    .filter((l) => !multi || l.text.length > 0)
    .map((l) => ({ at: l.at, remove: 0, insert: unit }));
  return applySplices(text, splices, start, end);
}

/** 줄 묶음을 한 단계 당긴다(Ctrl+[) — `Shift+Tab` 과 같은 계산이다. 뺄 것이 없으면 `null`. */
export function outdentLines(text: string, start: number, end: number, unit: string = INDENT_UNIT): EditResult | null {
  const out = applyDedent(text, start, end, unit);
  return out.text === text ? null : out;
}

/** 파일의 들여쓰기 한 단계(탭/스페이스 몇 칸)를 앞 `scanLines` 줄에서 알아본다(없으면 `fallback`). 탭 파일에 스페이스를 넣으면 모양이 깨진다(언리얼 소스). */
export function detectIndentUnit(text: string, fallback: string = INDENT_UNIT, scanLines = 5000): string {
  let tabs = 0;
  let spaced = 0;
  let prevSpaces = 0;
  const steps = new Map<number, number>();
  let at = 0;
  for (let n = 0; n < scanLines && at <= text.length; n += 1) {
    const nl = text.indexOf('\n', at);
    const end = nl < 0 ? text.length : nl;
    const line = text.slice(at, end);
    if (line.trim().length > 0) {
      if (line[0] === '\t') {
        tabs += 1;
      } else {
        const spaces = /^ */.exec(line)![0].length;
        if (spaces > 0) spaced += 1;
        const step = Math.abs(spaces - prevSpaces);
        // 블록 주석의 ` * ` 처럼 한 칸짜리 차이는 들여쓰기 단위가 아니다.
        if (step >= 2 && step <= 8) steps.set(step, (steps.get(step) ?? 0) + 1);
        prevSpaces = spaces;
      }
    }
    if (nl < 0) break;
    at = nl + 1;
  }
  if (tabs > spaced) return '\t';
  if (spaced === 0) return fallback;
  let best = 0;
  let bestCount = 0;
  for (const [step, count] of steps) {
    if (count > bestCount || (count === bestCount && step < best)) {
      best = step;
      bestCount = count;
    }
  }
  return best > 0 ? ' '.repeat(best) : fallback;
}

/** Enter — 지금 줄 들여쓰기를 잇고, 여는 괄호(`{`·`[`·`(`) 뒤면 한 단계 더. 캐럿 뒤가 짝 닫는 괄호면 그것을 다음 줄로 내린다(VS Code 와 같다). */
export function newlineWithIndent(text: string, start: number, end: number, unit: string = INDENT_UNIT): EditResult {
  const ls = lineStartAt(text, start);
  const before = text.slice(ls, start);
  const indent = /^[ \t]*/.exec(before)![0];
  const opener = before.trimEnd().slice(-1);
  const closer = opener === '{' ? '}' : opener === '[' ? ']' : opener === '(' ? ')' : '';
  const after = text.slice(end, lineEndAt(text, end));
  if (closer) {
    const lead = after.length - after.trimStart().length;
    if (after.trimStart().startsWith(closer)) {
      const insert = `\n${indent}${unit}\n${indent}`;
      const caret = start + 1 + indent.length + unit.length;
      return { text: text.slice(0, start) + insert + text.slice(end + lead), selectionStart: caret, selectionEnd: caret };
    }
    const insert = `\n${indent}${unit}`;
    const caret = start + insert.length;
    return { text: text.slice(0, start) + insert + text.slice(end), selectionStart: caret, selectionEnd: caret };
  }
  const insert = `\n${indent}`;
  const caret = start + insert.length;
  return { text: text.slice(0, start) + insert + text.slice(end), selectionStart: caret, selectionEnd: caret };
}

// ─── 주석 ─────────────────────────────────────────────────────────────────────

/** 줄 주석(Ctrl+/) — 글 있는 줄이 전부 주석이면 걷고 아니면 단다. 가장 얕은 들여쓰기 자리에 맞춰 넣고 빈 줄은 건너뛴다. 줄 주석이 없는 언어는 블록 기호로 줄마다 감싼다. */
export function toggleLineComment(text: string, start: number, end: number, tokens: CommentTokens): EditResult | null {
  const { from, to } = selectedLineBlock(text, start, end);
  const lines = linesIn(text, from, to);
  const content = lines.filter((l) => l.text.trim().length > 0);
  const targets = content.length > 0 ? content : lines;

  if (tokens.line) {
    const token = tokens.line;
    const commented = content.length > 0
      && content.every((l) => l.text.slice(indentWidth(l.text)).startsWith(token));
    if (commented) {
      const splices = content.map((l) => {
        const at = l.at + indentWidth(l.text);
        const rest = text.slice(at + token.length, l.at + l.text.length);
        return { at, remove: token.length + (rest.startsWith(' ') ? 1 : 0), insert: '' };
      });
      return applySplices(text, splices, start, end);
    }
    const minIndent = Math.min(...targets.map((l) => indentWidth(l.text)));
    const splices = targets.map((l) => ({ at: l.at + minIndent, remove: 0, insert: `${token} ` }));
    return applySplices(text, splices, start, end);
  }

  if (tokens.block) {
    const [open, close] = tokens.block;
    const wrapped = content.length > 0 && content.every((l) => {
      const body = l.text.trim();
      return body.length >= open.length + close.length && body.startsWith(open) && body.endsWith(close);
    });
    const splices: Splice[] = [];
    for (const l of wrapped ? content : targets) {
      const lead = indentWidth(l.text);
      const trailing = l.text.length - l.text.trimEnd().length;
      const bodyEnd = l.at + l.text.length - trailing;
      if (wrapped) {
        const afterOpen = text.slice(l.at + lead + open.length, bodyEnd);
        const openRemove = open.length + (afterOpen.startsWith(' ') ? 1 : 0);
        const beforeClose = text.slice(l.at + lead, bodyEnd - close.length);
        const closeRemove = close.length + (beforeClose.endsWith(' ') && beforeClose.length > openRemove ? 1 : 0);
        splices.push({ at: l.at + lead, remove: openRemove, insert: '' });
        splices.push({ at: bodyEnd - closeRemove, remove: closeRemove, insert: '' });
      } else {
        splices.push({ at: l.at + lead, remove: 0, insert: `${open} ` });
        splices.push({ at: bodyEnd, remove: 0, insert: ` ${close}` });
      }
    }
    return applySplices(text, splices, start, end);
  }

  return null;
}

/** 앞 `n` 글자(모자라면 빈 문자열 — 음수 `slice` 가 뒤에서 세는 사고를 막는다). */
function textBefore(text: string, at: number, n: number): string {
  return at >= n ? text.slice(at - n, at) : '';
}

/**
 * 블록 주석 켜고 끄기(Shift+Alt+A) — 고른 글자를 `/* … *\/` 로 감싸고, 이미 감싸여 있으면(고른 글자 자체가
 * 그렇거나 바로 바깥에 기호가 있으면) 벗긴다. 고른 것이 없으면 기호 한 쌍을 넣고 캐럿을 그 가운데 둔다.
 * 블록 주석이 없는 언어면 `null`.
 */
export function toggleBlockComment(text: string, start: number, end: number, tokens: CommentTokens): EditResult | null {
  if (!tokens.block) return null;
  const [open, close] = tokens.block;
  if (start === end) {
    const caret = start + open.length + 1;
    return { text: `${text.slice(0, start)}${open}  ${close}${text.slice(end)}`, selectionStart: caret, selectionEnd: caret };
  }

  const picked = text.slice(start, end);
  const lead = picked.length - picked.trimStart().length;
  const trail = picked.length - picked.trimEnd().length;
  const inner = picked.slice(lead, picked.length - trail);
  if (inner.length >= open.length + close.length && inner.startsWith(open) && inner.endsWith(close)) {
    let body = inner.slice(open.length, inner.length - close.length);
    if (body.startsWith(' ')) body = body.slice(1);
    if (body.endsWith(' ')) body = body.slice(0, -1);
    const replaced = picked.slice(0, lead) + body + picked.slice(picked.length - trail);
    return { text: text.slice(0, start) + replaced + text.slice(end), selectionStart: start, selectionEnd: start + replaced.length };
  }

  const openLen = textBefore(text, start, open.length + 1) === `${open} ` ? open.length + 1
    : textBefore(text, start, open.length) === open ? open.length : 0;
  const closeLen = text.slice(end, end + close.length + 1) === ` ${close}` ? close.length + 1
    : text.slice(end, end + close.length) === close ? close.length : 0;
  if (openLen > 0 && closeLen > 0) {
    const at = start - openLen;
    return {
      text: text.slice(0, at) + picked + text.slice(end + closeLen),
      selectionStart: at,
      selectionEnd: at + picked.length,
    };
  }

  const shift = open.length + 1;
  return {
    text: `${text.slice(0, start)}${open} ${picked} ${close}${text.slice(end)}`,
    selectionStart: start + shift,
    selectionEnd: end + shift,
  };
}

// ─── 줄 번호로 가기 ───────────────────────────────────────────────────────────

/** 줄 번호 입력: `12` · `12:5` · `12,5` · `-1`(끝에서 첫째) — VS Code 와 같다. 숫자가 아니면 `null`, 줄·열은 파일 안으로 당긴다. */
export function parseGotoLine(input: string, lineCount: number): { line: number; column: number } | null {
  const m = /^\s*(-?\d+)\s*(?:[:,]\s*(\d+))?\s*$/.exec(input);
  if (!m || lineCount < 1) return null;
  let line = Number(m[1]);
  if (!Number.isSafeInteger(line) || line === 0) return null;
  if (line < 0) line = lineCount + 1 + line;
  line = Math.max(1, Math.min(lineCount, line));
  const column = m[2] ? Math.max(1, Number(m[2])) : 1;
  return { line, column: Number.isSafeInteger(column) ? column : 1 };
}

/** 줄·열(1-based) → 본문 위치. 열이 줄보다 길면 줄 끝. */
export function offsetOfLineColumn(text: string, line: number, column: number): number {
  let at = 0;
  for (let n = 1; n < line; n += 1) {
    const nl = text.indexOf('\n', at);
    if (nl < 0) return text.length;
    at = nl + 1;
  }
  return Math.min(at + Math.max(0, column - 1), lineEndAt(text, at));
}

// ─── 되돌리기가 이어지는 한 번의 바꿔 끼우기 ─────────────────────────────────

/** 차이를 한 군데 바꿔 끼우기로 줄인다 — 편집창이 `insertText` 한 번으로 넣어야 되돌리기 기록에 한 걸음으로 남는다(통째 교체면 `Ctrl+Z` 가 잃는다, ⑨ (d)). 대리쌍 한가운데에서 자르지 않는다. */
export function diffEdit(prev: string, next: string): { from: number; to: number; insert: string } {
  const max = Math.min(prev.length, next.length);
  let p = 0;
  while (p < max && prev.charCodeAt(p) === next.charCodeAt(p)) p += 1;
  if (p > 0 && isHigh(prev.charCodeAt(p - 1))) p -= 1;
  let s = 0;
  const maxSuffix = Math.min(prev.length, next.length) - p;
  while (s < maxSuffix && prev.charCodeAt(prev.length - 1 - s) === next.charCodeAt(next.length - 1 - s)) s += 1;
  if (s > 0 && isLow(prev.charCodeAt(prev.length - s))) s -= 1;
  return { from: p, to: prev.length - s, insert: next.slice(p, next.length - s) };
}

function isHigh(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLow(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
