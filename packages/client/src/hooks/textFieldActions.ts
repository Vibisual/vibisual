import type { TextFieldMenuHandlers } from './textFieldContextMenu.js';
import { afterInputComposition, isInputComposing } from '../utils/inputComposition.js';
import { boundedTextSelection, replaceTextRange, restoreInputSelection } from '../utils/textInputSelection.js';

export type TextFieldElement = HTMLInputElement | HTMLTextAreaElement;

/** Selection is unavailable for input types such as email and number. */
export interface FieldSelection {
  start: number | null;
  end: number | null;
}

export function readFieldSelection(el: TextFieldElement): FieldSelection {
  try { return { start: el.selectionStart, end: el.selectionEnd }; }
  catch { return { start: null, end: null }; }
}

export function hasSelectionFrom(sel: FieldSelection): boolean {
  return sel.start === null || sel.end === null || sel.end > sel.start;
}

/** Never move the native IME's caret. Deferred callers restore it after composition. */
export function focusWithSelection(el: TextFieldElement, sel: FieldSelection): void {
  if (!el.isConnected || el.disabled || isInputComposing(el)) return;
  el.focus();
  if (!el.isConnected || el.ownerDocument.activeElement !== el || isInputComposing(el)) return;
  if (sel.start === null || sel.end === null) return;
  const range = boundedTextSelection(el.value, sel.start, sel.end);
  try { el.setSelectionRange(range.start, range.end); }
  catch { /* Unsupported input type: retain the browser's own caret. */ }
}

/** Bypass React's instance value tracker, then notify controlled and uncontrolled fields alike. */
export function setFieldValue(el: TextFieldElement, next: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, next);
  else el.value = next;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** execCommand may be missing, rejected or throw. These are ordinary fallback conditions. */
function exec(doc: Document, command: string, value?: string): boolean {
  try { return doc.execCommand?.(command, false, value) ?? false; }
  catch { return false; }
}

function sameSelection(el: TextFieldElement, sel: FieldSelection): boolean {
  const current = readFieldSelection(el);
  return current.start === sel.start && current.end === sel.end;
}

/** A menu action owns one field/value, never whichever field happens to be active later. */
function runWithSelection(
  el: TextFieldElement, sel: FieldSelection, value: string, mutating: boolean,
  action: (current: () => boolean, selection: FieldSelection) => void,
): void {
  const doc = el.ownerDocument;
  const focus = doc.activeElement;
  const deferred = isInputComposing(el);
  const valid = (): boolean => el.isConnected && el.ownerDocument === doc && el.value === value
    && !el.disabled && (!mutating || !el.readOnly);
  const run = (): void => {
    if (!valid() || isInputComposing(el)) return;
    if (deferred && doc.activeElement !== focus && doc.activeElement !== el) return;
    focusWithSelection(el, sel);
    if (!valid() || doc.activeElement !== el || isInputComposing(el)) return;
    const selection = readFieldSelection(el);
    action((): boolean => valid() && doc.activeElement === el && sameSelection(el, selection), selection);
  };
  if (deferred) afterInputComposition(el, run);
  else run();
}

/** Keep native undo when possible, with a literal UTF-16-safe fallback. */
export function replaceFieldSelection(el: TextFieldElement, sel: FieldSelection, insert: string): void {
  const value = el.value;
  runWithSelection(el, sel, value, true, (current, selection): void => {
    if (exec(el.ownerDocument, 'insertText', insert) || !current()) return;
    const next = replaceTextRange(value, selection.start ?? value.length, selection.end ?? value.length, insert);
    setFieldValue(el, next.text);
    const doc = el.ownerDocument;
    restoreInputSelection(el, next.text, next.caret, next.caret,
      (): boolean => el.ownerDocument === doc && doc.activeElement === el && !el.disabled && !el.readOnly);
  });
}

/** Clipboard promises may outlive the menu, the field, or the selected value. */
export function createTextFieldActions(el: TextFieldElement, sel: FieldSelection): TextFieldMenuHandlers {
  const value = el.value;
  const selectedText = (selection: FieldSelection): string | null => {
    if (selection.start === null || selection.end === null) return null;
    const range = boundedTextSelection(value, selection.start, selection.end);
    return value.slice(range.start, range.end);
  };
  const copyOrCut = (cut: boolean): void => {
    runWithSelection(el, sel, value, cut, (current, selection): void => {
      if (exec(el.ownerDocument, cut ? 'cut' : 'copy') || !current()) return;
      const text = selectedText(selection);
      if (!text) return;
      try {
        const write = navigator.clipboard?.writeText?.(text);
        // A refused copy must never delete the user's only copy of the selected text.
        if (write) void write.then((): void => {
          if (cut && current()) replaceFieldSelection(el, selection, '');
        }).catch((): void => { /* Clipboard permission denied: preserve the original text. */ });
      } catch { /* Clipboard unavailable: preserve the original text. */ }
    });
  };
  return {
    copy: (): void => { copyOrCut(false); },
    cut: (): void => { copyOrCut(true); },
    paste: (): void => {
      runWithSelection(el, sel, value, true, (current, selection): void => {
        const fallback = (): void => {
          // execCommand targets the active field; never run it after focus/value/selection changed.
          const apply = (): void => { if (current() && !isInputComposing(el)) exec(el.ownerDocument, 'paste'); };
          if (isInputComposing(el)) afterInputComposition(el, apply);
          else apply();
        };
        try {
          const read = navigator.clipboard?.readText?.();
          if (!read) { fallback(); return; }
          void read.then((clip): void => {
            if (clip && current()) replaceFieldSelection(el, selection, clip);
          }).catch(fallback);
        } catch { fallback(); }
      });
    },
    selectAll: (): void => {
      runWithSelection(el, sel, value, false, (): void => {
        try { el.select(); } catch { /* Unsupported selection API. */ }
      });
    },
  };
}
