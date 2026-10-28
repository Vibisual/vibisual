import { describe, it, expect } from 'vitest';
import { clampLineRange, countTextLines, formatLineRef, lineRangeOf, lineStartOffset } from './editorLineRange.js';

/** §5.5 #17-27 ⑬ (g) — 줄 범위 열기. 잡는 사고: 줄 수가 어긋나 한 줄 밀린 강조 · 없는 줄로 스크롤(열기만 해야 한다) · 줄 머리가 아닌 캐럿. */

describe('lineRangeOf — 모양을 바로 세운다', () => {
  it('한 줄 · 범위', () => {
    expect(lineRangeOf(806)).toEqual({ start: 806, end: 806 });
    expect(lineRangeOf(806, 807)).toEqual({ start: 806, end: 807 });
    expect(lineRangeOf(806, null)).toEqual({ start: 806, end: 806 });
  });

  it('거꾸로 적힌 범위는 바로 세운다', () => {
    expect(lineRangeOf(51, 42)).toEqual({ start: 42, end: 51 });
  });

  it('1 미만·정수 아닌 값은 줄이 아니다', () => {
    expect(lineRangeOf(0)).toBeNull();
    expect(lineRangeOf(-3)).toBeNull();
    expect(lineRangeOf(1.5)).toBeNull();
    expect(lineRangeOf(Number.NaN)).toBeNull();
  });

  it('끝이 쓸 수 없는 값이면 한 줄로 본다', () => {
    expect(lineRangeOf(5, 0)).toEqual({ start: 5, end: 5 });
    expect(lineRangeOf(5, Number.NaN)).toEqual({ start: 5, end: 5 });
  });
});

describe('countTextLines — 편집창이 그리는 줄 수와 같다', () => {
  it('빈 본문도 한 줄, 끝 줄바꿈 뒤도 한 줄', () => {
    expect(countTextLines('')).toBe(1);
    expect(countTextLines('a')).toBe(1);
    expect(countTextLines('a\nb')).toBe(2);
    expect(countTextLines('a\n')).toBe(2);
    expect(countTextLines('\n\n')).toBe(3);
  });

  it('`highlightCode` 가 가르는 방식(`split("\\n")`)과 같은 수를 낸다', () => {
    for (const text of ['', 'x', 'a\r\nb\r\n', 'one\ntwo\n\nfour', '\n']) {
      expect(countTextLines(text)).toBe(text.split('\n').length);
    }
  });
});

describe('clampLineRange — 파일 길이에 맞춘다', () => {
  it('안에 들면 그대로', () => {
    expect(clampLineRange({ start: 806, end: 807 }, 900)).toEqual({ start: 806, end: 807 });
    expect(clampLineRange({ start: 1, end: 1 }, 1)).toEqual({ start: 1, end: 1 });
  });

  it('끝 줄이 넘으면 끝에서 자른다', () => {
    expect(clampLineRange({ start: 806, end: 900 }, 810)).toEqual({ start: 806, end: 810 });
  });

  it('첫 줄부터 넘으면 null — 열기만 하고 움직이지 않는다', () => {
    expect(clampLineRange({ start: 806, end: 807 }, 805)).toBeNull();
  });
});

describe('lineStartOffset — 캐럿은 그 줄 머리에', () => {
  const text = 'ab\ncd\nef';

  it('줄마다 첫 글자 위치', () => {
    expect(lineStartOffset(text, 1)).toBe(0);
    expect(lineStartOffset(text, 2)).toBe(3);
    expect(lineStartOffset(text, 3)).toBe(6);
  });

  it('줄이 모자라면 본문 끝', () => {
    expect(lineStartOffset(text, 4)).toBe(text.length);
    expect(lineStartOffset('', 9)).toBe(0);
  });
});

describe('formatLineRef — 툴팁의 `경로:줄`', () => {
  it('줄이 없으면 경로 그대로 · 한 줄 · 범위', () => {
    expect(formatLineRef('C:/repo/a.ts', null)).toBe('C:/repo/a.ts');
    expect(formatLineRef('C:/repo/a.ts', { start: 3, end: 3 })).toBe('C:/repo/a.ts:3');
    expect(formatLineRef('C:/repo/a.ts', { start: 806, end: 807 })).toBe('C:/repo/a.ts:806-807');
  });
});
