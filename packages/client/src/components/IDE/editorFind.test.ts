import { describe, expect, it } from 'vitest';
import type { CodeToken } from './codeHighlight.js';
import {
  DEFAULT_FIND_OPTIONS,
  currentMatchIndex,
  findMatches,
  indexOfExactMatch,
  isWholeWordMatch,
  lineStartOffsets,
  makeReplacer,
  marksByLine,
  matchIndexFrom,
  nextMatchIndex,
  prevMatchIndex,
  replaceAllMatches,
  sameLineMarks,
  seedFindQuery,
  splitTokensByMarks,
  type FindOptions,
  type LinePiece,
} from './editorFind.js';

/** §5.5 #17-27 ⑲ — 찾기·바꾸기: 무엇이 맞고 · 어디로 가고 · 무엇으로 바뀌고 · 어느 글자를 칠하는지. */

const opts = (over: Partial<FindOptions> = {}): FindOptions => ({ ...DEFAULT_FIND_OPTIONS, ...over });
const spans = (text: string, query: string, over: Partial<FindOptions> = {}): string[] =>
  findMatches(text, query, opts(over)).matches.map((m) => text.slice(m.start, m.end));

describe('findMatches — 무엇이 맞는가', () => {
  it('기본은 대/소문자를 가리지 않고, 정규식 특수 문자도 글자 그대로 찾는다', () => {
    expect(spans('Foo foo FOO', 'foo')).toEqual(['Foo', 'foo', 'FOO']);
    expect(spans('a.b axb a.b', 'a.b')).toEqual(['a.b', 'a.b']);
    expect(spans('x(1) x(2)', 'x(1)')).toEqual(['x(1)']);
  });

  it('대/소문자 스위치를 켜면 그대로만 맞는다', () => {
    expect(spans('Foo foo FOO', 'foo', { matchCase: true })).toEqual(['foo']);
  });

  it('단어 단위는 낱말 안에서 잘린 자리를 버린다 — 한글 낱말도 낱말이다(\\b 는 ASCII 만 본다)', () => {
    expect(spans('cat concat cat_x cat.', 'cat', { wholeWord: true })).toEqual(['cat', 'cat']);
    expect(spans('한글 한글자 한글.', '한글', { wholeWord: true })).toEqual(['한글', '한글']);
    // 기호로 시작하는 말은 그쪽 경계를 따지지 않는다(VS Code 와 같다).
    expect(spans('a.foo', '.foo', { wholeWord: true })).toEqual(['.foo']);
  });

  it('정규식 — 묶음·줄 머리(m 깃발)·여러 줄', () => {
    expect(spans('ab1 ab22', 'ab(\\d+)', { regex: true })).toEqual(['ab1', 'ab22']);
    expect(spans('x\ny\nx', '^x', { regex: true })).toEqual(['x', 'x']);
    expect(spans('a\nb', 'a\\nb', { regex: true })).toEqual(['a\nb']);
  });

  it('깨진 정규식은 결과 0 + invalid 다(터지지 않는다)', () => {
    const r = findMatches('abc', '(', opts({ regex: true }));
    expect(r).toEqual({ matches: [], capped: false, invalid: true });
  });

  it('길이 0 결과(`^`)도 줄마다 하나씩이고, 끝없이 돌지 않는다', () => {
    const r = findMatches('a\nb\n', '^', opts({ regex: true }));
    expect(r.matches.map((m) => m.start)).toEqual([0, 2, 4]);
    expect(r.matches.every((m) => m.end === m.start)).toBe(true);
  });

  it('대리쌍(이모지) 사이에서 길이 0 결과가 쪼개지지 않는다', () => {
    const r = findMatches('😀😀', '', opts());
    expect(r.matches).toEqual([]); // 빈 찾을 말은 아무것도 찾지 않는다
    const z = findMatches('😀😀', '(?:)', opts({ regex: true }));
    expect(z.matches.map((m) => m.start)).toEqual([0, 2, 4]);
  });

  it('상한에서 멈추면 capped 이고, 딱 상한만큼이면 capped 가 아니다', () => {
    expect(findMatches('aaaa', 'a', opts(), 3)).toMatchObject({ capped: true });
    expect(findMatches('aaa', 'a', opts(), 3)).toMatchObject({ capped: false });
    expect(findMatches('aaaa', 'a', opts(), 3).matches).toHaveLength(3);
  });
});

describe('isWholeWordMatch', () => {
  it('양 끝이 낱말 글자에 붙어 있으면 아니다', () => {
    expect(isWholeWordMatch('xcat', 1, 4)).toBe(false);
    expect(isWholeWordMatch('catx', 0, 3)).toBe(false);
    expect(isWholeWordMatch(' cat ', 1, 4)).toBe(true);
    expect(isWholeWordMatch('cat', 0, 0)).toBe(false);
  });
});

