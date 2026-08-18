import type { LanguageSpec, TokenKind } from './codeLanguages.js';
import type { CodeToken } from './codeHighlight.js';

/**
 * codeHighlightMarkup.ts — §5.5 #17-27 v4.87 태그 언어(html/xml)와 마크다운 전용 훑기.
 *
 * 둘 다 "코드"의 규칙(키워드·괄호)이 아니라 **줄과 꺾쇠의 규칙**으로 색이 갈리므로,
 * 일반 코드 토크나이저(`codeHighlight.ts`)와 한 함수에 뒤섞지 않고 여기서 따로 훑는다.
 * 반환 형태는 같은 `CodeToken[]`(줄바꿈을 품은 채)이라 나머지 처리는 공용이다.
 */

const IDENT_PART = /[A-Za-z0-9_:.\-$]/;

function push(out: CodeToken[], text: string, kind: TokenKind): void {
  if (text) out.push({ text, kind });
}

/** `<tag attr="v">텍스트</tag>` — 태그 이름·속성·값·주석만 색을 나눈다. */
export function tokenizeMarkup(text: string, spec: LanguageSpec): CodeToken[] {
  const out: CodeToken[] = [];
  const [commentOpen, commentClose] = spec.blockComments[0] ?? ['<!--', '-->'];
  let i = 0;
  let plain = '';

  const flush = (): void => { push(out, plain, 'plain'); plain = ''; };

  while (i < text.length) {
    if (text.startsWith(commentOpen, i)) {
      flush();
      const close = text.indexOf(commentClose, i + commentOpen.length);
      const end = close < 0 ? text.length : close + commentClose.length;
      push(out, text.slice(i, end), 'comment');
      i = end;
      continue;
    }

    if (text[i] === '<') {
      flush();
      const gt = text.indexOf('>', i);
      const end = gt < 0 ? text.length : gt + 1;
      pushTag(out, text.slice(i, end));
      i = end;
      continue;
    }

    plain += text[i];
    i += 1;
  }

  flush();
  return out;
}

/** `<...>` 한 덩어리를 태그 이름 / 속성 이름 / 값으로 쪼갠다. */
function pushTag(out: CodeToken[], tag: string): void {
  let i = 0;
  // 여는 꺾쇠 + 슬래시·물음표·느낌표
  let head = '<';
  i = 1;
  while (i < tag.length && (tag[i] === '/' || tag[i] === '?' || tag[i] === '!')) { head += tag[i]; i += 1; }
  push(out, head, 'punct');

  // 태그 이름
  let name = '';
  while (i < tag.length && IDENT_PART.test(tag[i]!)) { name += tag[i]; i += 1; }
  push(out, name, 'keyword');

  while (i < tag.length) {
    const ch = tag[i]!;
    if (ch === '"' || ch === "'") {
      const close = tag.indexOf(ch, i + 1);
      const end = close < 0 ? tag.length : close + 1;
      push(out, tag.slice(i, end), 'string');
      i = end;
      continue;
    }
    if (ch === '=' || ch === '>' || ch === '/' || ch === '?') {
      push(out, ch, 'punct');
      i += 1;
      continue;
    }
    if (IDENT_PART.test(ch)) {
      let attr = '';
      while (i < tag.length && IDENT_PART.test(tag[i]!)) { attr += tag[i]; i += 1; }
      push(out, attr, 'property');
      continue;
    }
    push(out, ch, 'plain');
    i += 1;
  }
}

/** 마크다운 — 제목·코드펜스·인라인 코드·목록/인용 표식만 나눈다(굵게·기울임은 건드리지 않는다). */
export function tokenizeMarkdown(text: string): CodeToken[] {
  const out: CodeToken[] = [];
  const lines = text.split('\n');
  let inFence = false;

  lines.forEach((line, idx) => {
    const withNl = idx < lines.length - 1;
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      inFence = !inFence;
      push(out, line, 'keyword');
    } else if (inFence) {
      push(out, line, 'plain');
    } else if (/^\s{0,3}#{1,6}\s/.test(line)) {
      push(out, line, 'keyword');
    } else {
      pushMarkdownLine(out, line);
    }
    if (withNl) push(out, '\n', 'plain');
  });

  return out;
}

/** 한 줄 안 — 앞머리 표식(목록·인용)과 인라인 코드만 따로 칠한다. */
function pushMarkdownLine(out: CodeToken[], line: string): void {
  const marker = /^(\s*(?:[-*+]|\d+\.|>)\s)/.exec(line);
  let rest = line;
  if (marker) {
    push(out, marker[1]!, 'punct');
    rest = line.slice(marker[1]!.length);
  }

  let buf = '';
  let i = 0;
  while (i < rest.length) {
    if (rest[i] === '`') {
      const close = rest.indexOf('`', i + 1);
      if (close > 0) {
        push(out, buf, 'plain');
        buf = '';
        push(out, rest.slice(i, close + 1), 'string');
        i = close + 1;
        continue;
      }
    }
    buf += rest[i];
    i += 1;
  }
  push(out, buf, 'plain');
}
