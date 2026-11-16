import { describe, expect, it } from 'vitest';
import { continueList, diffRange, flipTask, indentLines, insertBlock, isUrl, linkSelection, moveLines, taskMarks, toggleLinePrefix, toggleTask, toggleTaskAt, wrapSelection } from './textEditing.js';

describe('continueList', () => {
  it('continues bullets and increments numbers', () => {
    expect(continueList('- 가나', 4, 4)).toEqual({ value: '- 가나\n- ', start: 7, end: 7 });
    expect(continueList('9. a', 4, 4)?.value).toBe('9. a\n10. ');
  });
  it('resets checkboxes and keeps nested indent', () => {
    expect(continueList('  - [x] 끝', 10, 10)?.value).toBe('  - [x] 끝\n  - [ ] ');
  });
  it('splits text after the caret onto the new item', () => {
    expect(continueList('- ab', 3, 3)).toEqual({ value: '- a\n- b', start: 6, end: 6 });
  });
  it('ends the list on an empty item', () => {
    expect(continueList('- a\n- ', 6, 6)).toEqual({ value: '- a\n', start: 4, end: 4 });
    expect(continueList('1. ', 3, 3)).toEqual({ value: '', start: 0, end: 0 });
  });
  it('returns null for caret before the marker, selections, plain lines and empty text', () => {
    expect(continueList('- a', 1, 1)).toBeNull();
    expect(continueList('- abc', 3, 4)).toBeNull();
    expect(continueList('plain', 5, 5)).toBeNull();
    expect(continueList('', 0, 0)).toBeNull();
  });
  it('continues quotes', () => { expect(continueList('> q', 3, 3)?.value).toBe('> q\n> '); });
});

describe('indentLines', () => {
  it('returns null for a plain single line', () => { expect(indentLines('abc', 1, 1, false)).toBeNull(); });
  it('indents a list item and outdents back', () => {
    const a = indentLines('- a', 3, 3, false);
    expect(a).toEqual({ value: '  - a', start: 5, end: 5 });
    expect(indentLines(a!.value, 5, 5, true)).toEqual({ value: '- a', start: 3, end: 3 });
  });
  it('indents every selected line', () => {
    const r = indentLines('a\nb\nc', 0, 5, false);
    expect(r).toEqual({ value: '  a\n  b\n  c', start: 0, end: 11 });
    expect(indentLines(r!.value, 0, 11, true)?.value).toBe('a\nb\nc');
  });
  it('outdent never removes more than 2 spaces or non-space chars', () => {
    expect(indentLines('    a\n b', 0, 8, true)?.value).toBe('  a\nb');
    expect(indentLines('a\nb', 0, 3, true)?.value).toBe('a\nb');
  });
  it('excludes the line after a trailing newline selection', () => {
    expect(indentLines('a\nb\nc', 0, 4, false)?.value).toBe('  a\n  b\nc');
    expect(indentLines('- a\nb', 0, 4, false)?.value).toBe('  - a\nb');
  });
});

describe('wrapSelection', () => {
  it('wraps and unwraps symmetrically', () => {
    const on = wrapSelection('한글 text', 0, 2, '**');
    expect(on).toEqual({ value: '**한글** text', start: 2, end: 4 });
    expect(wrapSelection(on.value, on.start, on.end, '**')).toEqual({ value: '한글 text', start: 0, end: 2 });
  });
  it('unwraps when the selection includes the markers', () => {
    expect(wrapSelection('**a**', 0, 5, '**')).toEqual({ value: 'a', start: 0, end: 1 });
  });
  it('inserts a pair with the caret in the middle', () => {
    expect(wrapSelection('', 0, 0, '*')).toEqual({ value: '**', start: 1, end: 1 });
  });
  it('does not unwrap bold when toggling italic', () => {
    expect(wrapSelection('**a**', 2, 3, '*').value).toBe('***a***');
  });
  it('handles surrogate pairs', () => {
    expect(wrapSelection('😀', 0, 2, '*').value).toBe('*😀*');
  });
});

describe('toggleLinePrefix', () => {
  it('adds and removes a heading', () => {
    const on = toggleLinePrefix('title', 2, 2, '## ');
    expect(on).toEqual({ value: '## title', start: 5, end: 5 });
    expect(toggleLinePrefix(on.value, on.start, on.end, '## ').value).toBe('title');
  });
  it('replaces other prefixes and keeps indent', () => {
    expect(toggleLinePrefix('# a', 0, 0, '- ').value).toBe('- a');
    expect(toggleLinePrefix('  1. a', 0, 0, '- [ ] ').value).toBe('  - [ ] a');
  });
  it('applies to every selected line, skipping blanks, and removes only if all have it', () => {
    expect(toggleLinePrefix('a\n\nb', 0, 4, '- ').value).toBe('- a\n\n- b');
    expect(toggleLinePrefix('- a\nb', 0, 5, '- ').value).toBe('- a\n- b');
    expect(toggleLinePrefix('- a\n- b', 0, 7, '- ').value).toBe('a\nb');
  });
  it('works on an empty document', () => { expect(toggleLinePrefix('', 0, 0, '- ')).toEqual({ value: '- ', start: 2, end: 2 }); });
});

