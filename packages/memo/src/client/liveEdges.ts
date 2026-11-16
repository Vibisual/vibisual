import { blockAt, rangeOf, splitBlocks, type LiveRange } from './liveBlocks.js';
import type { BodyCaret, BodyEdge } from './MemoBody.js';

/** 원문 블록 가장자리의 이동·줄바꿈 삭제. */
export function liveEdges(body: string, range: LiveRange | null, activate: (range: LiveRange | null, at?: BodyCaret) => void, change: (body: string) => void): BodyEdge {
  return (key, column) => {
    if (!range) return false;
    if (key === 'escape') { activate(null); return true; }
    const end = body.length - range.tail;
    const blocks = splitBlocks(body);
    const prev = range.start > 0 ? blockAt(blocks, range.start - 1) : undefined;
    const next = range.tail > 0 && !range.lead ? blockAt(blocks, end + 1) : undefined;
    if ((key === 'up' || key === 'left') && prev) {
      const lineStart = Math.max(body.lastIndexOf('\n', prev.end - 1) + 1, prev.start);
      const at = key === 'left' ? prev.end : Math.min(lineStart + column, prev.end);
      activate(rangeOf(body, prev), { start: at - prev.start, end: at - prev.start }); return true;
    }
    if ((key === 'down' || key === 'right') && next) {
      const lineEnd = body.indexOf('\n', next.start);
      const at = key === 'right' ? next.start : Math.min(next.start + column, lineEnd < 0 || lineEnd > next.end ? next.end : lineEnd);
      activate(rangeOf(body, next), { start: at - next.start, end: at - next.start }); return true;
    }
    // 이웃 블록과 잇기: 사이의 줄바꿈 하나를 지운다(원문 칸에서 Backspace·Delete 가 하던 그대로).
    if (key === 'back' && prev) {
      if (range.lead) { activate(rangeOf(body, prev), { start: prev.end - prev.start, end: prev.end - prev.start }); return true; }
      change(body.slice(0, range.start - 1) + body.slice(range.start));
      const at = range.start - 1 - prev.start;
      activate({ start: prev.start, tail: range.tail, lead: '' }, { start: at, end: at }); return true;
    }
    if (key === 'del' && next) {
      change(body.slice(0, end) + body.slice(end + 1));
      const at = end - range.start;
      activate({ start: range.start, tail: body.length - next.end, lead: '' }, { start: at, end: at }); return true;
    }
    return false;
  };
}
