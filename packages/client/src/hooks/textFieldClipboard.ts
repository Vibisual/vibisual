import type { TextFieldElement } from './textFieldActions.js';

const TEXT_FORMATS = ['text/plain', 'text/html', 'text/markdown'] as const;
type TextFormat = typeof TEXT_FORMATS[number];
export type TextFieldClipboard = string | Partial<Record<TextFormat, string>>;

function acceptsRichPaste(el: TextFieldElement): boolean {
  return el.dataset?.richPaste === 'true';
}

async function readRichClipboard(clipboard: Clipboard): Promise<TextFieldClipboard> {
  try {
    const items = await clipboard.read();
    const item = items.find(entry => TEXT_FORMATS.some(format => entry.types.includes(format)));
    if (!item) return await clipboard.readText();
    const result: Partial<Record<TextFormat, string>> = {};
    await Promise.all(TEXT_FORMATS.filter(format => item.types.includes(format)).map(async format => {
      result[format] = await (await item.getType(format)).text();
    }));
    return result;
  } catch {
    // Rich clipboard permission can be denied while plain text is still available.
    return await clipboard.readText();
  }
}

export function readTextFieldClipboard(el: TextFieldElement): Promise<TextFieldClipboard> | undefined {
  const clipboard = navigator.clipboard;
  if (acceptsRichPaste(el) && typeof clipboard?.read === 'function') return readRichClipboard(clipboard);
  return clipboard?.readText?.();
}

export function plainClipboardText(clipboard: TextFieldClipboard): string {
  return typeof clipboard === 'string' ? clipboard : clipboard['text/plain'] ?? clipboard['text/markdown'] ?? '';
}

/** Editors opt in so menu paste uses the same conversion and undo path as keyboard paste. */
export function dispatchTextFieldPaste(el: TextFieldElement, clipboard: TextFieldClipboard): boolean {
  if (!acceptsRichPaste(el)) return false;
  let event: ClipboardEvent;
  try {
    const data = new DataTransfer();
    const formats = typeof clipboard === 'string' ? { 'text/plain': clipboard } : clipboard;
    for (const format of TEXT_FORMATS) {
      const text = formats[format];
      if (text !== undefined) data.setData(format, text);
    }
    event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
  } catch { return false; }
  return !el.dispatchEvent(event);
}