describe('diffRange', () => {
  it('finds the minimal replaced range', () => {
    expect(diffRange('hello world', 'hello brave world')).toEqual({ from: 6, to: 6, insert: 'brave ' });
    expect(diffRange('abcd', 'abXd')).toEqual({ from: 2, to: 3, insert: 'X' });
    expect(diffRange('abc', 'abc')).toEqual({ from: 3, to: 3, insert: '' });
    expect(diffRange('', '가')).toEqual({ from: 0, to: 0, insert: '가' });
    expect(diffRange('aaa', 'aa')).toEqual({ from: 2, to: 3, insert: '' });
  });
  it('does not split surrogate pairs', () => {
    const r = diffRange('a😀', 'a😁');
    expect(r).toEqual({ from: 1, to: 3, insert: '😁' });
  });
});

describe('toggleTask', () => {
  it('turns lines into checkboxes, keeping indent and replacing other markers', () => {
    expect(toggleTask('buy milk', 3, 3)).toEqual({ value: '- [ ] buy milk', start: 9, end: 9 });
    expect(toggleTask('  1. a\n\n- [x] b', 0, 16).value).toBe('  - [ ] a\n\n- [x] b');
  });
  it('checks every selected checkbox, and unchecks only when all are checked', () => {
    expect(toggleTask('- [ ] a\n- [x] b', 0, 15).value).toBe('- [x] a\n- [x] b');
    expect(toggleTask('- [x] a\n- [X] b', 0, 15)).toEqual({ value: '- [ ] a\n- [ ] b', start: 0, end: 15 });
    expect(toggleTask('1. [ ] a', 8, 8).value).toBe('1. [x] a');
  });
});

describe('flipTask and toggleTaskAt', () => {
  it('flips the mark inside the brackets only', () => {
    expect(flipTask('- [ ] a', 3)).toBe('- [x] a');
    expect(flipTask('- [X] a', 3)).toBe('- [ ] a');
    expect(flipTask('- [ ] a', 4)).toBeNull();
    expect(flipTask('a[b]c', 2)).toBeNull();
  });
  it('finds the mark from the offset of a list item', () => {
    expect(toggleTaskAt('> - [ ] quoted', 2)).toBe('> - [x] quoted');
    expect(toggleTaskAt('10. [x] ten', 0)).toBe('10. [ ] ten');
    expect(toggleTaskAt('- plain', 0)).toBeNull();
  });
  it('lists the checkbox marks of a body', () => {
    expect(taskMarks('- [ ] a\ntext\n  * [x] b')).toEqual([{ at: 3, checked: false }, { at: 18, checked: true }]);
  });
});

describe('moveLines', () => {
  it('moves the caret line up and down with the caret', () => {
    expect(moveLines('a\nb\nc', 2, 2, true)).toEqual({ value: 'b\na\nc', start: 0, end: 0 });
    expect(moveLines('a\nb\nc', 3, 3, false)).toEqual({ value: 'a\nc\nb', start: 5, end: 5 });
  });
  it('moves every selected line as one block', () => {
    expect(moveLines('a\nb\nc\nd', 2, 5, true)).toEqual({ value: 'b\nc\na\nd', start: 0, end: 3 });
    expect(moveLines('a\nb\nc', 0, 2, false)).toEqual({ value: 'b\na\nc', start: 2, end: 4 });
  });
  it('stops at the edges', () => {
    expect(moveLines('a\nb', 0, 0, true)).toBeNull();
    expect(moveLines('a\nb', 3, 3, false)).toBeNull();
  });
});

describe('insertBlock and linkSelection', () => {
  it('adds only the blank lines that are missing', () => {
    expect(insertBlock('', 0, 0, '---').value).toBe('---\n');
    expect(insertBlock('a\n\n', 3, 3, '---').value).toBe('a\n\n---\n');
    expect(insertBlock('a\nb', 2, 2, '---').value).toBe('a\n\n---\n\nb');
  });
  it('wraps the selection and leaves the caret where something is missing', () => {
    expect(linkSelection('', 0, 0)).toEqual({ value: '[]()', start: 1, end: 1 });
    expect(linkSelection('go', 0, 2, 'https://a.dev')).toEqual({ value: '[go](https://a.dev)', start: 19, end: 19 });
    expect(isUrl('mailto:a@b.c')).toBe(true); expect(isUrl('not a url')).toBe(false);
  });
});

describe('quote prefix', () => {
  it('toggles and replaces like the other line prefixes', () => {
    expect(toggleLinePrefix('said', 0, 0, '> ').value).toBe('> said');
    expect(toggleLinePrefix('> said', 0, 0, '> ').value).toBe('said');
    expect(toggleLinePrefix('> said', 0, 0, '- ').value).toBe('- said');
    expect(toggleLinePrefix('- a', 0, 0, '- ', true).value).toBe('- a');
  });
});
