import { languageSpec, type LanguageSpec, type StringRule, type TokenKind } from './codeLanguages.js';
import { tokenizeMarkup, tokenizeMarkdown } from './codeHighlightMarkup.js';

/** §5.5 #17-27 내장 편집창 문법 강조(순수). 하이라이터 패키지 ❌(④) — 언어 사양 표 + 한 번 훑기. 여러 줄 토큰도 줄 경계에서 잘라 줄 단위로 낸다. */

/** 색을 입힐 최소 단위. */
export interface CodeToken {
  text: string;
  kind: TokenKind;
}

/** 한 줄 = 토큰 배열(줄바꿈 문자는 담지 않는다). */
export type CodeLine = CodeToken[];

/** 이 길이를 넘으면 평문으로 — 편집창은 타이핑마다 다시 훑으므로 큰 파일에서 강조가 입력 지연이 된다. */
export const MAX_HIGHLIGHT_CHARS = 400_000;

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;
const PUNCT = /[{}()[\].,;:+\-*/%=<>!&|^~?@#]/;

/** 문자열 리터럴의 끝 위치(닫는 기호 뒤)를 찾는다. 안 닫혔으면 줄 끝(또는 파일 끝). */
function scanString(text: string, start: number, rule: StringRule): number {
  let i = start + rule.open.length;
  while (i < text.length) {
    const ch = text[i]!;
    if (rule.escape && ch === '\\') { i += 2; continue; }
    if (!rule.multiline && ch === '\n') return i;
    if (text.startsWith(rule.close, i)) return i + rule.close.length;
    i += 1;
  }
  return text.length;
}

/** 숫자 리터럴의 끝 위치 — 16진수·소수점·지수·자릿수 구분자(`_`)를 한 덩어리로 본다. */
function scanNumber(text: string, start: number): number {
  let i = start;
  if (text[i] === '0' && /[xXbBoO]/.test(text[i + 1] ?? '')) {
    i += 2;
    while (i < text.length && /[0-9a-fA-F_]/.test(text[i]!)) i += 1;
    return i;
  }
  while (i < text.length && /[0-9_]/.test(text[i]!)) i += 1;
  if (text[i] === '.' && DIGIT.test(text[i + 1] ?? '')) {
    i += 1;
    while (i < text.length && /[0-9_]/.test(text[i]!)) i += 1;
  }
  if (/[eE]/.test(text[i] ?? '') && /[0-9+-]/.test(text[i + 1] ?? '')) {
    i += 2;
    while (i < text.length && DIGIT.test(text[i]!)) i += 1;
  }
  return i;
}

/** 낱말 다음에 오는 **공백 아닌 첫 글자**(함수 호출·키 판정에 쓴다). */
function nextMeaningfulChar(text: string, from: number): string {
  let i = from;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i += 1;
  return text[i] ?? '';
}

/** 식별자 하나의 갈래를 정한다 — 점 뒤면 속성, 표에 있으면 키워드/타입, 괄호 앞이면 함수. */
function wordKind(word: string, prevChar: string, next: string, spec: LanguageSpec): TokenKind {
  if (prevChar === '.') return 'property';
  const lookup = spec.ignoreCase ? word.toLowerCase() : word;
  if (spec.literals.has(word) || spec.literals.has(lookup)) return 'keyword';
  if (spec.keywords.has(lookup)) return 'keyword';
  if (spec.types.has(word)) return 'type';
  if (next === '(') return 'function';
  if (spec.keyBeforeColon && next === ':') return 'property';
  return 'plain';
}

/** 일반 코드 한 벌 훑기 — 주석 → 문자열 → 숫자 → 식별자 → 기호 순으로 가장 먼저 맞는 규칙을 쓴다. */
function tokenizeCode(text: string, spec: LanguageSpec): CodeToken[] {
  const out: CodeToken[] = [];
  let plain = '';
  let i = 0;

  const flush = (): void => {
    if (plain) { out.push({ text: plain, kind: 'plain' }); plain = ''; }
  };
  const emit = (slice: string, kind: TokenKind): void => {
    flush();
    if (slice) out.push({ text: slice, kind });
  };

  while (i < text.length) {
    const lineComment = spec.lineComments.find((c) => text.startsWith(c, i));
    if (lineComment) {
      const nl = text.indexOf('\n', i);
      const end = nl < 0 ? text.length : nl;
      emit(text.slice(i, end), 'comment');
      i = end;
      continue;
    }

    const block = spec.blockComments.find(([open]) => text.startsWith(open, i));
    if (block) {
      const close = text.indexOf(block[1], i + block[0].length);
      const end = close < 0 ? text.length : close + block[1].length;
      emit(text.slice(i, end), 'comment');
      i = end;
      continue;
    }

    const str = spec.strings.find((r) => text.startsWith(r.open, i));
    if (str) {
      const end = scanString(text, i, str);
      emit(text.slice(i, end), 'string');
      i = end;
      continue;
    }

    const ch = text[i]!;

    if (spec.dollarVars && ch === '$' && IDENT_START.test(text[i + 1] ?? '')) {
      let j = i + 1;
      while (j < text.length && IDENT_PART.test(text[j]!)) j += 1;
      emit(text.slice(i, j), 'property');
      i = j;
      continue;
    }

    if (DIGIT.test(ch) && !IDENT_PART.test(text[i - 1] ?? '')) {
      const end = scanNumber(text, i);
      emit(text.slice(i, end), 'number');
      i = end;
      continue;
    }

    if (IDENT_START.test(ch)) {
      let j = i;
      while (j < text.length && IDENT_PART.test(text[j]!)) j += 1;
      const word = text.slice(i, j);
      emit(word, wordKind(word, text[i - 1] ?? '', nextMeaningfulChar(text, j), spec));
      i = j;
      continue;
    }

    if (PUNCT.test(ch)) {
      emit(ch, 'punct');
      i += 1;
      continue;
    }

    plain += ch;
    i += 1;
  }

  flush();
  return out;
}

/** 줄바꿈을 품은 토큰들을 줄 단위로 자른다(블록 주석·템플릿 문자열이 여기서 쪼개진다). */
function splitIntoLines(tokens: CodeToken[]): CodeLine[] {
  const lines: CodeLine[] = [[]];
  for (const token of tokens) {
    const parts = token.text.split('\n');
    parts.forEach((part, idx) => {
      if (idx > 0) lines.push([]);
      if (part) lines[lines.length - 1]!.push({ text: part, kind: token.kind });
    });
  }
  return lines;
}

export function highlightCode(text: string, langId: string): CodeLine[] {
  const spec = languageSpec(langId);
  if (langId === 'plain' || text.length > MAX_HIGHLIGHT_CHARS) {
    return text.split('\n').map((line) => (line ? [{ text: line, kind: 'plain' as const }] : []));
  }
  const tokens = spec.mode === 'markdown'
    ? tokenizeMarkdown(text)
    : spec.mode === 'markup'
      ? tokenizeMarkup(text, spec)
      : tokenizeCode(text, spec);
  return splitIntoLines(tokens);
}
