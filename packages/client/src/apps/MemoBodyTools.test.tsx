import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoShell } from '@vibisual/memo/client';
import { MemoMarkdown } from './MemoMarkdown.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let view: ReactTestRenderer | undefined;
const root = '/project';
const fetcher = vi.fn(async (): Promise<Response> => new Response(JSON.stringify({ notes: [], settings: { aiEnabled: true } })));
const Reader = (_props: { text: string; onToggleTask?: (offset: number) => void }): null => null;
// 렌더러가 없으면 본문 전체가 원문 칸 하나다(M10) — 도구 시험은 이 길로, 한 화면 편집(M13)은 아래 묶음에서 본다.
const plain = {
  Scroll: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  useLifecycle: vi.fn(), openContext: vi.fn(), contexts: () => [], useAIEnabled: () => true,
};
let host: typeof plain & { Markdown?: typeof Reader } = plain;
beforeEach(() => { vi.useFakeTimers(); host = plain; vi.stubGlobal('fetch', fetcher); vi.stubGlobal('document', { activeElement: null }); });
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

// 도구 줄은 실제 입력 칸의 값과 선택을 읽으므로, 그 둘만 흉내 낸 칸을 ref 로 준다.
const caret = { start: 0, end: 0 };
const field = { get value(): string { return text(); }, get selectionStart(): number { return caret.start; }, get selectionEnd(): number { return caret.end; }, focus: (): void => undefined, setSelectionRange: (start: number, end: number): void => { caret.start = start; caret.end = end; } };
async function mount(): Promise<void> {
  await act(async () => { view = create(createElement(MemoShell, { params: { projectId: root }, host }), { createNodeMock: element => element.type === 'textarea' ? field : null }); });
}
const body = (): ReactTestInstance => view!.root.findAllByType('textarea')[0]!;
const text = (): string => body().props.value as string;
const type = (value: string, at = value.length): void => { caret.start = at; caret.end = at; act(() => body().props.onChange({ target: { value, selectionStart: at, selectionEnd: at } })); };
const select = (start: number, end = start): void => { caret.start = start; caret.end = end; act(() => body().props.onSelect({ currentTarget: { value: text(), selectionStart: start, selectionEnd: end } })); };
function press(key: string, at: number, extra: Record<string, unknown> = {}): { preventDefault: ReturnType<typeof vi.fn> } {
  const event = { key, code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(),
    currentTarget: { value: text(), selectionStart: at, selectionEnd: at }, ...extra };
  act(() => body().props.onKeyDown(event));
  return event;
}
const labelled = (label: string): ReactTestInstance[] => view!.root.findAll(node => node.type === 'button' && node.props['aria-label'] === label);
const options = (): string[] => view!.root.findAll(node => node.type === 'button' && node.props.role === 'option').map(node => `${node.props['aria-selected'] ? '>' : ''}${String(node.findByType('span').children[0]).replace('memo.insert.', '')}`);
const click = (node: ReactTestInstance | undefined): void => { act(() => { node!.props.onClick(); }); };

