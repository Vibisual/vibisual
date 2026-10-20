import type { ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionMemo } from '@vibisual/shared';
import { SessionMemoCard } from './SessionMemoCard.js';
import type { MemoLinkHost } from './useMemoLinkHost.js';

vi.mock('react-dom', () => ({ createPortal: (children: ReactNode) => children }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../theme/useAppTheme.js', () => ({ useAppThemeTokenHex: () => '#111827' }));
vi.mock('../Panel/CommentBoxColorPopover.js', () => ({ CommentBoxColorPopover: () => null }));

let view: ReactTestRenderer | undefined;
let browser: EventTarget & { innerWidth: number; innerHeight: number };
let doc: { body: object; activeElement: TestElement | null; querySelector: (selector: string) => TestElement | null };
let linkRects: DOMRect[];
let resize: (() => void) | undefined;
const nodes = new Map<string, TestElement>();

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) };
}
function field(): ReactTestInstance { return view!.root.findByType('textarea'); }
function bubble(): ReactTestInstance | undefined {
  return view?.root.findAll((el) => el.type === 'div' && el.props['data-memo-link-bubble'] === 'm')[0];
}
function bubbleButtons(): TestElement[] {
  return bubble()?.findAllByType('button').filter((button) => !button.props.disabled).map((button) => button.instance as TestElement) ?? [];
}

/** Measured DOM stand-ins; Card and Bubble handlers/effects run together. */
class TestElement extends EventTarget {
  style: Record<string, string> = {};
  clientWidth = 200;
  scrollTop = 0;
  selectionStart = 1;
  selectionEnd = 1;
  value = 'linked text';
  constructor(readonly id: string) { super(); }
  focus = vi.fn(() => {
    const previous = doc.activeElement;
    if (previous === this) return;
    doc.activeElement = this;
    if (previous?.id === 'textarea') field().props.onBlur({ relatedTarget: this });
    else if (previous?.id.startsWith('ide.memo.link.')) bubble()?.props.onBlur({ relatedTarget: this });
    if (this.id === 'textarea') field().props.onFocus();
  });
  getBoundingClientRect = (): DOMRect => this.id === 'textarea' ? rect(20, 100, 200, 80) : rect(0, 0, 180, 40);
  getClientRects = (): DOMRect[] => linkRects;
  getAttribute = (name: string): string | null => name === 'data-memo-link-bubble' && this.id === 'bubble' ? 'm' : null;
  closest = (selector: string): TestElement | null => selector === '[data-memo-link-bubble]' && this.id.startsWith('ide.memo.link.')
    ? nodes.get('bubble') ?? null : null;
  querySelector = (selector: string): TestElement | null => selector.startsWith('[data-memo-link=')
    ? nodes.get('span') ?? null : selector === 'button:not(:disabled)' ? bubbleButtons()[0] ?? null : null;
}

beforeEach(() => {
  nodes.clear();
  nodes.set('span', new TestElement('span'));
  resize = undefined;
  linkRects = [rect(30, 110, 150, 20)];
  browser = Object.assign(new EventTarget(), { innerWidth: 1000, innerHeight: 700 });
  doc = { body: {}, activeElement: null, querySelector: () => bubbleButtons()[0] ?? null };
  vi.stubGlobal('window', browser);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('Element', TestElement);
  vi.stubGlobal('HTMLElement', TestElement);
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe(): void {}
    disconnect(): void {}
  });
});
afterEach(() => {
  act(() => view?.unmount());
  view = undefined;
  vi.unstubAllGlobals();
});

function mount(overrides: Partial<SessionMemo> = {}): ReturnType<typeof vi.fn> {
  const memo: SessionMemo = {
    id: 'm', text: 'linked text', x: 0, y: 0, w: 220, h: 140, color: '#FDE68A', createdAt: 1, updatedAt: 1,
    links: [{ id: 'link', start: 0, end: 11, target: { kind: 'url', url: 'https://example.com' } }],
    ...overrides,
  };
  const host: MemoLinkHost = {
    prompts: () => [], sessions: () => [], sessionInfo: () => ({ label: '', alive: true }),
    formatTime: () => '', rootPath: () => null, open: async () => true,
  };
  const onPatch = vi.fn();
  act(() => {
    view = create(<SessionMemoCard
      memo={memo} tabs={[memo]} bounds={{ w: 800, h: 600 }} zIndex={1} stackedUnder={0} autoFocus={false}
      onPatch={onPatch} onRaise={vi.fn()} onRaiseUnder={vi.fn()} onDelete={vi.fn()} onActivateTab={vi.fn()}
      onMerge={vi.fn()} onDetach={vi.fn()} linkHost={host} pickRange={null} onTextMenu={vi.fn()}
      onLinkFollow={async () => true} onLinkRepick={vi.fn()} onLinkRemove={vi.fn()}
    />, {
      createNodeMock: (el) => {
        const props = el.props as Record<string, unknown>;
        const id = el.type === 'textarea' ? 'textarea'
          : props['data-memo-link-bubble'] ? 'bubble'
            : props['aria-label'] ? String(props['aria-label'])
              : String(props.className).includes('whitespace-pre-wrap') ? 'mirror' : 'root';
        if (!nodes.has(id)) {
          const node = new TestElement(id);
          if (id === 'textarea') node.value = memo.text;
          nodes.set(id, node);
        }
        return nodes.get(id);
      },
    });
  });
  act(() => nodes.get('textarea')!.focus());
  return onPatch;
}

