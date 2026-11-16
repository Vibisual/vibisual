import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { composition, deferred, finishComposition, Input, setup } from './textFieldActions.testSupport.js';
import { createTextFieldActions } from './textFieldActions.js';

class ClipboardData {
  private values = new Map<string, string>();
  setData(format: string, text: string): void { this.values.set(format, text); }
  getData(format: string): string { return this.values.get(format) ?? ''; }
}
class PasteEvent extends Event {
  clipboardData: ClipboardData;
  constructor(type: string, init: EventInit & { clipboardData: ClipboardData }) {
    super(type, init); this.clipboardData = init.clipboardData;
  }
}

let fixture: ReturnType<typeof setup>;
const selection = { start: 1, end: 2 };
const table = '<table><tr><th>항목</th></tr><tr><td>내용</td></tr></table>';
const item = { types: ['text/html', 'text/plain'], getType: async (type: string): Promise<Blob> => new Blob([type === 'text/html' ? table : '항목\n내용']) };
beforeEach((): void => {
  fixture = setup();
  Object.defineProperty(fixture.field, 'dataset', { value: { richPaste: 'true' } });
  vi.stubGlobal('DataTransfer', ClipboardData);
  vi.stubGlobal('ClipboardEvent', PasteEvent);
});
afterEach((): void => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('rich text field menu paste', (): void => {
  it('sends both formats through the editor paste handler without a second insertion', async (): Promise<void> => {
    const { field, doc } = fixture;
    const paste = vi.fn((event: Event): void => { event.preventDefault(); });
    field.addEventListener('paste', paste);
    vi.stubGlobal('navigator', { clipboard: { read: async () => [item] } });
    createTextFieldActions(field.element, selection).paste();
    await vi.waitFor((): void => { expect(paste).toHaveBeenCalledTimes(1); });
    const event = paste.mock.calls[0]?.[0];
    expect(event).toBeInstanceOf(PasteEvent);
    if (!(event instanceof PasteEvent)) throw new Error('Missing clipboard event');
    expect(event.clipboardData.getData('text/html')).toBe(table);
    expect(event.clipboardData.getData('text/plain')).toBe('항목\n내용');
    expect(field.value).toBe('abc');
    expect(doc.execCommand).not.toHaveBeenCalled();
  });

  it('falls back to a literal insertion when the editor leaves a paste unhandled', async (): Promise<void> => {
    const { field } = fixture;
    const paste = vi.fn(); field.addEventListener('paste', paste);
    vi.stubGlobal('navigator', { clipboard: { read: async () => [item] } });
    createTextFieldActions(field.element, selection).paste();
    await vi.waitFor((): void => { expect(field.value).toBe('a항목\n내용c'); });
    expect(paste).toHaveBeenCalledTimes(1);
  });

  it('still invokes the editor when only plain clipboard access succeeds', async (): Promise<void> => {
    const { field } = fixture;
    const paste = vi.fn((event: Event): void => event.preventDefault()); field.addEventListener('paste', paste);
    const plain = '| A |\n| --- |\n| B |';
    vi.stubGlobal('navigator', { clipboard: { read: async (): Promise<never> => { throw new Error('Denied'); }, readText: async () => plain } });
    createTextFieldActions(field.element, selection).paste();
    await vi.waitFor((): void => { expect(paste).toHaveBeenCalledTimes(1); });
    const event = paste.mock.calls[0]?.[0];
    expect(event instanceof PasteEvent && event.clipboardData.getData('text/plain')).toBe(plain);
    expect(field.value).toBe('abc');
  });

  it.each(['detached', 'value', 'focus', 'selection', 'readOnly', 'disabled'])(
    'discards a rich clipboard response after %s changes', async (change: string): Promise<void> => {
      const { field, doc } = fixture;
      const result = deferred<typeof item[]>();
      const paste = vi.fn(); field.addEventListener('paste', paste);
      const readText = vi.fn(async () => 'fallback');
      vi.stubGlobal('navigator', { clipboard: { read: () => result.promise, readText } });
      createTextFieldActions(field.element, selection).paste();
      if (change === 'detached') field.isConnected = false;
      if (change === 'value') field.value = 'new typing';
      if (change === 'focus') new Input(doc).focus();
      if (change === 'selection') field.setSelectionRange(0, 0);
      if (change === 'readOnly') field.readOnly = true;
      if (change === 'disabled') field.disabled = true;
      const expected = field.value;
      result.resolve([]);
      await vi.waitFor((): void => { expect(readText).toHaveBeenCalledTimes(1); });
      expect(field.value).toBe(expected);
      expect(paste).not.toHaveBeenCalled();
      expect(doc.execCommand).not.toHaveBeenCalled();
    },
  );

  it('waits for an IME composition before handing the paste to the editor', async (): Promise<void> => {
    const { field } = fixture;
    const result = deferred<string>();
    const paste = vi.fn((event: Event): void => event.preventDefault()); field.addEventListener('paste', paste);
    vi.stubGlobal('navigator', { clipboard: { readText: () => result.promise } });
    createTextFieldActions(field.element, selection).paste();
    composition.active.add(field);
    result.resolve('표');
    await vi.waitFor((): void => { expect(composition.pending).toHaveLength(1); });
    expect(paste).not.toHaveBeenCalled();
    finishComposition(field);
    expect(paste).toHaveBeenCalledTimes(1);
  });
});