describe('memo body tools', () => {
  it('makes a checkbox with Ctrl+Enter, then checks it from the keyboard and by clicking the mark', async () => {
    await mount(); type('우유 사기');
    expect(press('Enter', 5, { ctrlKey: true }).preventDefault).toHaveBeenCalled();
    expect(text()).toBe('- [ ] 우유 사기');
    press('Enter', 11, { metaKey: true });
    expect(text()).toBe('- [x] 우유 사기');
    const mark = view!.root.findAll(node => node.type === 'span' && node.props.title === 'memo.toggleCheck');
    expect(mark).toHaveLength(1); expect(mark[0]?.children).toEqual(['[x]']);
    click(mark[0]);
    expect(text()).toBe('- [ ] 우유 사기');
  });
  it('leaves keys alone during a Korean composition', async () => {
    await mount(); type('가');
    const event = press('Enter', 1, { ctrlKey: true, nativeEvent: { isComposing: true } });
    expect(event.preventDefault).not.toHaveBeenCalled(); expect(text()).toBe('가');
  });
  it('opens the insert list on a slash, narrows it, and inserts the chosen item', async () => {
    await mount(); type('/');
    expect(options().length).toBeGreaterThan(10); expect(options()[0]).toBe('>todo');
    press('ArrowDown', 1);
    expect(options()[1]).toBe('>bullet');
    type('/tab');
    expect(options()).toEqual(['>table']);
    expect(press('Enter', 4).preventDefault).toHaveBeenCalled();
    expect(text()).toBe('|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n');
    expect(options()).toEqual([]);
  });
  it('closes the insert list on Escape and when nothing matches', async () => {
    await mount(); type('/');
    press('Escape', 1);
    expect(options()).toEqual([]);
    type('/t');
    expect(options()).toEqual([]);
    type('경로 /usr');
    expect(options()).toEqual([]);
    expect(press('Enter', 7).preventDefault).not.toHaveBeenCalled();
  });
  it('shows table tools only while the caret is in a table', async () => {
    await mount(); type('| a | b |\n| --- | --- |\n| 1 | 2 |\n\n글', 3);
    expect(view!.root.findAllByProps({ role: 'toolbar' })).toHaveLength(1);
    click(labelled('memo.table.addCol')[0]);
    expect(text()).toBe('| a |  | b |\n| --- | --- | --- |\n| 1 |  | 2 |\n\n글');
    click(labelled('memo.table.alignRight')[0]);
    expect(text()).toContain('| --- | ---: | --- |');
    select(text().length);
    expect(view!.root.findAllByProps({ role: 'toolbar' })).toHaveLength(0);
  });
  it('moves between cells with Tab and adds rows with Enter', async () => {
    await mount(); type('| a | b |\n| --- | --- |\n| 1 | 2 |', 3);
    expect(press('Tab', 3).preventDefault).toHaveBeenCalled();
    expect(text()).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
    press('Tab', text().length - 2);
    expect(text()).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |\n|  |  |');
    press('Enter', text().length - 4);
    expect(text()).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |\n\n');
  });
  it('rewrites the table from the grid editor', async () => {
    await mount(); type('| a |\n| --- |\n| 1 |', 3);
    const open = view!.root.findAll(node => node.type === 'button' && node.children.includes('memo.table.edit'))[0];
    click(open);
    const cells = view!.root.findAll(node => node.type === 'input' && typeof node.props['data-cell'] === 'string');
    expect(cells.map(cell => cell.props.value)).toEqual(['a', '1']);
    act(() => cells[1]!.props.onChange({ target: { value: 'x | y' } }));
    click(labelled('memo.table.addCol').at(-1));
    await act(async () => { view!.root.findAll(node => node.type === 'button' && node.children.includes('memo.table.apply'))[0]!.props.onClick(); });
    expect(text()).toBe('| a |  |\n| --- | --- |\n| x \\| y |  |');
    expect(view!.root.findAllByType('dialog')).toHaveLength(0);
  });
  it('inserts a table of the picked size from the toolbar', async () => {
    await mount(); type('메모');
    click(labelled('memo.table.insert')[0]);
    const cell = labelled('memo.table.size').filter(node => typeof node.props.onMouseEnter === 'function');
    expect(cell.length).toBeGreaterThan(8);
    click(cell[1]);
    expect(labelled('memo.table.size')).toHaveLength(0);
  });
  it('turns pasted spreadsheet cells into a table and leaves plain text alone', async () => {
    await mount(); type('목록');
    const paste = (data: string) => { const event = { clipboardData: { getData: () => data }, currentTarget: { value: text(), selectionStart: 2, selectionEnd: 2 }, preventDefault: vi.fn() }; act(() => body().props.onPaste(event)); return event; };
    expect(paste('그냥 글').preventDefault).not.toHaveBeenCalled();
    expect(paste('이름\t수량\n펜\t2').preventDefault).toHaveBeenCalled();
    expect(text()).toBe('목록\n\n| 이름 | 수량 |\n| --- | --- |\n| 펜 | 2 |\n');
  });
  it('moves a line with Alt+Arrow', async () => {
    await mount(); type('- 하나\n- 둘');
    press('ArrowUp', 8, { altKey: true });
    expect(text()).toBe('- 둘\n- 하나');
  });
});

