import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { composition, deferred, finishComposition, Input, setup, settleClipboard, Textarea } from './textFieldActions.testSupport.js';
import { createTextFieldActions, readFieldSelection, replaceFieldSelection, setFieldValue } from './textFieldActions.js';

let fixture: ReturnType<typeof setup>;
const selection = { start: 1, end: 2 };
beforeEach((): void => { fixture = setup(); });
afterEach((): void => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('text field clipboard actions', (): void => {
  it('pastes literal multilingual text and emits the input event', async (): Promise<void> => {
    const { field, doc } = fixture;
    const clip = '한글 日本語 हिन्दी مرحبا 👩🏽‍💻 e\u0301 <b>&';
    const input = vi.fn();
    field.addEventListener('input', input);
    vi.stubGlobal('navigator', { clipboard: { readText: (): Promise<string> => Promise.resolve(clip) } });
    createTextFieldActions(field.element, selection).paste();
    await settleClipboard();
    expect(field.value).toBe(`a${clip}c`);
    expect(input).toHaveBeenCalledTimes(1);
    doc.frame();
    expect(field.selectionStart).toBe(1 + clip.length);
  });

  it.each(['detached', 'value', 'focus', 'selection', 'readOnly', 'disabled'])(
    'rejects resolved and rejected clipboard reads after %s changes', async (change: string): Promise<void> => {
      for (const rejected of [false, true]) {
        const { field, doc } = setup();
        const read = deferred<string>();
        vi.stubGlobal('navigator', { clipboard: { readText: (): Promise<string> => read.promise } });
        createTextFieldActions(field.element, selection).paste();
        if (change === 'detached') field.isConnected = false;
        if (change === 'value') field.value = 'new typing';
        if (change === 'focus') new Input(doc).focus();
        if (change === 'selection') field.setSelectionRange(0, 0);
        if (change === 'readOnly') field.readOnly = true;
        if (change === 'disabled') field.disabled = true;
        const expected = field.value;
        if (rejected) read.reject(); else read.resolve('paste');
        await settleClipboard();
        expect(field.value).toBe(expected);
        expect(doc.execCommand).not.toHaveBeenCalled();
      }
    },
  );

  it('uses native paste only while the original field is current', async (): Promise<void> => {
    const { field, doc } = fixture;
    const read = deferred<string>();
    vi.stubGlobal('navigator', { clipboard: { readText: (): Promise<string> => read.promise } });
    createTextFieldActions(field.element, selection).paste();
    read.reject();
    await settleClipboard();
    expect(doc.execCommand).toHaveBeenCalledExactlyOnceWith('paste', false, undefined);
  });

  it('handles synchronous clipboard denial and missing execCommand', (): void => {
    const { field, doc } = fixture;
    vi.stubGlobal('navigator', { clipboard: { readText: (): never => { throw new Error('Denied'); } } });
    Object.defineProperty(doc, 'execCommand', { value: undefined });
    expect((): void => { createTextFieldActions(field.element, selection).paste(); }).not.toThrow();
    expect(field.value).toBe('abc');
  });

  it('does not delete a cut until its clipboard write succeeds', async (): Promise<void> => {
    const { field } = fixture;
    const write = deferred<void>();
    vi.stubGlobal('navigator', { clipboard: { writeText: (): Promise<void> => write.promise } });
    createTextFieldActions(field.element, selection).cut();
    expect(field.value).toBe('abc');
    write.resolve();
    await settleClipboard();
    expect(field.value).toBe('ac');
  });

  it('preserves cut text when clipboard write fails or the field changes', async (): Promise<void> => {
    for (const rejected of [false, true]) {
      const { field } = setup();
      const write = deferred<void>();
      vi.stubGlobal('navigator', { clipboard: { writeText: (): Promise<void> => write.promise } });
      createTextFieldActions(field.element, selection).cut();
      if (rejected) write.reject(); else { field.value = 'new typing'; write.resolve(); }
      await settleClipboard();
      expect(field.value).toBe(rejected ? 'abc' : 'new typing');
    }
  });

  it('waits for IME completion without moving its selection or overwriting a newer value', (): void => {
    const { field, doc } = fixture;
    composition.active.add(field);
    replaceFieldSelection(field.element, selection, 'paste');
    expect(field.focusCalls).toBe(0);
    expect(field.selectionCalls).toBe(0);
    expect(doc.execCommand).not.toHaveBeenCalled();
    field.value = '확정한 한글';
    finishComposition(field);
    expect(field.value).toBe('확정한 한글');
    expect(doc.execCommand).not.toHaveBeenCalled();
  });

  it('performs a deferred IME edit when its field and value remain current', (): void => {
    const { field } = fixture;
    composition.active.add(field);
    replaceFieldSelection(field.element, selection, 'X');
    finishComposition(field);
    expect(field.value).toBe('aXc');
  });

  it('does not leave half a surrogate in native selection or fallback replacement', (): void => {
    const { field } = fixture;
    field.value = 'a😀b';
    replaceFieldSelection(field.element, { start: 2, end: 3 }, 'X');
    expect(field.value).toBe('aXb');
  });

  it('does not restore a stale caret or steal focus during the next frame', (): void => {
    const { field, doc } = fixture;
    replaceFieldSelection(field.element, selection, 'X');
    const calls = field.selectionCalls;
    const other = new Input(doc);
    other.focus();
    doc.frame();
    expect(doc.activeElement).toBe(other);
    expect(field.selectionCalls).toBe(calls);
  });

  it('keeps read-only mutations disabled but copying available', (): void => {
    const { field, doc } = fixture;
    field.readOnly = true;
    const actions = createTextFieldActions(field.element, selection);
    actions.cut(); actions.paste();
    expect(doc.execCommand).not.toHaveBeenCalled();
    actions.copy();
    expect(doc.execCommand).toHaveBeenCalledWith('copy', false, undefined);
    expect(field.value).toBe('abc');
  });

  it('supports fields whose selection API is unavailable', (): void => {
    const { field, doc } = fixture;
    field.selectionStart = null;
    field.selectionEnd = null;
    const sel = readFieldSelection(field.element);
    expect((): void => { replaceFieldSelection(field.element, sel, 'X'); doc.frame(); }).not.toThrow();
    expect(field.value).toBe('abcX');
  });

  it('uses the native input and textarea setters without React instance trackers swallowing input', (): void => {
    for (const field of [fixture.field, new Textarea(fixture.doc)]) {
      const tracker = vi.fn();
      Object.defineProperty(field, 'value', { get: (): string => 'tracked', set: tracker });
      const input = vi.fn();
      field.addEventListener('input', input);
      setFieldValue(field.element, 'literal');
      expect(tracker).not.toHaveBeenCalled();
      expect(input).toHaveBeenCalledTimes(1);
    }
  });
});
