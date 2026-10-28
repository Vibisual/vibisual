import type { CodeToken } from './codeHighlight.js';
import type { TokenKind } from './codeLanguages.js';

/**
 * §5.5 #17-27 ⑲ 편집창 찾기·바꾸기의 순수 계산. VS Code 찾기 위젯을 따른다:
 * - 정규식은 `u` 깃발, 깨지면 결과 0 + "잘못된 정규식". 단어 단위는 `\b` 가 아니다 — ASCII 만 낱말로 봐 한글을 못 찾는다(앞뒤가 유니코드 낱말 글자인지로).
 * - 결과는 `FIND_MATCH_LIMIT` 까지만 센다. "모두 바꾸기"는 상한 없이 다시 센다.
 * - 바꾸기 틀: `$1`·`$&`·`$<이름>`·`$$`·`$0`, `\n`·`\t`·`\\`, `\u`·`\l`·`\U`·`\L`.
 */

/** 찾기 스위치 셋. */
export interface FindOptions {
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export const DEFAULT_FIND_OPTIONS: FindOptions = { matchCase: false, wholeWord: false, regex: false };

/** 맞은 자리 하나 — UTF-16 위치 [start, end). 정규식(`^`·`$`)이면 길이 0 일 수 있다. */
export interface FindMatch {
  start: number;
  end: number;
}

export interface FindResult {
  /** 시작 위치 오름차순(서로 겹치지 않는다). */
  matches: FindMatch[];
  /** 상한에서 멈췄다 — 수를 "N+" 로 적는다. */
  capped: boolean;
  /** 정규식을 지을 수 없었다. */
  invalid: boolean;
}

/** 이 이상은 세지 않는다(VS Code 와 같은 상한). */
export const FIND_MATCH_LIMIT = 19_999;

/** 고른 글자를 찾을 말로 옮겨 담는 길이 상한 — 더 길면 찾을 말로 쓰지 않는다. */
export const FIND_SEED_MAX_CHARS = 1000;

const EMPTY_RESULT: FindResult = { matches: [], capped: false, invalid: false };

/** 정규식 특수 문자를 글자 그대로 찾게 바꾼다(`u` 깃발에서도 허용되는 이스케이프만 쓴다). */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** 찾을 말 + 스위치 → 전역 정규식. 비었거나 지을 수 없으면 `null`. */
export function buildFindRegExp(query: string, options: FindOptions): RegExp | null {
  if (!query) return null;
  const source = options.regex ? query : escapeRegExp(query);
  // m — `^`·`$` 가 줄마다 맞는다(편집기의 정규식은 줄 단위로 읽는다). u — 대리쌍을 한 글자로 본다.
  const flags = `gmu${options.matchCase ? '' : 'i'}`;
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

/** 같은 식을 그 자리에서만 맞춰 보는 사본(바꾸기가 묶음 `$1` 을 읽으려고 다시 맞출 때). */
function stickyClone(re: RegExp): RegExp {
  return new RegExp(re.source, `${re.flags.replace('g', '')}y`);
}

const WORD_CHAR = /[\p{L}\p{N}\p{M}_]/u;

function isWordChar(ch: string): boolean {
  return ch !== '' && WORD_CHAR.test(ch);
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** `i` 자리에서 시작하는 한 글자(대리쌍이면 둘). 범위 밖이면 빈 문자열. */
function charAtOffset(text: string, i: number): string {
  if (i < 0 || i >= text.length) return '';
  const cp = text.codePointAt(i);
  return cp === undefined ? '' : String.fromCodePoint(cp);
}

/** `i` 바로 앞의 한 글자(대리쌍이면 둘). */
function charBeforeOffset(text: string, i: number): string {
  if (i <= 0 || i > text.length) return '';
  if (i >= 2 && isLowSurrogate(text.charCodeAt(i - 1)) && isHighSurrogate(text.charCodeAt(i - 2))) {
    return text.slice(i - 2, i);
  }
  return text[i - 1] ?? '';
}

/** 양 끝이 낱말 안에서 잘리지 않았는가. 끝 글자가 낱말 글자가 아니면(`.foo`) 그쪽 경계는 따지지 않는다(VS Code 와 같다). */
export function isWholeWordMatch(text: string, start: number, end: number): boolean {
  if (end <= start) return false;
  const leftOk = !isWordChar(charBeforeOffset(text, start)) || !isWordChar(charAtOffset(text, start));
  const rightOk = !isWordChar(charAtOffset(text, end)) || !isWordChar(charBeforeOffset(text, end));
  return leftOk && rightOk;
}

/** 길이 0 결과 다음에 찾기 시작할 자리 — 대리쌍 한가운데로 들어가지 않는다. */
function advance(text: string, at: number): number {
  return at + (isHighSurrogate(text.charCodeAt(at)) && at + 1 < text.length ? 2 : 1);
}

/** 본문에서 찾을 말이 맞는 자리 전부(상한까지). */
export function findMatches(
  text: string,
  query: string,
  options: FindOptions,
  limit: number = FIND_MATCH_LIMIT,
): FindResult {
  if (!query) return EMPTY_RESULT;
  const re = buildFindRegExp(query, options);
  if (!re) return { matches: [], capped: false, invalid: true };
  const matches: FindMatch[] = [];
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const start = m.index;
    const end = start + m[0].length;
    // 길이 0 결과는 스스로 앞으로 가지 않는다 — 한 글자 밀지 않으면 같은 자리를 영원히 다시 맞춘다.
    if (end === start) re.lastIndex = advance(text, start);
    if (options.wholeWord && !isWholeWordMatch(text, start, end)) continue;
    if (matches.length >= limit) return { matches, capped: true, invalid: false };
    matches.push({ start, end });
  }
  return { matches, capped: false, invalid: false };
}

// ─── 다음·이전 ────────────────────────────────────────────────────────────────

/** `offset` 이상에서 시작하는 첫 결과의 번호(없으면 결과 수). */
function lowerBound(matches: readonly FindMatch[], offset: number): number {
  let lo = 0;
  let hi = matches.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (matches[mid]!.start < offset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 고른 범위가 결과 하나와 꼭 같으면 그 번호, 아니면 -1. */
export function indexOfExactMatch(matches: readonly FindMatch[], start: number, end: number): number {
  const i = lowerBound(matches, start);
  const m = matches[i];
  return m && m.start === start && m.end === end ? i : -1;
}

/** `offset` 에서(포함) 뒤로 처음 시작하는 결과 — 없으면 처음으로 돈다. 결과가 없으면 -1. */
export function matchIndexFrom(matches: readonly FindMatch[], offset: number): number {
  if (matches.length === 0) return -1;
  const i = lowerBound(matches, offset);
  return i < matches.length ? i : 0;
}

/** 다음 결과 — 고른 것이 결과 그대로면 그 다음, 아니면 커서 뒤 처음(끝에서는 처음으로 돈다). */
export function nextMatchIndex(matches: readonly FindMatch[], selStart: number, selEnd: number): number {
  if (matches.length === 0) return -1;
  const exact = indexOfExactMatch(matches, selStart, selEnd);
  if (exact >= 0) return (exact + 1) % matches.length;
  return matchIndexFrom(matches, selEnd);
}

/** 이전 결과 — 고른 것이 결과 그대로면 그 앞, 아니면 커서 앞 마지막(처음에서는 끝으로 돈다). */
export function prevMatchIndex(matches: readonly FindMatch[], selStart: number, selEnd: number): number {
  if (matches.length === 0) return -1;
  const exact = indexOfExactMatch(matches, selStart, selEnd);
  if (exact >= 0) return (exact - 1 + matches.length) % matches.length;
  const before = lowerBound(matches, selStart) - 1;
  return before >= 0 ? before : matches.length - 1;
}

/** 지금 고른 것을 기준으로 "지금 결과" — 고른 것이 결과면 그것, 아니면 커서 뒤 처음. */
export function currentMatchIndex(matches: readonly FindMatch[], selStart: number, selEnd: number): number {
  const exact = indexOfExactMatch(matches, selStart, selEnd);
  return exact >= 0 ? exact : matchIndexFrom(matches, selStart);
}

// ─── 찾을 말 채우기 ───────────────────────────────────────────────────────────

/** 막대를 열 때의 찾을 말 — 한 줄 선택이면 그것, 없으면 커서 자리 낱말. 여러 줄·너무 길면 `null`(지난 말 유지, VS Code 와 같다). */
export function seedFindQuery(text: string, start: number, end: number): string | null {
  if (end > start) {
    const picked = text.slice(start, end);
    if (picked.includes('\n') || picked.length > FIND_SEED_MAX_CHARS) return null;
    return picked;
  }
  let from = start;
  while (from > 0 && isWordChar(charBeforeOffset(text, from))) from -= charBeforeOffset(text, from).length;
  let to = start;
  while (to < text.length && isWordChar(charAtOffset(text, to))) to += charAtOffset(text, to).length;
  return to > from ? text.slice(from, to) : null;
}

// ─── 바꾸기 ───────────────────────────────────────────────────────────────────

type CaseOp = 'u' | 'l' | 'U' | 'L';

function applyCase(value: string, op: CaseOp | null): string {
  switch (op) {
    case 'u': return value.charAt(0).toUpperCase() + value.slice(1);
    case 'l': return value.charAt(0).toLowerCase() + value.slice(1);
    case 'U': return value.toUpperCase();
    case 'L': return value.toLowerCase();
    default: return value;
  }
}

/** 대소문자 바꾸기(`\U$1`)는 바로 뒤 묶음 하나에만 걸린다(VS Code 와 같다). */
export function expandReplaceTemplate(template: string, m: RegExpExecArray, text: string): string {
  let out = '';
  let pending: CaseOp | null = null;
  const take = (value: string): void => {
    out += applyCase(value, pending);
    pending = null;
  };
  for (let i = 0; i < template.length; i += 1) {
    const ch = template[i]!;
    const next = template[i + 1];
    if (ch === '\\' && next !== undefined) {
      if (next === 'n') { out += '\n'; i += 1; continue; }
      if (next === 't') { out += '\t'; i += 1; continue; }
      if (next === '\\') { out += '\\'; i += 1; continue; }
      if (next === 'u' || next === 'l' || next === 'U' || next === 'L') { pending = next; i += 1; continue; }
      out += ch;
      continue;
    }
    if (ch === '$' && next !== undefined) {
      if (next === '$') { out += '$'; i += 1; continue; }
      if (next === '&') { take(m[0]); i += 1; continue; }
      if (next === '`') { take(text.slice(0, m.index)); i += 1; continue; }
      if (next === "'") { take(text.slice(m.index + m[0].length)); i += 1; continue; }
      if (next === '<' && m.groups) {
        const close = template.indexOf('>', i + 2);
        const name = close > 0 ? template.slice(i + 2, close) : '';
        if (name && Object.prototype.hasOwnProperty.call(m.groups, name)) {
          take(m.groups[name] ?? '');
          i = close;
          continue;
        }
      }
      if (/[0-9]/.test(next)) {
        // 두 자리 묶음이 실제로 있으면 두 자리(`$10`), 아니면 한 자리 — JS 의 `replace` 와 같은 규칙.
        const two = template.slice(i + 1, i + 3);
        if (/^[0-9]{2}$/.test(two) && Number(two) >= 1 && Number(two) < m.length) {
          take(m[Number(two)] ?? '');
          i += 2;
          continue;
        }
        const one = Number(next);
        // `$0` 은 맞은 글자 전체다(VS Code 와 같다 — JS 에서는 글자 그대로지만 편집기 사용자의 손은 이쪽이다).
        if (one === 0) { take(m[0]); i += 1; continue; }
        if (one < m.length) { take(m[one] ?? ''); i += 1; continue; }
      }
    }
    out += ch;
  }
  return out;
}

/** 그 사이 본문이 바뀌어 그 자리가 더는 맞지 않으면 `null` — 바꾸지 않는다. */
export function makeReplacer(
  text: string,
  query: string,
  replacement: string,
  options: FindOptions,
): (match: FindMatch) => string | null {
  if (!options.regex) return () => replacement;
  const re = buildFindRegExp(query, options);
  if (!re) return () => null;
  const sticky = stickyClone(re);
  return (match) => {
    sticky.lastIndex = match.start;
    const m = sticky.exec(text);
    if (!m || m.index !== match.start || m[0].length !== match.end - match.start) return null;
    return expandReplaceTemplate(replacement, m, text);
  };
}

/** `keep`(커서)은 바뀐 길이만큼 밀리고, 바뀐 자리 안이면 그 시작으로 간다. `null` 결과는 그대로 둔다. */
export function replaceAllMatches(
  text: string,
  matches: readonly FindMatch[],
  replacer: (match: FindMatch) => string | null,
  keep: number,
): { text: string; keep: number; count: number } {
  let out = '';
  let cursor = 0;
  let delta = 0;
  let mapped: number | null = null;
  let count = 0;
  for (const m of matches) {
    const rep = replacer(m);
    if (rep === null) continue;
    if (mapped === null && keep < m.end && keep >= m.start && m.end > m.start) mapped = m.start + delta;
    if (mapped === null && keep < m.start) mapped = keep + delta;
    out += text.slice(cursor, m.start) + rep;
    delta += rep.length - (m.end - m.start);
    cursor = m.end;
    count += 1;
  }
  out += text.slice(cursor);
  return { text: out, keep: mapped ?? keep + delta, count };
}

// ─── 그리기 — 결과를 줄마다 나눠 칠한다 ───────────────────────────────────────

/** 한 줄 안의 칠할 자리 — 줄 안 위치(UTF-16)와 "지금 결과"인가. */
export interface LineMark {
  start: number;
  end: number;
  current: boolean;
}

/** 줄마다의 머리 위치(0번 줄 = 0). 편집창이 그리는 줄과 같은 갈림이다(`\n`). */
export function lineStartOffsets(text: string): number[] {
  const out = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) out.push(i + 1);
  return out;
}

/** `offset` 이 있는 줄 번호(0-based). */
export function lineIndexAt(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 결과를 줄마다 칠할 자리로. 여러 줄 결과(정규식 `\n`)는 줄마다 자르고, 그릴 글자가 없으면(줄바꿈만) 길이 0 표식을 둔다. */
export function marksByLine(
  starts: readonly number[],
  textLength: number,
  matches: readonly FindMatch[],
  current: number,
): Map<number, LineMark[]> {
  const out = new Map<number, LineMark[]>();
  const push = (line: number, mark: LineMark): void => {
    const list = out.get(line);
    if (list) list.push(mark);
    else out.set(line, [mark]);
  };
  matches.forEach((m, idx) => {
    const isCurrent = idx === current;
    const firstLine = lineIndexAt(starts, m.start);
    let pushed = false;
    for (let line = firstLine, from = m.start; from < m.end && line < starts.length; line += 1) {
      const lineStart = starts[line]!;
      const lineEnd = line + 1 < starts.length ? starts[line + 1]! - 1 : textLength;
      const to = Math.min(m.end, lineEnd);
      if (to > from) {
        push(line, { start: from - lineStart, end: to - lineStart, current: isCurrent });
        pushed = true;
      }
      from = line + 1 < starts.length ? starts[line + 1]! : textLength;
    }
    if (!pushed) {
      const col = m.start - starts[firstLine]!;
      push(firstLine, { start: col, end: col, current: isCurrent });
    }
  });
  return out;
}

/** 칠한 조각 — 글자가 있는 조각과, 길이 0 결과를 그리는 표식. */
export type LinePiece =
  | { text: string; kind: TokenKind; mark: 'none' | 'match' | 'current' }
  | { caret: 'match' | 'current' };

/** 토큰을 칠할 경계에서 다시 자르되 글자는 더하거나 빼지 않는다 — `<pre>` 층과 `textarea` 층이 한 글자라도 어긋나면 커서가 엉뚱한 글자 위에 선다. */
export function splitTokensByMarks(tokens: readonly CodeToken[], marks: readonly LineMark[]): LinePiece[] {
  if (marks.length === 0) return tokens.map((t) => ({ text: t.text, kind: t.kind, mark: 'none' as const }));
  const ranged = marks.filter((m) => m.end > m.start).sort((a, b) => a.start - b.start);
  const carets = marks.filter((m) => m.end === m.start).sort((a, b) => a.start - b.start);
  const out: LinePiece[] = [];
  let ci = 0;
  const flushCarets = (upTo: number): void => {
    while (ci < carets.length && carets[ci]!.start <= upTo) {
      out.push({ caret: carets[ci]!.current ? 'current' : 'match' });
      ci += 1;
    }
  };
  let ri = 0;
  let col = 0;
  for (const token of tokens) {
    const ts = col;
    const te = col + token.text.length;
    let pos = ts;
    while (pos < te) {
      flushCarets(pos);
      while (ri < ranged.length && ranged[ri]!.end <= pos) ri += 1;
      const r = ranged[ri];
      let next: number;
      let mark: 'none' | 'match' | 'current';
      if (r && r.start <= pos) {
        next = Math.min(te, r.end);
        mark = r.current ? 'current' : 'match';
      } else {
        next = Math.min(te, r ? r.start : te);
        mark = 'none';
      }
      const caret = carets[ci];
      if (caret && caret.start > pos && caret.start < next) next = caret.start;
      out.push({ text: token.text.slice(pos - ts, next - ts), kind: token.kind, mark });
      pos = next;
    }
    col = te;
  }
  flushCarets(Number.POSITIVE_INFINITY);
  return out;
}

/** 두 줄의 칠할 자리가 같은가(같으면 그 줄을 다시 그리지 않는다). */
export function sameLineMarks(a: readonly LineMark[] | undefined, b: readonly LineMark[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((m, i) => m.start === b[i]!.start && m.end === b[i]!.end && m.current === b[i]!.current);
}
