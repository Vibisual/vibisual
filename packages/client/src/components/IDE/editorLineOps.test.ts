import { describe, expect, it } from 'vitest';
import { commentTokensFor } from './editorComments.js';
import {
  copyLines,
  deleteLines,
  detectIndentUnit,
  diffEdit,
  indentLines,
  insertLine,
  lineNumberAt,
  moveLines,
  newlineWithIndent,
  offsetOfLineColumn,
  outdentLines,
  parseGotoLine,
  selectLines,
  selectedLineBlock,
  toggleBlockComment,
  toggleLineComment,
  type CommentTokens,
} from './editorLineOps.js';

/**
 * §5.5 #17-27 ⑲ — 편집창 줄 편집 명령의 순수 계산.
 *
 * 키는 VS Code 와 같고 동작도 VS Code 를 따른다. 본문만이 아니라 **캐럿·선택이 어디로 가는지**까지
 * 고정한다 — 줄 하나 어긋나는 사고는 화면으로 잡기 어렵다.
 */

const C: CommentTokens = { line: '//', block: ['/*', '*/'] };

describe('selectedLineBlock — 고른 범위가 덮는 줄', () => {
  it('끝이 다음 줄 첫 칸이면 그 줄은 넣지 않는다(줄 단위로 고른 모양)', () => {
    const text = 'ab\ncd\nef';
    expect(selectedLineBlock(text, 1, 1)).toEqual({ from: 0, to: 2 });
    expect(selectedLineBlock(text, 0, 6)).toEqual({ from: 0, to: 5 });
    expect(selectedLineBlock(text, 1, 4)).toEqual({ from: 0, to: 5 });
  });
});

describe('줄 복사·이동·삭제', () => {
  it('아래로 복사는 선택이 새 벌로, 위로 복사는 제자리', () => {
    expect(copyLines('A\nB', 0, 0, 'down')).toEqual({ text: 'A\nA\nB', selectionStart: 2, selectionEnd: 2 });
    expect(copyLines('A\nB', 0, 0, 'up')).toEqual({ text: 'A\nA\nB', selectionStart: 0, selectionEnd: 0 });
    expect(copyLines('a\nb\nc', 0, 3, 'down')).toEqual({ text: 'a\nb\na\nb\nc', selectionStart: 4, selectionEnd: 7 });
  });

  it('위·아래 줄과 맞바꾸고 선택이 따라간다, 맨 끝에서는 할 일이 없다', () => {
    expect(moveLines('A\nB\nC', 2, 2, 'up')).toEqual({ text: 'B\nA\nC', selectionStart: 0, selectionEnd: 0 });
    expect(moveLines('A\nB\nC', 2, 2, 'down')).toEqual({ text: 'A\nC\nB', selectionStart: 4, selectionEnd: 4 });
    expect(moveLines('A\nB', 0, 0, 'up')).toBeNull();
    expect(moveLines('A\nB', 2, 2, 'down')).toBeNull();
    expect(moveLines('a\nb\nc\nd', 2, 5, 'down')).toEqual({ text: 'a\nd\nb\nc', selectionStart: 4, selectionEnd: 7 });
  });

  it('지우면 그 자리에 올라온 줄의 같은 칸으로(짧으면 줄 끝), 마지막 줄은 앞 줄바꿈까지', () => {
    expect(deleteLines('A\nB\nC', 2, 2)).toEqual({ text: 'A\nC', selectionStart: 2, selectionEnd: 2 });
    expect(deleteLines('abcd\nxy', 3, 3)).toEqual({ text: 'xy', selectionStart: 2, selectionEnd: 2 });
    expect(deleteLines('A\nB', 3, 3)).toEqual({ text: 'A', selectionStart: 1, selectionEnd: 1 });
    expect(deleteLines('A', 0, 0)).toEqual({ text: '', selectionStart: 0, selectionEnd: 0 });
    expect(deleteLines('', 0, 0)).toBeNull();
  });
});

