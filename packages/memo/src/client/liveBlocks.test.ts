import { describe, expect, it } from 'vitest';
import { blockAt, endRange, joinSegment, rangeFits, sourceOffset, splitBlocks } from './liveBlocks.js';

const shape = (text: string): string[] => splitBlocks(text).map(block => `${block.kind}:${text.slice(block.start, block.end)}`);

describe('memo live blocks', () => {
  it('keeps one plain line per block and groups lists, tables, quotes and fences', () => {
    const text = '# 제목\n첫 줄\n둘째 줄\n\n- a\n  이어짐\n- b\n| x |\n| --- |\n> 인용\n> 계속\n```\n코드\n\n끝\n```\n---';
    expect(shape(text)).toEqual(['heading:# 제목', 'paragraph:첫 줄', 'paragraph:둘째 줄', 'blank:', 'list:- a\n  이어짐\n- b',
      'table:| x |\n| --- |', 'quote:> 인용\n> 계속', 'code:```\n코드\n\n끝\n```', 'hr:---']);
  });
  it('covers every line so the blocks joined by single newlines give the text back', () => {
    for (const text of ['', '\n', 'a\n', '```\n열린 코드\n\n아래', '- a\n\n- b']) {
      expect(splitBlocks(text).map(block => text.slice(block.start, block.end)).join('\n')).toBe(text);
    }
  });
  it('finds the block that holds a position, including the end of a line', () => {
    const blocks = splitBlocks('하나\n둘');
    expect(blockAt(blocks, 2)?.start).toBe(0); expect(blockAt(blocks, 3)?.start).toBe(3);
  });
  it('maps rendered text back to the source while skipping markup', () => {
    expect(sourceOffset('**굵게** 글', '굵')).toBe(3);
    expect(sourceOffset('- [ ] 할 일', '할 ')).toBe(8);
    expect(sourceOffset('## 제목', '')).toBe(0);
  });
  it('joins an edited segment back and opens a new line at the end only once text arrives', () => {
    expect(joinSegment('a\nb\nc', { start: 2, tail: 2, lead: '' }, 'B!').body).toBe('a\nB!\nc');
    const range = endRange('끝');
    expect(joinSegment('끝', range, '').body).toBe('끝');
    const typed = joinSegment('끝', range, '새');
    expect(typed.body).toBe('끝\n새'); expect(typed.range).toEqual({ start: 2, tail: 0, lead: '' });
  });
  it('drops a range that no longer sits on line boundaries', () => {
    expect(rangeFits('a\nb', { start: 2, tail: 0, lead: '' })).toBe(true);
    expect(rangeFits('ab', { start: 1, tail: 0, lead: '' })).toBe(false);
  });
});
