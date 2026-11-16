import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownTable } from './MarkdownTable.js';

const mocks = vi.hoisted(() => ({ build: vi.fn(), write: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./streamClipboard.js', () => ({ streamElementClipboard: mocks.build, writeStreamClipboard: mocks.write }));
const payload = { text: '| A |\n| --- |\n| B |', html: '<table></table>' };
const tableNode = { tagName: 'TABLE' };
let view: ReactTestRenderer | undefined;
const button = () => view!.root.findByType('button');
const click = (): void => { button().props.onClick({ stopPropagation: vi.fn() }); };
beforeEach(() => { vi.useFakeTimers(); mocks.build.mockReset().mockReturnValue(payload); mocks.write.mockReset().mockResolvedValue(undefined); });
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.useRealTimers(); });
function mount(): void {
  act(() => { view = create(<MarkdownTable><tbody><tr><td>A</td></tr></tbody></MarkdownTable>, { createNodeMock: element => element.type === 'table' ? tableNode : null }); });
}

describe('Markdown table copy button', () => {
  it('copies the complete table and reports success only after the clipboard write resolves', async () => {
    let finish!: () => void;
    mocks.write.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    mount(); act(click);
    expect(mocks.build).toHaveBeenCalledExactlyOnceWith(tableNode);
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith(payload);
    expect(button().props.disabled).toBe(true);
    expect(button().props['aria-label']).toBe('ide.streamRenderer.copy');
    await act(async () => { finish(); });
    expect(button().props['aria-label']).toBe('ide.streamRenderer.copied');
    act(() => { vi.runOnlyPendingTimers(); });
    expect(button().props['aria-label']).toBe('ide.streamRenderer.copy');
  });
  it('keeps failed copies retryable and preserves the selection when the button is pressed', async () => {
    mocks.write.mockRejectedValueOnce(new Error('Denied'));
    mount();
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    act(() => button().props.onPointerDown(event));
    expect(event.preventDefault).toHaveBeenCalledOnce();
    await act(async () => { click(); });
    expect(button().props['aria-label']).toBe('common.appError.retry');
    expect(button().props.disabled).toBe(false);
    await act(async () => { click(); });
    expect(button().props['aria-label']).toBe('ide.streamRenderer.copied');
  });
  it('does not report a late copy as success for newly streamed table content', async () => {
    let finish!: () => void;
    mocks.write.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    mount(); act(click);
    act(() => view!.update(<MarkdownTable><tbody><tr><td>Changed</td></tr></tbody></MarkdownTable>));
    await act(async () => { finish(); });
    expect(button().props['aria-label']).toBe('ide.streamRenderer.copy');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('marks controls as non-content and keeps horizontal scrolling and touch access available', () => {
    mount();
    expect(button().parent?.props['data-clipboard-ignore']).toBe('');
    expect(button().props.className).toContain('select-none');
    expect(button().props.className).toContain('pointer-coarse:opacity-100');
    expect(view!.root.findByType('table').parent?.props.className).toContain('overflow-x-auto');
  });
});