describe('줄 넣기·고르기', () => {
  it('아래/위에 빈 줄을 넣고 그 줄의 들여쓰기에 캐럿을 둔다', () => {
    expect(insertLine('  foo\nbar', 3, 3, 'below')).toEqual({ text: '  foo\n  \nbar', selectionStart: 8, selectionEnd: 8 });
    expect(insertLine('  foo\nbar', 3, 3, 'above')).toEqual({ text: '  \n  foo\nbar', selectionStart: 2, selectionEnd: 2 });
  });

  it('줄 고르기는 줄바꿈까지, 다시 누르면 한 줄 더', () => {
    const text = 'ab\ncd\nef';
    expect(selectLines(text, 1, 1)).toEqual({ text, selectionStart: 0, selectionEnd: 3 });
    expect(selectLines(text, 0, 3)).toEqual({ text, selectionStart: 0, selectionEnd: 6 });
    expect(selectLines('ab\ncd', 4, 4)).toEqual({ text: 'ab\ncd', selectionStart: 3, selectionEnd: 5 });
  });
});

describe('들여쓰기', () => {
  it('Ctrl+] 는 줄 머리에 넣고(빈 줄은 건너뛴다), 줄 단위 선택은 그대로 줄 머리부터 덮는다', () => {
    expect(indentLines('a\n\nb', 0, 4)).toEqual({ text: '  a\n\n  b', selectionStart: 0, selectionEnd: 8 });
    expect(indentLines('a', 0, 0, '\t')).toEqual({ text: '\ta', selectionStart: 1, selectionEnd: 1 });
  });

  it('Ctrl+[ 는 탭이면 탭 하나, 스페이스면 한 단계 폭까지 — 뺄 것이 없으면 null', () => {
    expect(outdentLines('    a\n\tb', 0, 8, '\t')).toEqual({ text: 'a\nb', selectionStart: 0, selectionEnd: 3 });
    expect(outdentLines('abc', 0, 0)).toBeNull();
  });

  it('파일이 쓰는 들여쓰기 단위를 알아본다 — 탭 · 스페이스 넷 · 둘 · 없으면 기본값', () => {
    expect(detectIndentUnit('\tfoo\n\tbar\nbaz')).toBe('\t');
    expect(detectIndentUnit('a\n    b\n        c\n    d')).toBe('    ');
    expect(detectIndentUnit('a\n  b\n    c')).toBe('  ');
    expect(detectIndentUnit('a\nb')).toBe('  ');
    // 블록 주석의 ` * ` 한 칸은 들여쓰기 단위가 아니다.
    expect(detectIndentUnit('/**\n * x\n */\nfoo')).toBe('  ');
  });

  it('Enter 는 지금 줄의 들여쓰기를 잇고, 여는 괄호 뒤면 한 단계 더, 괄호 사이면 닫는 괄호를 내린다', () => {
    expect(newlineWithIndent('  foo', 5, 5)).toEqual({ text: '  foo\n  ', selectionStart: 8, selectionEnd: 8 });
    expect(newlineWithIndent('  if (x) {', 10, 10)).toEqual({ text: '  if (x) {\n    ', selectionStart: 15, selectionEnd: 15 });
    expect(newlineWithIndent('{}', 1, 1)).toEqual({ text: '{\n  \n}', selectionStart: 4, selectionEnd: 4 });
    expect(newlineWithIndent('f(  )', 2, 2)).toEqual({ text: 'f(\n  \n)', selectionStart: 5, selectionEnd: 5 });
    expect(newlineWithIndent('\tx', 2, 2, '\t')).toEqual({ text: '\tx\n\t', selectionStart: 4, selectionEnd: 4 });
  });
});

