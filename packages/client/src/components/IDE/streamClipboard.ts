import { clipboardElementToMarkdown } from '@vibisual/memo';

export interface StreamClipboard { text: string; html?: string }

const OMIT = '[data-clipboard-ignore], .select-none, [aria-hidden="true"], script, style, input, textarea, select';
const ATTRIBUTES = new Set(['href', 'align', 'colspan', 'rowspan', 'start']);

function cleanFragment(root: HTMLElement): void {
  root.querySelectorAll(OMIT).forEach(node => node.remove());
  root.querySelectorAll('button').forEach(button => button.replaceWith(...button.childNodes));
  root.querySelectorAll('*').forEach(element => {
    const alignment = (element as HTMLElement).style?.textAlign ?? '';
    for (const attribute of Array.from(element.attributes)) {
      if (!ATTRIBUTES.has(attribute.name)) element.removeAttribute(attribute.name);
    }
    if (/^(left|center|right)$/.test(alignment) && /^(TD|TH)$/.test(element.tagName)) element.setAttribute('align', alignment);
  });
}

export function streamElementClipboard(element: Element): StreamClipboard {
  const wrapper = element.ownerDocument.createElement('div');
  wrapper.append(element.cloneNode(true));
  cleanFragment(wrapper);
  return { text: clipboardElementToMarkdown(wrapper), html: wrapper.innerHTML };
}

/** Range.cloneContents drops table ancestors and leading cells when a selection starts inside a row. */
function cloneSelected(node: Node, range: Range): Node | null {
  if (!range.intersectsNode(node)) return null;
  if (node.nodeType === 3) {
    const value = node.textContent ?? '';
    const start = range.startContainer === node ? range.startOffset : 0;
    const end = range.endContainer === node ? range.endOffset : value.length;
    return start < end ? node.ownerDocument!.createTextNode(value.slice(start, end)) : null;
  }
  const copy = node.cloneNode(false);
  for (const child of Array.from(node.childNodes)) {
    const selected = cloneSelected(child, range);
    if (selected) copy.appendChild(selected);
    // Keep unselected cells empty so selected text stays in its original column.
    else if (node.nodeName === 'TR' && /^(TD|TH)$/.test(child.nodeName)) copy.appendChild(child.cloneNode(false));
  }
  return copy;
}

export function streamSelectionClipboard(root: HTMLElement, selection: Selection | null): StreamClipboard | null {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const wrapper = root.ownerDocument.createElement('div');
  try {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      const range = selection.getRangeAt(index);
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
      const ancestor = range.commonAncestorContainer;
      const element = ancestor.nodeType === 1 ? ancestor as Element : ancestor.parentElement;
      if (!element || element.closest('textarea, input, [contenteditable="true"], td, th')) continue;
      const base = element.closest('table') ?? element;
      const fragment = cloneSelected(base, range);
      if (fragment) wrapper.append(fragment);
    }
    cleanFragment(wrapper);
    if (!wrapper.querySelector('table')) return null;
    return { text: clipboardElementToMarkdown(wrapper), html: wrapper.innerHTML };
  } catch {
    // A streamed item can disappear between selection and copy; native copy remains available.
    return null;
  }
}

export function copyStreamSelection(event: { currentTarget: HTMLElement; clipboardData: DataTransfer; preventDefault: () => void }): void {
  const payload = streamSelectionClipboard(event.currentTarget, event.currentTarget.ownerDocument.getSelection());
  if (!payload) return;
  event.clipboardData.setData('text/plain', payload.text);
  if (payload.html) event.clipboardData.setData('text/html', payload.html);
  event.preventDefault();
}

export async function writeStreamClipboard(payload: StreamClipboard): Promise<void> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (payload.html && clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      await clipboard.write([new ClipboardItem({
        'text/plain': new Blob([payload.text], { type: 'text/plain' }),
        'text/html': new Blob([payload.html], { type: 'text/html' }),
      })]);
      return;
    } catch {
      // Some clipboard surfaces accept text but reject HTML.
    }
  }
  if (!clipboard?.writeText) throw new Error('Clipboard is unavailable');
  return clipboard.writeText(payload.text);
}
