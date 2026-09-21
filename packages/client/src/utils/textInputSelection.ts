import { isInputComposing } from './inputComposition.js';

/** DOM selection offsets are UTF-16, not code point/grapheme counts. Never normalize user text. */
export function boundedTextSelection(text: string, start: number, end = start): { start: number; end: number } {
  const bound = (n: number): number => Math.max(0, Math.min(text.length, Number.isFinite(n) ? Math.trunc(n) : 0));
  let a = Math.min(bound(start), bound(end));
  let b = Math.max(bound(start), bound(end));
  const splitsPair = (at: number): boolean => at > 0 && at < text.length
    && text.charCodeAt(at - 1) >= 0xd800 && text.charCodeAt(at - 1) <= 0xdbff
    && text.charCodeAt(at) >= 0xdc00 && text.charCodeAt(at) <= 0xdfff;
  if (a === b) { if (splitsPair(a)) a = b = a + 1; }
  else { if (splitsPair(a)) a -= 1; if (splitsPair(b)) b += 1; }
  return { start: a, end: b };
}

export function replaceTextRange(text: string, start: number, end: number, insert: string): { text: string; caret: number } {
  const range = boundedTextSelection(text, start, end);
  return { text: text.slice(0, range.start) + insert + text.slice(range.end), caret: range.start + insert.length };
}

/** A delayed selection may only touch the same value/owner and must not steal another field's focus. */
export function restoreInputSelection(
  field: HTMLTextAreaElement | HTMLInputElement,
  value: string,
  start: number,
  end: number,
  stillOwned: () => boolean,
  focus = false,
): void {
  const previousFocus = field.ownerDocument.activeElement;
  field.ownerDocument.defaultView?.requestAnimationFrame(() => {
    if (!field.isConnected || !stillOwned() || field.value !== value || isInputComposing(field)) return;
    const active = field.ownerDocument.activeElement;
    if (active !== previousFocus && active !== field) return;
    const selection = boundedTextSelection(value, start, end);
    if (focus && active !== field) field.focus();
    // Focus handlers can unmount/replace the field or start another composition synchronously.
    if (!field.isConnected || !stillOwned() || field.value !== value || isInputComposing(field)) return;
    try { field.setSelectionRange(selection.start, selection.end); } catch {
      // Email/number inputs do not expose selection APIs; their native caret remains in charge.
    }
  });
}
