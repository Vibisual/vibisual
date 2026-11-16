import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { CodeEditor } from './CodeEditor.js';
import { wrapsByDefault } from './codeLanguages.js';

vi.mock('../../hooks/useCommand.js', () => ({ useCommand: () => undefined }));
vi.mock('./IDEContextMenu.js', () => ({ IDEContextMenu: () => null }));
afterEach(() => vi.unstubAllGlobals());

/** 둘째 줄이 세 행으로 접힌 문서 — 줄 상자는 브라우저가 잰 값을 흉내 낸다. */
const ROWS = [
  { offsetTop: 8, offsetHeight: 19 },
  { offsetTop: 27, offsetHeight: 57 },
  { offsetTop: 84, offsetHeight: 19 },
];

function mount(wrap: boolean, follow = false) {
  const field = { value: 'a\nb\nc', selectionStart: 0, selectionEnd: 0, selectionDirection: 'none', setSelectionRange: vi.fn() };
  const scroll = { scrollTop: 0, scrollLeft: 0, clientHeight: 50, scrollTo: vi.fn() };
  const gutter = { scrollTop: 0 };
  let renderer!: ReturnType<typeof create>;
  const props = { text: field.value, language: 'markdown', wrap, readOnly: false, onChange: vi.fn(), onSave: vi.fn(),
    ...(follow ? { followToken: 1, followRange: { start: 3, end: 3 } } : {}) };
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
  act(() => { renderer = create(createElement(CodeEditor, props), { createNodeMock(node) {
    if (node.type === 'textarea') return field;
    if (node.type === 'pre') return { children: ROWS };
    if (node.props.className?.includes('scrollbar-thin')) return scroll;
    return gutter;
  } }); });
  const gutterHeights = (): unknown[] => renderer.root
    .findAll((n) => n.type === 'div' && typeof n.props.onContextMenu === 'function')
    .map((n) => n.props.style?.height);
  return { renderer, scroll, gutterHeights, close: () => act(() => renderer.unmount()) };
}

it('only document languages fold long lines by default', () => {
  expect(wrapsByDefault('markdown')).toBe(true);
  expect(['ts', 'json', 'python', 'plain', 'unknown-id'].map(wrapsByDefault)).toEqual([false, false, false, false, false]);
});

it('a folded document wraps both layers the same way and keeps the scroller from growing sideways', () => {
  const view = mount(true);
  const area = view.renderer.root.findByType('textarea');
  const pre = view.renderer.root.findByType('pre');
  expect(area.props.wrap).toBe('soft');
  for (const layer of [area, pre]) {
    expect(layer.props.className).toContain('whitespace-pre-wrap');
    expect(layer.props.className).not.toMatch(/whitespace-pre(\s|$)/);
  }
  expect(pre.parent!.props.className).not.toContain('w-max');
  view.close();
});

it('line numbers take the measured height of each folded line', () => {
  const folded = mount(true);
  expect(folded.gutterHeights()).toEqual([19, 57, 19]);
  folded.close();
  const flat = mount(false);
  expect(flat.gutterHeights()).toEqual([undefined, undefined, undefined]);
  expect(flat.renderer.root.findByType('textarea').props.wrap).toBe('off');
  flat.close();
});

it('following an edit scrolls to where the folded line really is', () => {
  const folded = mount(true, true);
  expect(folded.scroll.scrollTo).toHaveBeenCalledWith({ top: 36, behavior: 'smooth' });
  folded.close();
  const flat = mount(false, true);
  expect(flat.scroll.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  flat.close();
});
