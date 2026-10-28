/** §5.5 #17-27 ⑬ (g) 줄 범위로 열기(순수). 여는 쪽은 길이를 몰라 모양만 세우고(`lineRangeOf`), 편집창이 읽은 뒤 길이에 맞춘다(`clampLineRange`). */

/** 1-based, 양끝 포함. `start <= end` 가 늘 성립한다. */
export interface EditorLineRange {
  readonly start: number;
  readonly end: number;
}

function isLineNumber(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 1;
}

/** 1 미만·정수 아님이면 null. 끝이 없으면 한 줄, 거꾸로면(`#L51-L42`) 바로 세운다 — 적은 순서보다 가리키는 자리가 중요하다. */
export function lineRangeOf(start: number, end?: number | null): EditorLineRange | null {
  if (!isLineNumber(start)) return null;
  const last = end === undefined || end === null || !isLineNumber(end) ? start : end;
  return last >= start ? { start, end: last } : { start: last, end: start };
}

/**
 * 본문의 줄 수 — 편집창이 그리는 줄 수와 같다(`highlightCode` 가 `\n` 으로 가른다).
 * 빈 본문도 한 줄이고, 끝의 줄바꿈 뒤도 한 줄이다.
 */
export function countTextLines(text: string): number {
  let count = 1;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) count += 1;
  return count;
}

/** 끝 줄이 넘으면 끝에서 자르고, 첫 줄부터 넘으면 null — 열기만 한다(#17-27 ⑪ (c) 와 같은 규율). */
export function clampLineRange(range: EditorLineRange, lineCount: number): EditorLineRange | null {
  if (range.start > lineCount) return null;
  return { start: range.start, end: Math.min(range.end, lineCount) };
}

/** n번째 줄(1-based)의 첫 글자 위치 — 캐럿을 그 줄 머리에 둔다. 줄이 모자라면 본문 끝이다. */
export function lineStartOffset(text: string, line: number): number {
  let offset = 0;
  for (let n = 1; n < line; n += 1) {
    const nl = text.indexOf('\n', offset);
    if (nl === -1) return text.length;
    offset = nl + 1;
  }
  return offset;
}

/** `경로:806` · `경로:806-807` — 툴팁이 누르기 전에 "어디로 가는지"를 줄까지 말한다. */
export function formatLineRef(path: string, range: EditorLineRange | null): string {
  if (!range) return path;
  return range.end > range.start ? `${path}:${range.start}-${range.end}` : `${path}:${range.start}`;
}