describe('memo live editing (M13)', () => {
  const blocks = (): string[] => view!.root.findAll(node => typeof node.props['data-block'] === 'string')
    .flatMap(holder => holder.findAllByType(Reader).map(node => node.props.text as string));
  const inputs = (): ReactTestInstance[] => view!.root.findAll(node => node.type === 'textarea' && node.props['aria-label'] === 'memo.body');
  const live = async (): Promise<void> => { host = { ...plain, Markdown: Reader }; await mount(); };
  it('opens an empty memo as an input and renders finished blocks as soon as the caret leaves them', async () => {
    await live();
    expect(inputs()).toHaveLength(1);
    type('# 제목\n본문');
    expect(blocks()).toEqual(['# 제목']);
    expect(text()).toBe('본문');
  });
  it('moves into the previous block with ArrowUp and sizes a heading input like the heading', async () => {
    await live(); type('# 제목\n본문');
    expect(press('ArrowUp', 0).preventDefault).toHaveBeenCalled();
    expect(text()).toBe('# 제목');
    expect(String(body().props.className)).toContain('text-[32px]');
    expect(blocks()).toEqual(['본문']);
  });
  it('joins with the previous block on Backspace at the start', async () => {
    await live(); type('하나\n둘');
    expect(text()).toBe('둘');
    press('Backspace', 0);
    expect(text()).toBe('하나둘'); expect(blocks()).toEqual([]);
  });
  it('closes the input on Escape and checks a box in the rendered view', async () => {
    await live(); type('- [ ] 첫째\n- [ ] 둘째\n\n끝');
    expect(text()).toBe('끝');
    press('Escape', 0);
    expect(inputs()).toHaveLength(0);
    expect(blocks()).toEqual(['- [ ] 첫째\n- [ ] 둘째', '끝']);
    const list = view!.root.findAllByType(Reader)[0]!;
    act(() => list.props.onToggleTask('- [ ] 첫째\n'.length));
    expect(blocks()[0]).toBe('- [ ] 첫째\n- [x] 둘째');
  });
  it('drops toolbar formatting at the end and opens that block when nothing is being edited', async () => {
    await live(); type('메모\n\n끝');
    press('Escape', 0);
    click(labelled('memo.format.todo')[0]);
    expect(text()).toBe('- [ ] 끝');
  });
});

describe('memo reading view', () => {
  const render = (source: string, toggle?: (offset: number) => void): ReactTestInstance[] => {
    act(() => { view = create(createElement(MemoMarkdown, toggle ? { text: source, onToggleTask: toggle } : { text: source })); });
    return view!.root.findAll(node => node.type === 'input');
  };
  it('reports the source offset of the list item whose checkbox was clicked', () => {
    const source = '- [ ] a\n- [x] b\n  - [ ] nested\n\n> - [ ] quoted';
    const toggle = vi.fn();
    const boxes = render(source, toggle);
    expect(boxes.map(box => box.props.checked)).toEqual([false, true, false, false]);
    for (const box of boxes) act(() => box.props.onChange());
    expect(toggle.mock.calls.map(call => call[0])).toEqual([0, 8, source.indexOf('- [ ] nested'), source.indexOf('- [ ] quoted')]);
  });
  it('keeps checkboxes read-only without a toggle handler', () => {
    const boxes = render('- [ ] a');
    expect(boxes).toHaveLength(1); expect(boxes[0]?.props.disabled).toBe(true);
  });
});
