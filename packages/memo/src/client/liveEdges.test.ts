import { describe, expect, it, vi } from 'vitest';
import { liveEdges } from './liveEdges.js';
import { endRange } from './liveBlocks.js';

describe('memo block boundaries', () => {
  it('backs out of an unwritten trailing line without deleting the previous character', () => {
    const activate = vi.fn(); const change = vi.fn(); const text = '앞\n마지막';
    expect(liveEdges(text, endRange(text), activate, change)('back', 0)).toBe(true);
    expect(change).not.toHaveBeenCalled();
    expect(activate).toHaveBeenCalledWith({ start: 2, tail: 0, lead: '' }, { start: 3, end: 3 });
  });
  it('deletes only the real newline at the end of a block', () => {
    const activate = vi.fn(); const change = vi.fn();
    expect(liveEdges('앞\n뒤', { start: 0, tail: 2, lead: '' }, activate, change)('del', 1)).toBe(true);
    expect(change).toHaveBeenCalledWith('앞뒤');
    expect(activate).toHaveBeenCalledWith({ start: 0, tail: 0, lead: '' }, { start: 1, end: 1 });
  });
  it('leaves Delete at the end of the document alone', () => {
    const activate = vi.fn(); const change = vi.fn();
    expect(liveEdges('끝', { start: 0, tail: 0, lead: '' }, activate, change)('del', 1)).toBe(false);
    expect(change).not.toHaveBeenCalled(); expect(activate).not.toHaveBeenCalled();
  });
});
