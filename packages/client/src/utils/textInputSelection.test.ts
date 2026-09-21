import { describe, expect, it, vi } from 'vitest';
import { boundedTextSelection, replaceTextRange, restoreInputSelection } from './textInputSelection.js';

describe('selection offsets stay in DOM UTF-16 units', () => {
  it.each(['한글', '日本語', '中文', 'e\u0301', 'عربي', 'עברית', '👩🏽‍💻', '<>&"\'\\'])('preserves literal %s', (text) => {
    const old = `😀${text}끝`;
    const result = replaceTextRange(old, 2, 2 + text.length, text);
    expect(result.text).toBe(old);
    expect(result.caret).toBe(2 + text.length);
  });

  it('clamps stale ranges and orders reversed selections', () => {
    expect(boundedTextSelection('abc', 8, -2)).toEqual({ start: 0, end: 3 });
    expect(boundedTextSelection('abc', Infinity, 2)).toEqual({ start: 0, end: 2 });
    expect(replaceTextRange('abc', 9, 9, '中')).toEqual({ text: 'abc中', caret: 4 });
  });

  it('does not cut a surrogate pair in half at a stale caret or selection edge', () => {
    expect(replaceTextRange('a😀b', 2, 2, '!')).toEqual({ text: 'a😀!b', caret: 4 });
    expect(replaceTextRange('a😀b', 2, 3, '!')).toEqual({ text: 'a!b', caret: 2 });
    expect(replaceTextRange('a😀b', 1, 2, '!')).toEqual({ text: 'a!b', caret: 2 });
  });
});

describe('delayed caret writes cannot affect newer editing', () => {
  function fixture(): {
    field: HTMLTextAreaElement; document: { activeElement: unknown }; frame: () => void;
    focus: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn>;
  } {
    let frame: FrameRequestCallback | undefined;
    const document = { activeElement: null as unknown, defaultView: {
      requestAnimationFrame: (callback: FrameRequestCallback): number => { frame = callback; return 1; },
    } };
    const focus = vi.fn(); const select = vi.fn();
    // Minimal selection surface: no DOM implementation is needed to verify ownership/value/focus gates.
    const field = { value: 'a😀b', isConnected: true, ownerDocument: document, focus, setSelectionRange: select } as unknown as HTMLTextAreaElement;
    document.activeElement = field;
    return { field, document, frame: () => frame?.(0), focus, select };
  }

  it('restores a valid selection without redundantly focusing the composing surface', () => {
    const h = fixture();
    restoreInputSelection(h.field, h.field.value, 2, 2, () => true, true);
    h.frame(); expect(h.select).toHaveBeenCalledWith(3, 3); expect(h.focus).not.toHaveBeenCalled();
  });

  it.each(['changed value', 'changed owner', 'unmounted', 'another field focused'])(
    'ignores a stale frame after %s', (reason) => {
      const h = fixture(); let owned = true;
      restoreInputSelection(h.field, h.field.value, 4, 4, () => owned, true);
      if (reason === 'changed value') h.field.value = 'new';
      else if (reason === 'changed owner') owned = false;
      else if (reason === 'unmounted') Object.defineProperty(h.field, 'isConnected', { value: false });
      else h.document.activeElement = {};
      h.frame(); expect(h.select).not.toHaveBeenCalled(); expect(h.focus).not.toHaveBeenCalled();
    },
  );

  it('revalidates after synchronous focus handlers detach the field', () => {
    const h = fixture();
    h.document.activeElement = null;
    h.focus.mockImplementation(() => Object.defineProperty(h.field, 'isConnected', { value: false }));
    restoreInputSelection(h.field, h.field.value, 4, 4, () => true, true);
    h.frame(); expect(h.focus).toHaveBeenCalledTimes(1); expect(h.select).not.toHaveBeenCalled();
  });

  it('accepts inputs without selection APIs without throwing', () => {
    const h = fixture();
    h.select.mockImplementation(() => { throw new DOMException('unsupported', 'InvalidStateError'); });
    restoreInputSelection(h.field, h.field.value, 4, 4, () => true);
    expect(() => h.frame()).not.toThrow();
  });
});
