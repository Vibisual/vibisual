import type { ComponentProps, ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionMemo } from '@vibisual/shared';
import { SessionMemoCard } from './SessionMemoCard.js';
import { CANVAS_MEMO_DRAG, canvasMemoExitPoint } from './canvasMemoTransfer.js';
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
  classList = { toggle: vi.fn() };
  children: TestElement[] = [];
  dataset: Record<string, string> = {};
  remove = vi.fn();
  clientWidth = 200;
  scrollWidth = 200;
  scrollLeft = 0;
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
  vi.useRealTimers();
});

describe('SessionMemoCard clipboard', () => {
  function copyButton(): ReactTestInstance {
    return view!.root.findAllByType('button').find((button) =>
      ['ide.streamRenderer.copy', 'ide.streamRenderer.copied', 'common.appError.retry'].includes(button.props['aria-label']))!;
  }
  async function copy(): Promise<void> {
    await act(async () => { copyButton().props.onClick({ stopPropagation: vi.fn() }); });
  }
  function updateMemo(patch: Partial<SessionMemo>): void {
    // The renderer root is SessionMemoCard, but its props type is erased by the test renderer.
    const props = view!.root.props as ComponentProps<typeof SessionMemoCard>;
    const memo = { ...props.memo, ...patch };
    act(() => view!.update(<SessionMemoCard {...props} memo={memo} tabs={[memo]} />));
  }

  it('copies the entire visible memo verbatim and clears feedback when its text changes', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    mount({ text: '  첫 줄\n다음 줄\n', name: 'Title' });
    await copy();
    expect(writeText).toHaveBeenCalledExactlyOnceWith('  첫 줄\n다음 줄\n');
    expect(copyButton().props['aria-label']).toBe('ide.streamRenderer.copied');
    updateMemo({ text: 'Edited memo' });
    expect(copyButton().props['aria-label']).toBe('ide.streamRenderer.copy');
    await copy();
    expect(writeText).toHaveBeenLastCalledWith('Edited memo');
    act(() => { vi.runAllTimers(); });
    expect(copyButton().props['aria-label']).toBe('ide.streamRenderer.copy');
  });

  it('does not report an old pending copy as success on another memo tab', async () => {
    let resolve: (() => void) | undefined;
    const writeText = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    mount();
    await copy();
    expect(copyButton().props.disabled).toBe(true);
    updateMemo({ id: 'other', text: 'Other memo', links: undefined });
    await act(async () => { resolve?.(); });
    expect(writeText).toHaveBeenCalledExactlyOnceWith('linked text');
    expect(copyButton().props['aria-label']).toBe('ide.streamRenderer.copy');
    expect(copyButton().props.disabled).toBe(false);
  });

  it('offers a retry after clipboard denial and preserves the editing selection on press', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('Denied')).mockResolvedValueOnce(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    mount();
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    copyButton().props.onPointerDown({ preventDefault, stopPropagation });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    await copy();
    expect(copyButton().props['aria-label']).toBe('common.appError.retry');
    await copy();
    expect(copyButton().props['aria-label']).toBe('ide.streamRenderer.copied');
  });

  it('keeps empty memos disabled and handles a missing clipboard API', async () => {
    vi.stubGlobal('navigator', {});
    mount({ text: '', links: undefined });
    expect(copyButton().props.disabled).toBe(true);
    updateMemo({ text: 'Memo text' });
    await copy();
    expect(copyButton().props['aria-label']).toBe('common.appError.retry');
  });
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