describe('SessionMemoCard link popup', () => {
  it('keeps a wrapped link available after its first line scrolls out, and remeasures resizing and ancestor scroll', () => {
    mount();
    expect(bubble()?.props.style.top).toBe(136);
    linkRects = [rect(30, 70, 150, 20), rect(30, 130, 120, 20)];
    act(() => field().props.onScroll());
    expect(bubble()?.props.style.top).toBe(156);
    linkRects = [rect(30, 140, 150, 20)];
    act(() => resize?.());
    expect(bubble()?.props.style.top).toBe(166);
    linkRects = [rect(30, 120, 150, 20)];
    act(() => { browser.dispatchEvent(new Event('scroll')); });
    expect(bubble()?.props.style.top).toBe(146);
    linkRects = [rect(30, 200, 150, 20)];
    act(() => field().props.onScroll());
    expect(bubble()).toBeUndefined();
  });

  it('Tabs into the popup, keeps it during button focus, and Shift+Tabs back to the text', () => {
    mount();
    const preventDefault = vi.fn();
    act(() => field().props.onKeyDown({ key: 'Tab', shiftKey: false, nativeEvent: {}, preventDefault }));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(doc.activeElement?.id).toBe('ide.memo.link.follow');
    expect(bubble()).toBeDefined();
    act(() => bubbleButtons()[1]!.focus());
    expect(bubble()).toBeDefined();
    act(() => bubbleButtons()[0]!.focus());
    act(() => bubble()!.props.onKeyDown({
      key: 'Tab', shiftKey: true, nativeEvent: {}, target: doc.activeElement, currentTarget: nodes.get('bubble'), preventDefault,
    }));
    expect(doc.activeElement?.id).toBe('textarea');
    expect(bubble()).toBeDefined();
    act(() => new TestElement('outside').focus());
    expect(bubble()).toBeUndefined();
  });

  it('leaves composition Tab to the input method', () => {
    mount();
    const preventDefault = vi.fn();
    act(() => field().props.onKeyDown({ key: 'Tab', shiftKey: false, nativeEvent: { isComposing: true }, preventDefault }));
    expect(preventDefault).not.toHaveBeenCalled();
    expect(doc.activeElement?.id).toBe('textarea');
  });

  it('uses native beforeinput to keep the original linked text when identical characters are inserted before it', () => {
    const onPatch = mount({ text: 'aaa', links: [{ id: 'link', start: 0, end: 3, target: { kind: 'url', url: 'https://example.com' } }] });
    const ta = nodes.get('textarea')!;
    ta.selectionStart = ta.selectionEnd = 0;
    const event = new Event('beforeinput');
    Object.defineProperty(event, 'inputType', { value: 'insertText' });
    act(() => { ta.dispatchEvent(event); });
    ta.value = 'aaaa';
    ta.selectionStart = ta.selectionEnd = 1;
    act(() => field().props.onChange({ target: ta }));
    expect(onPatch).toHaveBeenLastCalledWith('m', {
      text: 'aaaa', links: [{ id: 'link', start: 1, end: 4, target: { kind: 'url', url: 'https://example.com' } }],
    }, 'defer', { start: 0, end: 0, inputType: 'insertText' });
  });

  it('uses the context-menu selection when a fallback cut emits input without beforeinput', () => {
    const onPatch = mount({ text: 'foo foo', links: [{ id: 'link', start: 0, end: 3, target: { kind: 'url', url: 'https://example.com' } }] });
    const ta = nodes.get('textarea')!;
    ta.selectionStart = 0;
    ta.selectionEnd = 4;
    act(() => field().props.onContextMenu({ currentTarget: ta, clientX: 0, clientY: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() }));
    ta.value = 'foo';
    ta.selectionStart = ta.selectionEnd = 0;
    act(() => field().props.onChange({ target: ta }));
    expect(onPatch).toHaveBeenLastCalledWith('m', { text: 'foo', links: [] }, 'defer', { start: 0, end: 4 });
  });

  it('does not mistake an undo for deleting the currently selected identical character', () => {
    const onPatch = mount({ text: 'aaaa', links: [{ id: 'link', start: 3, end: 4, target: { kind: 'url', url: 'https://example.com' } }] });
    const ta = nodes.get('textarea')!;
    ta.selectionStart = 0;
    ta.selectionEnd = 1;
    act(() => field().props.onContextMenu({ currentTarget: ta, clientX: 0, clientY: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() }));
    ta.value = 'aaa';
    act(() => field().props.onChange({ target: ta, nativeEvent: { inputType: 'historyUndo' } }));
    expect(onPatch).toHaveBeenLastCalledWith('m', { text: 'aaa', links: [] }, 'defer', { start: 0, end: 1, inputType: 'historyUndo' });
  });
});
