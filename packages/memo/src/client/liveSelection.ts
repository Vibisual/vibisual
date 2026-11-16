import { blockAt, sourceOffset, splitBlocks } from './liveBlocks.js';

/** 서식 화면에서 고른 글자를 원문 범위로 옮긴다. 다른 입력 칸·창의 선택은 건드리지 않는다. */
export function liveSelection(root: HTMLElement, body: string): { start: number; end: number } | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const picked = selection.getRangeAt(0);
  if (!root.contains(picked.startContainer) || !root.contains(picked.endContainer)) return null;
  const blocks = splitBlocks(body);
  const offset = (node: Node, at: number, ending = false): number | null => {
    const element = node.nodeType === 1 ? node as Element : node.parentElement;
    const holder = element?.closest<HTMLElement>('[data-block]');
    if (!holder) return null;
    const id = holder.dataset['block'] ?? '';
    const start = id.startsWith('a') ? body.length - Number(id.slice(1)) : Number(id.slice(1));
    const block = blockAt(blocks, start);
    if (!block) return null;
    const before = root.ownerDocument.createRange();
    before.setStart(holder, 0); before.setEnd(node, at);
    const shown = before.toString();
    // 블록 전체를 지울 때 닫는 서식 기호만 남아 구분선 등으로 바뀌지 않게 한다.
    if (ending && shown === holder.textContent) return block.end;
    return start + sourceOffset(body.slice(start, block.end), shown);
  };
  const start = offset(picked.startContainer, picked.startOffset);
  const end = offset(picked.endContainer, picked.endOffset, true);
  return start !== null && end !== null && end > start ? { start, end } : null;
}
