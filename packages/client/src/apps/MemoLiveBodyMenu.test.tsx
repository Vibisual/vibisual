import { createElement, type ReactNode, type RefObject } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoShell } from '@vibisual/memo/client';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let view: ReactTestRenderer | undefined;
let doc: EventTarget & { activeElement: TestElement | null };
const Reader = (_props: { text: string }): null => null;
const host = {
  Scroll: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  Markdown: Reader, useLifecycle: vi.fn(), openContext: vi.fn(), contexts: () => [], useAIEnabled: () => true,
};
const { Markdown: _reader, ...plainHost } = host;

class TestElement {
  ownerDocument = doc;
  selectionStart = 0;
  selectionEnd = 0;
  constructor(readonly inside = false, readonly fieldMenu = false) {}
  contains(target: TestElement): boolean { return target.inside; }
  closest(selector: string): TestElement | null { return this.fieldMenu && selector === '[data-text-field-menu]' ? this : null; }
  querySelector(): null { return null; }
  focus(): void { doc.activeElement = this; }
  setSelectionRange(start: number, end: number): void { this.selectionStart = start; this.selectionEnd = end; }
  get value(): string { return inputs()[0]?.props.value as string ?? ''; }
  get isConnected(): boolean { return activeField() === this; }
}

beforeEach(() => {
  vi.useFakeTimers();
  doc = Object.assign(new EventTarget(), { activeElement: null });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('Element', TestElement);
  vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> => new Response(JSON.stringify({ notes: [], settings: { aiEnabled: true } }))));
});
afterEach(() => {
  act(() => view?.unmount()); view = undefined;
  vi.useRealTimers(); vi.unstubAllGlobals();
});

function inputs(): ReactTestInstance[] {
  return view?.root.findAll(node => node.type === 'textarea' && node.props['aria-label'] === 'memo.body') ?? [];
}
function activeField(): TestElement | null {
  let node: ReactTestInstance | null = inputs()[0] ?? null;
  while (node && !node.props.bodyRef) node = node.parent;
  return (node?.props.bodyRef as RefObject<TestElement> | undefined)?.current ?? null;
}
async function mount(live = true): Promise<void> {
  await act(async () => {
    view = create(createElement(MemoShell, { params: { projectId: '/project' }, host: live ? host : plainHost }), {
      createNodeMock: () => new TestElement(true),
    });
  });
}
function type(value: string): void {
  act(() => inputs()[0]!.props.onChange({ target: { value, selectionStart: value.length, selectionEnd: value.length } }));
}
function dispatch(type: string, target: TestElement): void {
  const event = new Event(type);
  Object.defineProperty(event, 'target', { value: target });
  act(() => { doc.dispatchEvent(event); });
}

describe('memo live editor context menu lifetime', () => {
  it.each([true, false])('replaces the input identity for a new empty memo (live %s)', async (live) => {
    await mount(live);
    const previous = activeField();
    expect(previous).not.toBeNull();
    expect(previous?.isConnected).toBe(true);
    const root = view!.root.findAll(node => node.type === 'div' && typeof node.props.onKeyDown === 'function')[0]!;
    await act(async () => {
      root.props.onKeyDown({ code: 'KeyN', ctrlKey: true, metaKey: false, altKey: true, shiftKey: false,
        nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() });
    });
    expect(inputs()[0]!.props.value).toBe('');
    expect(activeField()).not.toBeNull();
    expect(activeField()).not.toBe(previous);
    expect(previous?.isConnected).toBe(false);
    expect(activeField()?.isConnected).toBe(true);
  });

  it('keeps the active block through portaled field actions and continues editing afterward', async () => {
    await mount(); type('메모');
    dispatch('pointerdown', new TestElement(false, true));
    dispatch('focusin', new TestElement(false, true));
    expect(inputs()).toHaveLength(1);
    expect(inputs()[0]!.props.value).toBe('메모');
    dispatch('focusin', new TestElement(true));
    type('메모에 계속 입력');
    expect(inputs()[0]!.props.value).toBe('메모에 계속 입력');
  });

  it.each(['pointerdown', 'focusin'])('closes the active block for ordinary outside %s', async (eventType) => {
    await mount(); type('메모');
    dispatch(eventType, new TestElement(false, true));
    expect(inputs()).toHaveLength(1);
    dispatch(eventType, new TestElement(false));
    expect(inputs()).toHaveLength(0);
    expect(view!.root.findByType(Reader).props.text).toBe('메모');
  });
});
