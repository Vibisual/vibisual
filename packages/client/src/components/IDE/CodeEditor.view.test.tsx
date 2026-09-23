import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { CodeEditor } from './CodeEditor.js';

vi.mock('../../hooks/useCommand.js', () => ({ useCommand: () => undefined }));
vi.mock('./IDEContextMenu.js', () => ({ IDEContextMenu: () => null }));
afterEach(() => vi.unstubAllGlobals());

interface View { start: number; end: number; direction: 'forward' | 'backward' | 'none'; top: number; left: number; followToken?: number }
function mount(viewStateRef: { current: View | null }, text = 'first\nsecond\nthird', followToken?: number) {
  const field = { value: text, selectionStart: 0, selectionEnd: 0, selectionDirection: 'none',
    setSelectionRange(start: number, end: number, direction: string) { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; } };
  const scroll = { scrollTop: 0, scrollLeft: 0, clientHeight: 50, scrollTo: vi.fn() };
  const gutter = { scrollTop: 0 };
  let renderer!: ReturnType<typeof create>;
  const props = { text, language: 'text', readOnly: false, onChange: vi.fn(), onSave: vi.fn(), viewStateRef,
    ...(followToken === undefined ? {} : { followToken, followRange: { start: 3, end: 3 } }) };
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
  act(() => { renderer = create(createElement(CodeEditor, props), { createNodeMock(node) {
    if (node.type === 'textarea') return field;
    if (node.props.className?.includes('scrollbar-thin')) return scroll;
    return gutter;
  } }); });
  return { field, scroll, gutter, close: () => act(() => renderer.unmount()) };
}

it('returning from an image or another file restores that file selection and both scroll axes', () => {
  const viewStateRef = { current: null as View | null };
  const first = mount(viewStateRef);
  first.field.selectionStart = 6; first.field.selectionEnd = 12; first.field.selectionDirection = 'backward';
  first.scroll.scrollTop = 240; first.scroll.scrollLeft = 90;
  first.close();
  const other = mount({ current: null });
  expect(other.field.selectionStart).toBe(0); other.close();
  const returned = mount(viewStateRef);
  expect([returned.field.selectionStart, returned.field.selectionEnd, returned.field.selectionDirection]).toEqual([6, 12, 'backward']);
  expect([returned.scroll.scrollTop, returned.scroll.scrollLeft, returned.gutter.scrollTop]).toEqual([240, 90, 240]);
  returned.close();
});

it('a shorter reloaded file bounds the restored cursor to its current text', () => {
  const returned = mount({ current: { start: 100, end: 200, direction: 'forward', top: 0, left: 0 } }, 'short');
  expect([returned.field.selectionStart, returned.field.selectionEnd]).toEqual([5, 5]);
  returned.close();
});

it('returning to an old follow signal keeps manual position while a new signal still follows', () => {
  const ref = { current: { start: 0, end: 0, direction: 'none', top: 80, left: 0, followToken: 7 } as View | null };
  const old = mount(ref, undefined, 7); expect(old.scroll.scrollTo).not.toHaveBeenCalled(); old.close();
  const fresh = mount(ref, undefined, 8); expect(fresh.scroll.scrollTo).toHaveBeenCalledOnce(); fresh.close();
});