describe('다음·이전 — 어디로 가는가', () => {
  const list = findMatches('foo bar foo bar foo', 'foo', opts()).matches; // 0, 8, 16

  it('고른 것이 결과 그대로면 그 다음/앞으로, 끝에서는 돈다', () => {
    expect(nextMatchIndex(list, 0, 3)).toBe(1);
    expect(nextMatchIndex(list, 16, 19)).toBe(0);
    expect(prevMatchIndex(list, 0, 3)).toBe(2);
    expect(prevMatchIndex(list, 8, 11)).toBe(0);
  });

  it('커서만 있으면 커서 뒤 첫 결과 / 커서 앞 마지막 결과', () => {
    expect(nextMatchIndex(list, 5, 5)).toBe(1);
    expect(prevMatchIndex(list, 5, 5)).toBe(0);
    expect(prevMatchIndex(list, 0, 0)).toBe(2);
    expect(nextMatchIndex(list, 19, 19)).toBe(0);
  });

  it('결과가 없으면 -1', () => {
    expect(nextMatchIndex([], 0, 0)).toBe(-1);
    expect(prevMatchIndex([], 0, 0)).toBe(-1);
    expect(matchIndexFrom([], 0)).toBe(-1);
  });

  it('지금 결과 — 고른 것이 결과면 그것, 아니면 커서 뒤 처음', () => {
    expect(currentMatchIndex(list, 8, 11)).toBe(1);
    expect(currentMatchIndex(list, 9, 9)).toBe(2);
    expect(indexOfExactMatch(list, 8, 10)).toBe(-1);
  });
});

describe('seedFindQuery — 막대를 열 때 채울 말', () => {
  it('한 줄짜리 고른 글자는 그대로, 여러 줄이면 쓰지 않는다', () => {
    expect(seedFindQuery('hello world', 0, 5)).toBe('hello');
    expect(seedFindQuery('a\nb', 0, 3)).toBeNull();
  });

  it('고른 것이 없으면 커서 자리의 낱말(한글 포함), 낱말이 아니면 없다', () => {
    expect(seedFindQuery('call fooBar(1)', 7, 7)).toBe('fooBar');
    expect(seedFindQuery('변수 이름', 1, 1)).toBe('변수');
    expect(seedFindQuery('a  b', 2, 2)).toBeNull();
  });
});

describe('바꾸기', () => {
  it('정규식이 아니면 바꿀 말 그대로다($1 도 글자다)', () => {
    const text = 'a1 a2';
    const replacer = makeReplacer(text, 'a', '$1x', opts());
    expect(replacer({ start: 0, end: 1 })).toBe('$1x');
  });

  it('정규식은 $1·$&·$<이름>·$$·$0 과 \\n·\\t 를 편다', () => {
    const text = 'key=value';
    const re = opts({ regex: true });
    const m = { start: 0, end: 9 };
    expect(makeReplacer(text, '(\\w+)=(\\w+)', '$2=$1', re)(m)).toBe('value=key');
    expect(makeReplacer(text, '(?<k>\\w+)=(?<v>\\w+)', '$<v>:$<k>', re)(m)).toBe('value:key');
    expect(makeReplacer(text, '\\w+=\\w+', '[$&]', re)(m)).toBe('[key=value]');
    expect(makeReplacer(text, '\\w+=\\w+', '$$', re)(m)).toBe('$');
    expect(makeReplacer(text, '\\w+=\\w+', '$0!', re)(m)).toBe('key=value!');
    expect(makeReplacer(text, '(\\w+)=(\\w+)', '$1\\n$2\\t', re)(m)).toBe('key\nvalue\t');
  });

  it('대소문자 바꾸기는 바로 뒤 묶음 하나에만 걸린다', () => {
    const text = 'foo_bar';
    const re = opts({ regex: true });
    const m = { start: 0, end: 7 };
    expect(makeReplacer(text, '(\\w+)_(\\w+)', '\\U$1_$2', re)(m)).toBe('FOO_bar');
    expect(makeReplacer(text, '(\\w+)_(\\w+)', '$1\\u$2', re)(m)).toBe('fooBar');
  });

  it('그 자리가 지금 본문에서 더는 맞지 않으면 null — 보지 않은 자리를 바꾸지 않는다', () => {
    expect(makeReplacer('xyz', 'a+', 'b', opts({ regex: true }))({ start: 0, end: 1 })).toBeNull();
  });

  it('모두 바꾸기는 원문 위치로 잘라 한 번에 바꾸고, 커서를 함께 옮긴다', () => {
    const text = 'aa b aa b aa';
    const list = findMatches(text, 'aa', opts()).matches; // 0, 5, 10
    const replacer = makeReplacer(text, 'aa', 'XYZ', opts());
    // 커서가 두 번째 결과 뒤(7)에 있었다 → 앞의 두 결과가 각각 한 글자씩 늘었다.
    expect(replaceAllMatches(text, list, replacer, 7)).toEqual({ text: 'XYZ b XYZ b XYZ', keep: 9, count: 3 });
    // 결과 안의 커서는 그 결과의 시작으로.
    expect(replaceAllMatches(text, list, replacer, 6).keep).toBe(6);
    // 맨 뒤 커서는 전부 민 만큼.
    expect(replaceAllMatches(text, list, replacer, 12).keep).toBe(15);
  });

  it('`^` 로 줄마다 머리에 넣는다(길이 0 결과 바꾸기)', () => {
    const text = 'a\nb';
    const list = findMatches(text, '^', opts({ regex: true })).matches;
    const out = replaceAllMatches(text, list, makeReplacer(text, '^', '// ', opts({ regex: true })), 0);
    expect(out.text).toBe('// a\n// b');
  });
});

