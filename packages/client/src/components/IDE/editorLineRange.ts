/**
 * editorLineRange.ts — §5.5 #17-27 ⑬ (g) "이 파일을 이 줄 범위로 연다"의 **순수 계산**.
 *
 * 본문 링크(`[X.h:806-807](…/X.h#L806-L807)`)·오류 줄(#17-20 ⑪)이 들고 온 줄 번호는, 편집창이 그 파일을
 * 다 읽기 전까지 파일이 몇 줄인지 모른다. 그래서 일이 둘로 갈린다 — 여는 쪽은 **모양만** 바로 세우고
 * (`lineRangeOf`), 편집창은 본문을 다 읽은 뒤 **길이에 맞춘다**(`clampLineRange`).
 *
 * 화면·통신을 섞지 않은 이유는 `editorFollow.ts` 와 같다 — 엉뚱한 줄로 가는 사고는 눈으로 잡기 어렵고,
 * 단위 테스트가 훨씬 촘촘히 잡는다.
 */

/** 1-based, 양끝 포함. `start <= end` 가 늘 성립한다. */
export interface EditorLineRange {
  readonly start: number;
  readonly end: number;
}

function isLineNumber(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 1;
}

/**
 * 줄 번호 둘을 범위로 세운다. 1 미만이거나 정수가 아니면 줄이 아니므로 null.
 * 끝이 없거나 쓸 수 없으면 한 줄이고, 거꾸로 적혔으면(`#L51-L42`) 바로 세운다 —
 * 에이전트가 적은 순서보다 가리키는 자리가 중요하다.
 */
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

/**
 * 파일 길이에 맞춘다. 끝 줄이 파일 끝을 넘으면 끝에서 자르고, 첫 줄부터 넘으면 null —
 * 그때는 **열기만** 한다(없는 줄로 끌고 가지 않는다 — #17-27 ⑪ (c) 와 같은 규율).
 */
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
