import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoShell } from '@vibisual/memo/client';
import { MemoMarkdown } from './MemoMarkdown.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let view: ReactTestRenderer | undefined;
const Reader = (_props: { text: string; onToggleTask?: (offset: number) => void }): null => null;
const host = {
  Scroll: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  useLifecycle: vi.fn(), openContext: vi.fn(), contexts: () => [], useAIEnabled: () => true,
};
const caret = { start: 0, end: 0 };
const input = (): ReactTestInstance => view!.root.findAll(node => node.type === 'textarea' && node.props['aria-label'] === 'memo.body')[0]!;
const value = (): string => input().props.value as string;
const field = { get value(): string { return value(); }, get selectionStart(): number { return caret.start; }, get selectionEnd(): number { return caret.end; },
  focus: (): void => undefined, setSelectionRange: (start: number, end: number): void => { caret.start = start; caret.end = end; } };
beforeEach(() => {
  vi.useFakeTimers(); caret.start = 0; caret.end = 0;
  vi.stubGlobal('document', { activeElement: null });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ notes: [], settings: { aiEnabled: true } }))));
});
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

async function mount(live = false): Promise<void> {
  await act(async () => { view = create(createElement(MemoShell, { params: { projectId: '/project' }, host: live ? { ...host, Markdown: Reader } : host }),
    { createNodeMock: element => element.type === 'textarea' ? field : null }); });
}
function type(text: string): void {
  caret.start = text.length; caret.end = text.length;
  act(() => input().props.onChange({ target: { value: text, selectionStart: caret.start, selectionEnd: caret.end } }));
}
function paste(formats: Record<string, string>, at = value().length, end = at): { preventDefault: ReturnType<typeof vi.fn> } {
  const event = { clipboardData: { getData: (format: string) => formats[format] ?? '' }, currentTarget: { value: value(), selectionStart: at, selectionEnd: end }, preventDefault: vi.fn() };
  act(() => input().props.onPaste(event)); return event;
}
const TABLE = '| Item | State |\n| :--- | ---: |\n| **one** | `done` |';

describe('memo table clipboard', () => {
  it('keeps a copied Markdown table distinct from existing text', async () => {
    await mount(); type('beforeafter');
    expect(input().props['data-rich-paste']).toBe('true');
    expect(paste({ 'text/plain': TABLE }, 6).preventDefault).toHaveBeenCalledOnce();
    expect(value()).toBe(`before\n\n${TABLE}\n\nafter`);
  });
  it('uses the Markdown clipboard representation without flattening formatting', async () => {
    await mount();
    paste({ 'text/plain': 'Item State one done', 'text/markdown': TABLE });
    expect(value()).toBe(`${TABLE}\n`);
  });
  it('leaves plain text, file-only data and composition to their existing paths', async () => {
    await mount(); type('글');
    expect(paste({ 'text/plain': 'ordinary' }).preventDefault).not.toHaveBeenCalled();
    expect(paste({}).preventDefault).not.toHaveBeenCalled();
    act(() => input().props.onCompositionStart());
    expect(paste({ 'text/plain': TABLE }).preventDefault).not.toHaveBeenCalled();
    expect(value()).toBe('글');
  });
  it('renders a pasted table and leaves the caret after it in live editing', async () => {
    await mount(true); type('before\n\nafter');
    expect(value()).toBe('after');
    paste({ 'text/plain': TABLE });
    const rendered = (): string[] => view!.root.findAll(node => typeof node.props['data-block'] === 'string')
      .flatMap(holder => holder.findAllByType(Reader).map(node => node.props.text as string));
    expect(rendered()).toEqual(['before', 'after', TABLE]);
    expect(value()).toBe('');
    type('continued');
    expect(rendered()).toEqual(['before', 'after', TABLE]); expect(value()).toBe('continued');
  });
  it('does not attach a second clipboard representation after a body paste consumed it', async () => {
    await mount();
    const files = [new File(['bitmap'], 'image.png', { type: 'image/png' })];
    const event = { defaultPrevented: true, clipboardData: { files, getData: () => '' }, preventDefault: vi.fn() };
    const shell = view!.root.findAll(node => node.type === 'div' && typeof node.props.onPaste === 'function')[0]!;
    act(() => shell.props.onPaste(event));
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe('memo table rendering', () => {
  it('renders preserved cells, inline code, alignment and explicit breaks without enabling arbitrary HTML', () => {
    const text = '| Name | State |\n| :--- | ---: |\n| **A** \\| B<br>C | `x \\| y` |\n| <img src="remote"> |  |';
    act(() => { view = create(createElement(MemoMarkdown, { text })); });
    expect(view!.root.findAllByType('table')).toHaveLength(1);
    expect(view!.root.findAllByType('th').map(node => node.props.style?.textAlign)).toEqual(['left', 'right']);
    expect(view!.root.findAllByType('td')).toHaveLength(4);
    expect(view!.root.findAllByType('strong')[0]?.children).toEqual(['A']);
    expect(view!.root.findAllByType('br')).toHaveLength(1);
    expect(view!.root.findAllByType('code')[0]?.children).toEqual(['x | y']);
    expect(view!.root.findAllByType('img')).toHaveLength(0);
  });
});
