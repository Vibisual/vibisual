import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeStreamClipboard } from './streamClipboard.js';

const payload = { text: '| A |\n| --- |\n| B |', html: '<table><tr><th>A</th></tr><tr><td>B</td></tr></table>' };
class Item { constructor(readonly data: Record<string, Blob>) {} }
afterEach(() => vi.unstubAllGlobals());

describe('stream clipboard transport', () => {
  it('writes Markdown and HTML together with the clipboard as receiver', async () => {
    const items: Item[] = []; const clipboard = {
      write(this: unknown, values: Item[]): Promise<void> { expect(this).toBe(clipboard); items.push(...values); return Promise.resolve(); },
      writeText: vi.fn(),
    };
    vi.stubGlobal('navigator', { clipboard }); vi.stubGlobal('ClipboardItem', Item);
    await writeStreamClipboard(payload);
    expect(await items[0]!.data['text/plain']!.text()).toBe(payload.text);
    expect(await items[0]!.data['text/html']!.text()).toBe(payload.html);
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });
  it.each(['constructor', 'write', 'rejection'])('falls back to Markdown when HTML support fails at %s', async (failure) => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText, write: failure === 'write' ? undefined : vi.fn(async () => { throw new Error('unsupported'); }) } });
    vi.stubGlobal('ClipboardItem', failure === 'constructor' ? undefined : Item);
    await writeStreamClipboard(payload);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(payload.text);
  });
  it('rejects when both representations are denied so the button cannot report success', async () => {
    vi.stubGlobal('navigator', { clipboard: { write: vi.fn(async () => { throw new Error('denied'); }), writeText: vi.fn(async () => { throw new Error('denied'); }) } });
    vi.stubGlobal('ClipboardItem', Item);
    await expect(writeStreamClipboard(payload)).rejects.toThrow('denied');
  });
  it('rejects when no clipboard surface exists', async () => {
    vi.stubGlobal('navigator', {});
    await expect(writeStreamClipboard(payload)).rejects.toThrow('Clipboard is unavailable');
  });
});
