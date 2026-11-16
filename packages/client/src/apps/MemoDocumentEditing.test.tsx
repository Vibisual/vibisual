import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoShell } from '@vibisual/memo/client';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let view: ReactTestRenderer | undefined;
const Reader = (_props: { text: string }): null => null;
const host = {
  Scroll: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  Markdown: Reader, useLifecycle: vi.fn(), openContext: vi.fn(), contexts: () => [], useAIEnabled: () => true,
};
const fetcher = vi.fn(async (): Promise<Response> => new Response(JSON.stringify({ notes: [], settings: { aiEnabled: true } })));
const caret = { start: 0, end: 0 };
const field = {
  get value(): string { return input().props.value as string; },
  get selectionStart(): number { return caret.start; }, get selectionEnd(): number { return caret.end; },
  focus: vi.fn(),
  setSelectionRange: (start: number, end: number): void => { caret.start = start; caret.end = end; },
};
const input = (): ReactTestInstance => view!.root.findAllByType('textarea')[0]!;
const rendered = (): string[] => view!.root.findAll(node => typeof node.props['data-block'] === 'string')
  .flatMap(holder => holder.findAllByType(Reader).map(node => node.props.text as string));
beforeEach(() => {
  vi.useFakeTimers(); fetcher.mockClear(); field.focus.mockClear();
  vi.stubGlobal('fetch', fetcher); vi.stubGlobal('document', { activeElement: null }); vi.stubGlobal('Element', class {});
});
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });
async function mount(): Promise<void> {
  await act(async () => { view = create(createElement(MemoShell, { params: { projectId: '/project' }, host }), { createNodeMock: node => node.type === 'textarea' ? field : null }); });
}
function type(value: string, start = value.length, end = start): void {
  caret.start = start; caret.end = end;
  act(() => input().props.onChange({ target: { value, selectionStart: start, selectionEnd: end } }));
}
function press(key: string, extra: Record<string, unknown> = {}): ReturnType<typeof vi.fn> {
  const preventDefault = vi.fn();
  act(() => input().props.onKeyDown({ key, code: key === 'a' ? 'KeyA' : '', nativeEvent: {},
    ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
    currentTarget: { value: field.value, selectionStart: caret.start, selectionEnd: caret.end },
    preventDefault, stopPropagation: vi.fn(), ...extra }));
  return preventDefault;
}

describe('memo document selection and deletion', () => {
  it.each(['ctrlKey', 'metaKey'])('selects the entire memo on the first %s+A and keeps replacement and undo in the document', async modifier => {
    await mount(); const original = '# 제목\n\n첫 문단\n둘째 문단'; type(original);
    expect(field.value).toBe('둘째 문단');
    expect(press('a', { [modifier]: true })).toHaveBeenCalled();
    expect(field.value).toBe(original); expect(caret).toEqual({ start: 0, end: original.length }); expect(rendered()).toEqual([]);
    // 브라우저의 선택 삭제·붙여넣기·실행취소가 보내는 input 결과다.
    type('', 0); expect(field.value).toBe(''); expect(rendered()).toEqual([]);
    type('바꾼 첫 줄\n바꾼 둘째 줄'); expect(field.value).toBe('바꾼 첫 줄\n바꾼 둘째 줄');
    type(original); expect(field.value).toBe(original); expect(rendered()).toEqual([]);
    expect(caret.start).toBe(caret.end);
    expect(press('Escape')).toHaveBeenCalled();
    expect(view!.root.findAll(node => node.type === 'textarea' && node.props['aria-label'] === 'memo.body')).toHaveLength(0);
    expect(rendered()).toEqual(['# 제목', '첫 문단', '둘째 문단']);
  });
  it('does not expand the document during composition or AltGr input', async () => {
    await mount(); type('앞\n뒤');
    expect(press('a', { ctrlKey: true, nativeEvent: { isComposing: true } })).not.toHaveBeenCalled();
    expect(press('a', { ctrlKey: true, altKey: true })).not.toHaveBeenCalled(); expect(field.value).toBe('뒤');
  });
  it('joins the following block with Delete even while the slash menu is open', async () => {
    await mount(); type('/\n다음'); press('ArrowUp');
    expect(field.value).toBe('/'); caret.start = caret.end = 1;
    expect(press('Delete')).toHaveBeenCalled(); expect(field.value).toBe('/다음'); expect(rendered()).toEqual([]);
  });
  it('deletes blank separators one at a time and preserves surrounding text', async () => {
    await mount(); type('앞\n\n뒤'); press('ArrowUp'); press('ArrowUp');
    expect(field.value).toBe('앞'); caret.start = caret.end = 1;
    press('Delete'); expect(field.value).toBe('앞'); expect(rendered()).toEqual(['뒤']);
    press('Delete'); expect(field.value).toBe('앞뒤'); expect(rendered()).toEqual([]);
  });
  it('can select all from the formatted body without changing title or search fields', async () => {
    await mount(); type('앞\n뒤'); press('Escape');
    const preview = view!.root.findAll(node => node.type === 'div' && node.props.tabIndex === 0)[0]!;
    act(() => preview.props.onKeyDown({ key: 'a', code: 'KeyA', ctrlKey: true, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() }));
    expect(field.value).toBe('앞\n뒤'); expect(caret).toEqual({ start: 0, end: 3 });
  });
  it('focuses a clicked blank line without scrolling the memo', async () => {
    await mount(); type('앞\n\n뒤'); press('Escape');
    const preview = view!.root.findAll(node => node.type === 'div' && node.props.tabIndex === 0)[0]!;
    const holder = { dataset: { block: 'b2' }, ownerDocument: {} };
    const target = { closest: (selector: string) => selector === '[data-block]' ? holder : null };
    act(() => preview.props.onClick({ target, clientX: 20, clientY: 100 }));
    expect(field.value).toBe('');
    expect(field.focus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(rendered()).toEqual(['앞', '뒤']);
  });
  it('starts the first library request without waiting for the autosave debounce', async () => {
    await mount(); expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('applies a formatted selection deletion through the full-document editor', async () => {
    await mount(); type('앞 문단\n뒤 문단'); press('Escape');
    const live = view!.root.findAll(node => typeof node.props.deleteSelection === 'function')[0]!;
    act(() => live.props.deleteSelection(2, 8));
    expect(field.value).toBe('앞 단'); expect(caret).toEqual({ start: 2, end: 2 });
    type('앞 문단\n뒤 문단'); expect(field.value).toBe('앞 문단\n뒤 문단'); expect(rendered()).toEqual([]);
  });
});