describe('그리기 — 줄마다 칠할 자리', () => {
  it('여러 줄에 걸친 결과는 줄마다 잘리고, 줄바꿈만 맞은 결과는 길이 0 표식이 된다', () => {
    const text = 'ab\ncd\nef';
    const starts = lineStartOffsets(text);
    expect(starts).toEqual([0, 3, 6]);
    const marks = marksByLine(starts, text.length, [{ start: 1, end: 4 }], 0);
    expect(marks.get(0)).toEqual([{ start: 1, end: 2, current: true }]);
    expect(marks.get(1)).toEqual([{ start: 0, end: 1, current: true }]);
    const nl = marksByLine(starts, text.length, [{ start: 2, end: 3 }], -1);
    expect(nl.get(0)).toEqual([{ start: 2, end: 2, current: false }]);
  });

  const tokens: CodeToken[] = [
    { text: 'const', kind: 'keyword' },
    { text: ' ', kind: 'plain' },
    { text: 'foo', kind: 'plain' },
    { text: ' = ', kind: 'punct' },
    { text: '1', kind: 'number' },
  ];
  const joined = (pieces: LinePiece[]): string => pieces.map((p) => ('text' in p ? p.text : '')).join('');

  it('색 토큰을 칠할 경계에서 다시 자르되 글자는 하나도 더하거나 빼지 않는다', () => {
    const pieces = splitTokensByMarks(tokens, [{ start: 3, end: 9, current: true }]);
    expect(joined(pieces)).toBe('const foo = 1');
    expect(pieces.filter((p) => 'text' in p && p.mark === 'current').map((p) => ('text' in p ? p.text : ''))).toEqual(['st', ' ', 'foo']);
    expect(pieces[0]).toEqual({ text: 'con', kind: 'keyword', mark: 'none' });
  });

  it('길이 0 결과는 그 자리에 표식 조각, 줄 끝·빈 줄에서도 선다', () => {
    const atStart = splitTokensByMarks(tokens, [{ start: 0, end: 0, current: false }]);
    expect(atStart[0]).toEqual({ caret: 'match' });
    expect(joined(atStart)).toBe('const foo = 1');
    const atEnd = splitTokensByMarks(tokens, [{ start: 13, end: 13, current: true }]);
    expect(atEnd[atEnd.length - 1]).toEqual({ caret: 'current' });
    expect(splitTokensByMarks([], [{ start: 0, end: 0, current: true }])).toEqual([{ caret: 'current' }]);
    const inside = splitTokensByMarks(tokens, [{ start: 2, end: 2, current: false }]);
    expect(inside.slice(0, 3)).toEqual([
      { text: 'co', kind: 'keyword', mark: 'none' },
      { caret: 'match' },
      { text: 'nst', kind: 'keyword', mark: 'none' },
    ]);
  });

  it('칠할 자리가 같으면 같은 줄로 본다(그 줄을 다시 그리지 않는다)', () => {
    expect(sameLineMarks(undefined, undefined)).toBe(true);
    expect(sameLineMarks([{ start: 0, end: 1, current: false }], [{ start: 0, end: 1, current: false }])).toBe(true);
    expect(sameLineMarks([{ start: 0, end: 1, current: false }], [{ start: 0, end: 1, current: true }])).toBe(false);
    expect(sameLineMarks([], undefined)).toBe(false);
  });
});