describe('SessionMemoCard canvas dragging', () => {
  function event(x: number, y: number): object {
    return { button: 0, pointerId: 1, clientX: x, clientY: y, type: 'pointerup',
      target: { closest: () => null }, preventDefault: vi.fn(), stopPropagation: vi.fn(),
      currentTarget: { setPointerCapture: vi.fn(), hasPointerCapture: () => false } };
  }
  function configure(patch: Partial<ComponentProps<typeof SessionMemoCard>>): void {
    const props = view!.root.props as ComponentProps<typeof SessionMemoCard>;
    act(() => view!.update(<SessionMemoCard {...props} {...patch} />));
    Object.assign(doc, { elementFromPoint: () => null });
  }
  function canvasGesture(): {
    header: ReactTestInstance;
    root: TestElement;
    ghost: TestElement;
    onDrop: ReturnType<typeof vi.fn>;
    onPatch: ReturnType<typeof vi.fn>;
  } {
    const onPatch = mount({ x: 300, y: 150, w: 300, h: 150 });
    const ghost = new TestElement('ghost');
    Object.assign(doc, { createElement: () => ghost });
    Object.assign(doc.body, { appendChild: vi.fn() });
    const onDrop = vi.fn(() => true);
    configure({ onCanvasDrop: onDrop, onCanvasTarget: (_pointer, position, exit) =>
      exit && canvasMemoExitPoint(exit, { x: 0, y: 0, w: 1600, h: 1000 })
        ? { project: 'Project', folderId: null, ...position } : null });
    const root = nodes.get('root')!;
    const ide = new TestElement('ide');
    ide.getBoundingClientRect = () => rect(100, 100, 600, 400);
    root.getBoundingClientRect = () => rect(400, 250, 300, 150);
    root.closest = (selector) => selector === '[data-ide-overlay]' ? ide : null;
    return { header: view!.root.findByProps({ 'data-memo-drop-id': 'm' }), root, ghost, onDrop, onPatch };
  }
  it.each([0.5, 1, 1.25, 2])('keeps card and text sizes while projecting world positions at zoom %s', (scale) => {
    mount({ x: -300, y: 200 });
    configure({ bounds: { w: 100000, h: 100000, scale, unbounded: true } });
    const card = view!.root.findByProps({ 'data-session-memo': 'm' });
    expect(card.props.style).toMatchObject({ left: -300 * scale, top: 200 * scale, width: 220, height: 140 });
    expect(card.props.style.transform).toBeUndefined();
    expect(field().props.className).toContain('text-[13px]');
  });
  it.each([0.5, 1.25, 2])('follows the pointer in screen pixels and commits world coordinates at zoom %s', (scale) => {
    const onPatch = mount();
    configure({ bounds: { w: 100000, h: 100000, scale, unbounded: true } });
    const header = view!.root.findByProps({ 'data-memo-drop-id': 'm' });
    act(() => header.props.onPointerDown(event(100, 100)));
    act(() => header.props.onPointerMove(event(140, 160)));
    expect(nodes.get('root')!.style.transform).toBe('translate3d(40px, 60px, 0)');
    act(() => header.props.onPointerUp(event(140, 160)));
    expect(onPatch).toHaveBeenCalledWith('m', { x: 40 / scale, y: 60 / scale }, 'now');
    expect(nodes.get('root')!.style.transform).toBe('');
  });
  it.each([0.5, 1.25, 2])('resizes by screen pixels at zoom %s', (scale) => {
    const onPatch = mount();
    configure({ bounds: { w: 100000, h: 100000, scale, unbounded: true } });
    const handle = view!.root.findByProps({ title: 'ide.memo.resize' });
    act(() => handle.props.onPointerDown(event(100, 100)));
    act(() => handle.props.onPointerMove(event(140, 160)));
    expect(nodes.get('root')!.style).toMatchObject({ width: '260px', height: '200px' });
    act(() => handle.props.onPointerUp(event(140, 160)));
    expect(onPatch).toHaveBeenCalledWith('m', { w: 260, h: 200 }, 'now');
  });
  it('detaches a tab using a screen pixel threshold and a fixed size preview', () => {
    mount();
    const memo = view!.root.props.memo as SessionMemo;
    const onDetach = vi.fn();
    const ghost = { style: {} as Record<string, string>, remove: vi.fn() };
    Object.assign(doc, { createElement: () => ghost });
    Object.assign(doc.body, { appendChild: vi.fn() });
    configure({ bounds: { w: 100000, h: 100000, scale: 2, unbounded: true },
      tabs: [memo, { ...memo, id: 'other' }], onDetach });
    const tab = view!.root.findByProps({ 'aria-current': 'true' });
    act(() => tab.props.onPointerDown(event(394, 300)));
    act(() => tab.props.onPointerMove(event(400, 300)));
    expect(ghost.style).toMatchObject({ width: '220px', height: '140px', left: '380px', top: '286px' });
    act(() => tab.props.onPointerUp(event(400, 300)));
    expect(onDetach).toHaveBeenCalledWith('m', { x: 190, y: 143 });
    expect(ghost.remove).toHaveBeenCalledOnce();
  });
  it('offers a whole-card canvas drop before committing the session position', () => {
    const onPatch = mount(); const onCanvasDrop = vi.fn(() => true);
    configure({ onCanvasDrop });
    const header = view!.root.findByProps({ 'data-memo-drop-id': 'm' });
    act(() => header.props.onPointerDown(event(30, 10)));
    act(() => header.props.onPointerUp(event(400, 300)));
    expect(onCanvasDrop).toHaveBeenCalledWith('m', true, { x: 400, y: 300 }, { x: 370, y: 290 }, expect.objectContaining({
      card: { x: 370, y: 290, w: 220, h: 140 },
    }));
    expect(onPatch).not.toHaveBeenCalled();
  });
  it('turns green at one third beyond the IDE and drops with the cursor still inside', () => {
    const { header, root, ghost, onDrop, onPatch } = canvasGesture();
    act(() => header.props.onPointerDown(event(430, 260)));
    act(() => header.props.onPointerMove(event(529, 260)));
    expect(root.style.outline).toBe('');
    expect(ghost.style.borderColor).toBe(CANVAS_MEMO_DRAG.PREVIEW_BORDER);
    act(() => header.props.onPointerMove(event(530, 260)));
    expect(root.style.outline).toBe(CANVAS_MEMO_DRAG.READY_OUTLINE);
    expect(ghost.style.background).toBe(CANVAS_MEMO_DRAG.READY_BACKGROUND);
    act(() => header.props.onPointerMove(event(529, 260)));
    expect(root.style.outline).toBe('');
    expect(ghost.style.borderColor).toBe(CANVAS_MEMO_DRAG.PREVIEW_BORDER);
    act(() => header.props.onPointerUp(event(530, 260)));
    expect(onDrop).toHaveBeenCalledExactlyOnceWith('m', true, { x: 530, y: 260 }, { x: 500, y: 250 }, {
      card: { x: 500, y: 250, w: 300, h: 150 }, bounds: { x: 100, y: 100, w: 600, h: 400 },
    });
    expect(onPatch).not.toHaveBeenCalled();
    expect(root.style.outline).toBe('');
    expect(ghost.remove).toHaveBeenCalledOnce();
  });
  it.each(['pointercancel', 'lostpointercapture'])('clears the armed preview without saving on %s', (type) => {
    const { header, root, ghost, onDrop, onPatch } = canvasGesture();
    act(() => header.props.onPointerDown(event(430, 260)));
    act(() => header.props.onPointerMove(event(530, 260)));
    expect(root.style.outline).toBe(CANVAS_MEMO_DRAG.READY_OUTLINE);
    act(() => header.props.onPointerCancel({ ...event(530, 260), type }));
    expect(root.style.outline).toBe('');
    expect(root.style.transform).toBe('');
    expect(ghost.remove).toHaveBeenCalledOnce();
    expect(onDrop).not.toHaveBeenCalled();
    expect(onPatch).not.toHaveBeenCalled();
  });
  it('commits once when releasing capture synchronously raises capture loss', () => {
    const { header, onDrop } = canvasGesture();
    act(() => header.props.onPointerDown(event(430, 260)));
    act(() => header.props.onPointerUp({ ...event(530, 260), currentTarget: {
      hasPointerCapture: () => true,
      releasePointerCapture: () => header.props.onLostPointerCapture({ ...event(0, 0), type: 'lostpointercapture' }),
    } }));
    expect(onDrop).toHaveBeenCalledOnce();
    expect(onDrop.mock.calls[0]![2]).toEqual({ x: 530, y: 260 });
  });
  it.each([true, false])('merges only with a memo in the same layer, same layer %s', (sameLayer) => {
    const { header, root, onDrop } = canvasGesture();
    const onMerge = vi.fn();
    configure({ onMerge });
    const sourceLayer = new TestElement('source-layer');
    const targetLayer = sameLayer ? sourceLayer : new TestElement('canvas-layer');
    const closest = root.closest;
    root.closest = (selector) => selector === '[data-session-memo-layer]' ? sourceLayer : closest(selector);
    const target = new TestElement('target');
    const targetHeader = new TestElement('target-header');
    targetHeader.dataset['memoDropId'] = 'target';
    targetHeader.closest = (selector) => selector === '[data-memo-drop-id]' ? targetHeader
      : selector === '[data-session-memo]' ? target : null;
    target.closest = (selector) => selector === '[data-session-memo-layer]' ? targetLayer : null;
    Object.assign(doc, { elementFromPoint: () => targetHeader });
    act(() => header.props.onPointerDown(event(430, 260)));
    act(() => header.props.onPointerUp(event(530, 260)));
    if (sameLayer) {
      expect(onMerge).toHaveBeenCalledExactlyOnceWith('m', 'target', true);
      expect(onDrop).not.toHaveBeenCalled();
    } else {
      expect(onMerge).not.toHaveBeenCalled();
      expect(onDrop).toHaveBeenCalledOnce();
    }
  });
});

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
