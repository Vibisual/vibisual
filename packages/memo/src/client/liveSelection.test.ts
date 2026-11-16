import { describe, expect, it } from 'vitest';
import { liveSelection } from './liveSelection.js';

function fixture(body: string, first: string, last: string, shownStart: string, shownEnd: string, fullText?: string) {
  const makeNode = (id: string, shown: string) => ({ nodeType: 3, shown, parentElement: { closest: () => ({ dataset: { block: id }, textContent: fullText }) } });
  const start = makeNode(first, shownStart); const end = makeNode(last, shownEnd);
  const picked = { startContainer: start, endContainer: end, startOffset: 0, endOffset: 0 };
  const selection = { isCollapsed: false, rangeCount: 1, getRangeAt: () => picked };
  const root = {
    contains: (node: unknown): boolean => node === start || node === end,
    ownerDocument: {
      getSelection: () => selection,
      createRange: () => {
        let shown = '';
        return { setStart: () => undefined, setEnd: (node: { shown: string }) => { shown = node.shown; }, toString: () => shown };
      },
    },
  };
  return { root, selection, read: () => liveSelection(root as unknown as HTMLElement, body) };
}
describe('formatted memo selections', () => {
  it('maps a selection across paragraphs into the complete source', () => {
    const sample = fixture('앞 문단\n뒤 문단', 'b0', 'b5', '앞 ', '뒤 문');
    expect(sample.read()).toEqual({ start: 2, end: 8 });
  });
  it('resolves trailing block identities and Markdown markers', () => {
    expect(fixture('# 제목\n**굵게** 끝', 'b0', 'a8', '제', '굵게').read()).toEqual({ start: 3, end: 9 });
  });
  it('ignores collapsed and cross-surface selections', () => {
    const sample = fixture('앞\n뒤', 'b0', 'b2', '', '뒤');
    sample.selection.isCollapsed = true; expect(sample.read()).toBeNull();
    sample.selection.isCollapsed = false; sample.root.contains = () => false; expect(sample.read()).toBeNull();
  });
  it('includes closing Markdown markers when the whole visible block is selected', () => {
    expect(fixture('**굵게**', 'b0', 'b0', '', '굵게', '굵게').read()).toEqual({ start: 0, end: 6 });
  });
});
