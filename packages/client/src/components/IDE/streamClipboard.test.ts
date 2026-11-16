import { describe, expect, it, vi } from 'vitest';
import { asElement, clipboardDocument, selection, tag } from './streamClipboardFixture.js';
import { copyStreamSelection, streamElementClipboard, streamSelectionClipboard } from './streamClipboard.js';

function fixture() {
  const table = tag('table', tag('thead', tag('tr', tag('th', 'Name'), tag('th', 'Status'))),
    tag('tbody', tag('tr', tag('td', tag('strong', 'Alpha')), tag('td', 'Ready')), tag('tr', tag('td', 'Beta'), tag('td', 'Later'))));
  const root = tag('div', tag('p', 'Before paragraph'), table, tag('p', 'After paragraph'));
  return { root, table, cells: table.querySelectorAll('th, td') };
}

describe('stream table clipboard', () => {
  it('copies full table formatting and keeps path labels while dropping copy controls and private DOM attributes', () => {
    const button = tag('button', 'src/app.ts'); const controls = tag('div', tag('button', 'Copy'));
    controls.setAttribute('data-clipboard-ignore', '');
    const table = tag('table', tag('tr', tag('th', 'Path'), tag('th', 'Count')), tag('tr', tag('td', tag('code', button)), tag('td', '')));
    table.setAttribute('data-item-id', 'private'); table.querySelector('th')!.setAttribute('style', 'text-align: right');
    const copied = streamElementClipboard(asElement(tag('div', controls, table)));
    expect(copied.text).toBe('| Path | Count |\n| ---: | --- |\n| `src/app.ts` |  |');
    expect(copied.html).not.toMatch(/Copy|button|data-item-id|style=/);
    expect(copied.html).toContain('align="right"');
  });

  it('keeps table structure when the selection starts inside its header and ends inside a body cell', () => {
    const { root, cells } = fixture();
    const selected = selection(root, cells[1]!.childNodes[0]!, 2, cells[3]!.childNodes[0]!, 3);
    const copied = streamSelectionClipboard(asElement(root), selected)!;
    expect(copied.text).toBe('|  | atus |\n| --- | --- |\n| **Alpha** | Rea |');
    expect(copied.html).toContain('<table>');
    expect(copied.html).not.toMatch(/Before|After|Beta|Later|Name|Ready/);
  });

  it('preserves selected surrounding paragraphs while excluding their unselected prefixes and suffixes', () => {
    const { root } = fixture();
    const first = root.childNodes[0]!.childNodes[0]!; const last = root.childNodes[2]!.childNodes[0]!;
    const copied = streamSelectionClipboard(asElement(root), selection(root, first, 7, last, 5))!;
    expect(copied.text).toBe('paragraph\n\n| Name | Status |\n| --- | --- |\n| **Alpha** | Ready |\n| Beta | Later |\n\nAfter');
  });

  it('leaves a word inside one cell and selections outside the owning pane to native copying', () => {
    const { root, table, cells } = fixture();
    const word = cells[3]!.childNodes[0]!;
    expect(streamSelectionClipboard(asElement(root), selection(root, word, 1, word, 3))).toBeNull();
    expect(streamSelectionClipboard(asElement(table), selection(root, root.childNodes[0]!.childNodes[0]!, 0, word, 3))).toBeNull();
    expect(streamSelectionClipboard(asElement(root), null)).toBeNull();
  });

  it('writes both formats for keyboard copy without requiring the asynchronous clipboard API', () => {
    const { root, cells } = fixture();
    const selected = selection(root, cells[0]!.childNodes[0]!, 0, cells[3]!.childNodes[0]!, 5);
    const getSelection = vi.spyOn(clipboardDocument, 'getSelection').mockReturnValue(selected);
    const setData = vi.fn(); const preventDefault = vi.fn();
    copyStreamSelection({ currentTarget: asElement(root), clipboardData: { setData } as unknown as DataTransfer, preventDefault });
    expect(setData.mock.calls.map(call => call[0])).toEqual(['text/plain', 'text/html']);
    expect(setData.mock.calls[0]?.[1]).toContain('| **Alpha** | Ready |');
    expect(preventDefault).toHaveBeenCalledOnce(); getSelection.mockRestore();
  });
});