describe('주석', () => {
  it('줄 주석은 가장 얕은 들여쓰기 자리에 달고, 전부 주석이면 걷는다', () => {
    const on = toggleLineComment('  a\n    b', 0, 9, C);
    expect(on).toEqual({ text: '  // a\n  //   b', selectionStart: 0, selectionEnd: 15 });
    expect(toggleLineComment(on!.text, 0, on!.text.length, C)?.text).toBe('  a\n    b');
  });

  it('빈 줄은 건드리지 않고, 캐럿 하나면 캐럿이 글자와 함께 밀린다', () => {
    expect(toggleLineComment('a\n\nb', 0, 4, C)?.text).toBe('// a\n\n// b');
    expect(toggleLineComment('x', 0, 0, C)).toEqual({ text: '// x', selectionStart: 3, selectionEnd: 3 });
  });

  it('줄 주석이 없는 언어(HTML)는 블록 기호로 줄마다 감싸고 다시 누르면 벗긴다', () => {
    const html: CommentTokens = { line: null, block: ['<!--', '-->'] };
    const on = toggleLineComment('<p>x</p>', 0, 0, html);
    expect(on?.text).toBe('<!-- <p>x</p> -->');
    expect(toggleLineComment(on!.text, 0, 0, html)?.text).toBe('<p>x</p>');
    expect(toggleLineComment('x', 0, 0, { line: null, block: null })).toBeNull();
  });

  it('블록 주석 — 감싸고, 바깥에 기호가 있으면 벗기고, 고른 글자 자체가 감싸여 있어도 벗긴다', () => {
    expect(toggleBlockComment('ab', 1, 1, C)).toEqual({ text: 'a/*  */b', selectionStart: 4, selectionEnd: 4 });
    const wrapped = toggleBlockComment('foo bar', 0, 3, C);
    expect(wrapped).toEqual({ text: '/* foo */ bar', selectionStart: 3, selectionEnd: 6 });
    expect(toggleBlockComment(wrapped!.text, 3, 6, C)).toEqual({ text: 'foo bar', selectionStart: 0, selectionEnd: 3 });
    expect(toggleBlockComment('/* foo */ bar', 0, 9, C)).toEqual({ text: 'foo bar', selectionStart: 0, selectionEnd: 3 });
    expect(toggleBlockComment('x', 0, 1, { line: '#', block: null })).toBeNull();
  });

  it('주석 기호는 확장자까지 본다 — 색칠용 언어 표가 틀린 자리(lua·언리얼 ini·css·마크다운)를 바로잡는다', () => {
    expect(commentTokensFor('Source/X.h', 'c')).toEqual({ line: '//', block: ['/*', '*/'] });
    expect(commentTokensFor('a.lua', 'python')).toEqual({ line: '--', block: ['--[[', ']]'] });
    expect(commentTokensFor('Config/DefaultEngine.ini', 'ini')).toEqual({ line: ';', block: null });
    expect(commentTokensFor('.env', 'ini')).toEqual({ line: '#', block: null });
    expect(commentTokensFor('style.css', 'css')).toEqual({ line: null, block: ['/*', '*/'] });
    expect(commentTokensFor('style.scss', 'css')).toEqual({ line: '//', block: ['/*', '*/'] });
    expect(commentTokensFor('README.md', 'markdown')).toEqual({ line: null, block: ['<!--', '-->'] });
    expect(commentTokensFor('notes.txt', 'plain')).toEqual({ line: null, block: null });
  });
});

describe('줄 번호로 가기', () => {
  it('줄 · 줄:열 · 줄,열 · 끝에서 센 줄 — 파일 안으로 당긴다', () => {
    expect(parseGotoLine('12', 100)).toEqual({ line: 12, column: 1 });
    expect(parseGotoLine('12:5', 100)).toEqual({ line: 12, column: 5 });
    expect(parseGotoLine(' 12 , 5 ', 100)).toEqual({ line: 12, column: 5 });
    expect(parseGotoLine('-1', 100)).toEqual({ line: 100, column: 1 });
    expect(parseGotoLine('500', 100)).toEqual({ line: 100, column: 1 });
    expect(parseGotoLine('0', 100)).toBeNull();
    expect(parseGotoLine('abc', 100)).toBeNull();
    expect(parseGotoLine('', 100)).toBeNull();
  });

  it('줄·열 → 위치, 열이 줄보다 길면 줄 끝, 줄이 모자라면 본문 끝', () => {
    expect(offsetOfLineColumn('ab\ncd', 2, 2)).toBe(4);
    expect(offsetOfLineColumn('ab\ncd', 2, 99)).toBe(5);
    expect(offsetOfLineColumn('ab\ncd', 5, 1)).toBe(5);
    expect(lineNumberAt('ab\ncd\nef', 4)).toBe(2);
    expect(lineNumberAt('ab\ncd\nef', 0)).toBe(1);
  });
});

describe('diffEdit — 되돌리기가 이어지는 한 번의 바꿔 끼우기', () => {
  it('앞뒤 같은 부분을 빼고 가운데만 바꾼다', () => {
    expect(diffEdit('hello world', 'hello there world')).toEqual({ from: 6, to: 6, insert: 'there ' });
    expect(diffEdit('abc', 'abc')).toEqual({ from: 3, to: 3, insert: '' });
    expect(diffEdit('a\nb\nc', 'a\nc')).toEqual({ from: 2, to: 4, insert: '' });
  });

  it('대리쌍(이모지) 한가운데에서 자르지 않는다', () => {
    expect(diffEdit('a😀', 'a😁')).toEqual({ from: 1, to: 3, insert: '😁' });
    expect(diffEdit('😀b', '😁b')).toEqual({ from: 0, to: 2, insert: '😁' });
  });
});
