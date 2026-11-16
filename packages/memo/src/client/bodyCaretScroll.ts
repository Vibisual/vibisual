import type { BodyCaret } from './MemoBody.js';

export interface PendingBodyCaret extends BodyCaret { clickY: number | undefined }

export function focusBodyCaret(input: HTMLTextAreaElement, mirror: HTMLDivElement | null, caret: PendingBodyCaret): void {
  input.focus({ preventScroll: caret.clickY !== undefined });
  input.setSelectionRange(Math.min(caret.start, input.value.length), Math.min(caret.end, input.value.length));
  if (mirror && input.scrollHeight > input.clientHeight) revealBodyCaret(input, mirror, input.selectionEnd, caret.clickY);
}

/** textarea의 프로그램 선택은 커서를 스크롤하지 않으므로 같은 줄바꿈을 가진 겹침 층에서 높이를 구한다. */
function revealBodyCaret(input: HTMLTextAreaElement, mirror: HTMLDivElement, at: number, clickY: number | undefined): void {
  const doc = mirror.ownerDocument;
  const walker = doc.createTreeWalker(mirror, NodeFilter.SHOW_TEXT);
  let offset = at;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('[data-memo-insert-anchor]')) continue;
    const length = node.textContent?.length ?? 0;
    if (offset >= length) { offset -= length; continue; }
    const range = doc.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const caret = range.getBoundingClientRect();
    const bounds = mirror.getBoundingClientRect();
    const delta = clickY === undefined
      ? Math.min(0, caret.top - bounds.top) + Math.max(0, caret.bottom - bounds.bottom)
      : (caret.top + caret.bottom) / 2 - clickY;
    input.scrollTop += delta;
    mirror.scrollTop = input.scrollTop;
    return;
  }
}
