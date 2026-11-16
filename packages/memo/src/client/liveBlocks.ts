/** §5.13 MEMO M13 — 한 화면 편집의 블록 나누기. 블록은 원문 줄 범위이고 블록 사이는 언제나 줄바꿈 한 글자다. */
export type LiveBlockKind = 'blank' | 'paragraph' | 'heading' | 'hr' | 'list' | 'table' | 'quote' | 'code';
export interface LiveBlock { start: number; end: number; kind: LiveBlockKind; level?: number }
/** 편집 중인 원문 칸: 본문의 [start, 길이-tail) 범위. 뒤쪽 길이를 쥐면 칸 안에서 글자가 늘고 줄어도 범위가 맞는다. */
export interface LiveRange { start: number; tail: number; lead: string }

const BLANK = /^\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})(\s|$)/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const LIST = /^\s*(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
const TABLE = /^\s*\|/;
const QUOTE = /^ {0,3}>/;
const INDENTED = /^\s+\S/;

export function splitBlocks(text: string, base = 0): LiveBlock[] {
  const lines: { start: number; end: number; text: string }[] = [];
  let at = 0;
  for (const line of text.split('\n')) { lines.push({ start: at, end: at + line.length, text: line }); at += line.length + 1; }
  const blocks: LiveBlock[] = [];
  const push = (from: number, to: number, kind: LiveBlockKind, level?: number): void => {
    blocks.push({ start: base + lines[from]!.start, end: base + lines[to]!.end, kind, ...(level ? { level } : {}) });
  };
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!.text;
    let j = i;
    const fence = FENCE.exec(line);
    if (BLANK.test(line)) push(i, i, 'blank');
    else if (fence) {
      const mark = fence[1]!;
      // 닫는 울타리가 없으면 끝까지 코드다(쓰는 중인 코드 블록이 아래 줄을 집어삼키는 Markdown 동작 그대로).
      while (j + 1 < lines.length) { j++; if (new RegExp(`^ {0,3}${mark[0] === '`' ? '`' : '~'}{${mark.length},}\\s*$`).test(lines[j]!.text)) break; }
      push(i, j, 'code');
    } else if (HEADING.test(line)) push(i, i, 'heading', HEADING.exec(line)![1]!.length);
    else if (HR.test(line)) push(i, i, 'hr');
    else if (LIST.test(line)) {
      while (j + 1 < lines.length && (LIST.test(lines[j + 1]!.text) || INDENTED.test(lines[j + 1]!.text))) j++;
      push(i, j, 'list');
    } else if (TABLE.test(line)) {
      while (j + 1 < lines.length && TABLE.test(lines[j + 1]!.text)) j++;
      push(i, j, 'table');
    } else if (QUOTE.test(line)) {
      while (j + 1 < lines.length && QUOTE.test(lines[j + 1]!.text)) j++;
      push(i, j, 'quote');
    } else push(i, i, 'paragraph');
    i = j + 1;
  }
  return blocks;
}

/** 자리를 품은 블록. 블록 끝 자리(줄바꿈 바로 앞)는 그 블록에 든다. */
export function blockAt(blocks: readonly LiveBlock[], at: number): LiveBlock | undefined {
  return blocks.find(block => at >= block.start && at <= block.end);
}

/** 편집 범위가 지금 본문에서 여전히 줄 경계에 맞는지 — 밖에서 본문이 바뀌면(되돌리기 등) 범위를 버린다. */
export function rangeFits(body: string, range: LiveRange): boolean {
  const end = body.length - range.tail;
  if (range.start < 0 || range.tail < 0 || range.start > end) return false;
  if (range.lead) return range.tail === 0 && range.start === body.length;
  return (range.start === 0 || body[range.start - 1] === '\n') && (range.tail === 0 || body[end] === '\n');
}
export function segmentOf(body: string, range: LiveRange): string {
  return range.lead ? '' : body.slice(range.start, body.length - range.tail);
}
/** 칸의 새 글자를 본문에 끼운다. 끝에 새로 연 줄(lead)은 글자가 들어올 때에만 줄바꿈을 붙인다. */
export function joinSegment(body: string, range: LiveRange, value: string): { body: string; range: LiveRange } {
  if (range.lead) {
    if (!value) return { body, range };
    return { body: body + range.lead + value, range: { start: body.length + range.lead.length, tail: 0, lead: '' } };
  }
  return { body: body.slice(0, range.start) + value + body.slice(body.length - range.tail), range };
}
/** 본문 끝 빈 곳을 눌렀을 때 열 칸: 마지막 줄이 비어 있으면 그 줄, 아니면 줄바꿈 하나 뒤의 새 줄. */
export function endRange(body: string): LiveRange {
  return body === '' || body.endsWith('\n') ? { start: body.length, tail: 0, lead: '' } : { start: body.length, tail: 0, lead: '\n' };
}
export function rangeOf(body: string, block: LiveBlock): LiveRange {
  return { start: block.start, tail: body.length - block.end, lead: '' };
}

/** 서식 모양에서 누른 자리까지 보인 글자를 원문에서 차례로 짚어, 원문 자리로 옮긴다(서식 기호는 건너뛴다). */
export function sourceOffset(source: string, shown: string): number {
  let at = 0;
  for (const char of shown) {
    if (/\s/.test(char)) continue;
    const found = source.indexOf(char, at);
    if (found < 0) return source.length;
    at = found + 1;
  }
  if (/\s$/.test(shown) && /[ \t]/.test(source[at] ?? '')) at++;
  return at;
}

/** 원문 칸의 글자 크기: 제목 블록은 서식 모양과 같은 크기로 써야 열고 닫을 때 줄이 뛰지 않는다. */
export function headingTextClass(level: number | undefined): string | undefined {
  if (level === 1) return 'text-[32px] leading-[37px] font-extrabold';
  if (level === 2) return 'text-[21px] leading-[29px] font-bold';
  if (level === 3) return 'text-[19px] leading-[29px] font-semibold';
  if (level) return 'text-[15px] leading-7 font-semibold';
  return undefined;
}
