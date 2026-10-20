import type { ComponentProps, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FullscreenPrompt } from './FullscreenPrompt.js';
import type { PromptTone } from './CollapsiblePrompt.js';

const graph = vi.hoisted(() => ({ ideTextZoom: 1 }));
vi.mock('react-dom', () => ({ createPortal: vi.fn((children: ReactNode) => children) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../stores/graphStore.js', () => ({
  useGraphStore: (selector: (state: typeof graph) => unknown) => selector(graph),
}));

const tone: PromptTone = {
  bubble: 'border-emerald-400/45 bg-emerald-500/15',
  hover: 'hover:bg-emerald-500/20',
  chip: 'bg-emerald-400/25 text-emerald-200',
  label: 'text-emerald-200/80',
  stamp: 'text-emerald-200/55',
  body: 'text-emerald-50',
  chevron: 'text-emerald-200/60',
  copyIdle: 'border-emerald-300/20 text-emerald-200/70',
  pre: 'border-emerald-300/20 bg-emerald-950/30 text-emerald-50/90',
  divider: 'border-emerald-300/20',
  badge: 'bg-emerald-400/20 text-emerald-200',
};

type KeyListener = (event: KeyboardEvent) => void;

/** Node's EventTarget does not model browser capture order, so keep the two phases explicit. */
class TestWindow {
  listeners: Array<{ type: string; listener: KeyListener; capture: boolean }> = [];
  addEventListener = (type: string, listener: KeyListener, capture = false): void => {
    this.listeners.push({ type, listener, capture });
  };
  removeEventListener = (type: string, listener: KeyListener, capture = false): void => {
    this.listeners = this.listeners.filter((entry) => entry.type !== type || entry.listener !== listener || entry.capture !== capture);
  };
  dispatch(event: KeyboardEvent): void {
    let stopped = false;
    const stop = event.stopImmediatePropagation.bind(event);
    vi.spyOn(event, 'stopImmediatePropagation').mockImplementation(() => { stopped = true; stop(); });
    for (const capture of [true, false]) {
      for (const entry of [...this.listeners]) {
        if (stopped) return;
        if (entry.type === event.type && entry.capture === capture) entry.listener(event);
      }
    }
  }
}

let view: ReactTestRenderer | undefined;
let browser: TestWindow;
let doc: { body: TestElement; activeElement: TestElement | null; defaultView: TestWindow };
let host: TestElement;
let opener: TestElement;
let dialog: TestElement;
let body: TestElement;

/** Only node identity, containment, and focus are mocked; component effects and key handling run. */
class TestElement extends EventTarget {
  isConnected = true;
  constructor(readonly name: string, readonly parent: TestElement | null = null) { super(); }
  get ownerDocument(): typeof doc { return doc; }
  focus = vi.fn((_options?: FocusOptions) => { doc.activeElement = this; });
  contains(target: TestElement | null): boolean {
    for (let node = target; node; node = node.parent) if (node === this) return true;
    return false;
  }
}

beforeEach(() => {
  graph.ideTextZoom = 1;
  vi.mocked(createPortal).mockClear();
  browser = new TestWindow();
  doc = { body: new TestElement('document-body'), activeElement: null, defaultView: browser };
  host = new TestElement('ide-text-viewport', doc.body);
  opener = new TestElement('open-reader', host);
  dialog = new TestElement('reader', host);
  body = new TestElement('reader-body', dialog);
  doc.activeElement = opener;
  vi.stubGlobal('window', browser);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('Node', TestElement);
  vi.stubGlobal('HTMLElement', TestElement);
});

afterEach(() => {
  act(() => view?.unmount());
  view = undefined;
  vi.unstubAllGlobals();
});

function mount(overrides: Partial<ComponentProps<typeof FullscreenPrompt>> = {}): ComponentProps<typeof FullscreenPrompt> {
  const props = {
    host: host as unknown as HTMLElement,
    tone,
    prompt: '첫 줄\n\n두 번째 줄\n',
    identity: <span>나 · 오늘 14:32</span>,
    preview: '첫 줄',
    copied: false,
    onCopy: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  act(() => {
    view = create(<FullscreenPrompt {...props} />, {
      createNodeMock: (element) => {
        const { role } = element.props as { role?: string };
        return role === 'dialog' ? dialog : role === 'region' ? body : null;
      },
    });
  });
  return props;
}

function key(target: TestElement, extras: Record<string, unknown> = {}): KeyboardEvent {
  const event = new Event('keydown', { cancelable: true }) as KeyboardEvent;
  for (const [name, value] of Object.entries({ key: 'Escape', target, ...extras })) {
    Object.defineProperty(event, name, { value });
  }
  act(() => browser.dispatch(event));
  return event;
}

function unmount(): void { act(() => view?.unmount()); view = undefined; }

describe('FullscreenPrompt within an IDE text viewport', () => {
  it('portals only to the supplied pane, without a document-wide modal', () => {
    mount();
    expect(vi.mocked(createPortal).mock.calls.at(-1)?.[1]).toBe(host);
    expect(view!.root.findAllByType('dialog')).toHaveLength(0);
    const reader = view!.root.findByProps({ role: 'dialog' });
    expect(reader.props['aria-modal']).not.toBe(true);
    expect(reader.props['aria-modal']).not.toBe('true');
    expect(reader.props['data-shortcut-scope']).toBe('dialog');
    expect(reader.props.className.split(' ')).toContain('bg-inherit');
    expect(view!.root.findByProps({ role: 'region' }).props.className).toContain(tone.pre);
    expect(doc.activeElement).toBe(body);
    expect(body.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('consumes Escape inside before the pre-existing IDE close listener can see it', () => {
    const closeIDE = vi.fn();
    browser.addEventListener('keydown', closeIDE);
    const { onClose } = mount();
    const event = key(body);
    expect(onClose).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(closeIDE).not.toHaveBeenCalled();
  });

  it.each([{ isComposing: true }, { keyCode: 229 }])('leaves IME Escape unhandled while shielding the IDE (%j)', (composition) => {
    const closeIDE = vi.fn();
    browser.addEventListener('keydown', closeIDE);
    const { onClose } = mount();
    const event = key(body, composition);
    expect(onClose).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(closeIDE).not.toHaveBeenCalled();
  });

  it('does not close repeatedly while Escape is held', () => {
    const { onClose } = mount();
    const event = key(body, { repeat: true });
    expect(onClose).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves Escape and focus in another IDE pane untouched', () => {
    const closeOtherPane = vi.fn();
    browser.addEventListener('keydown', closeOtherPane);
    const { onClose } = mount();
    const outside = new TestElement('other-pane-input', doc.body);
    outside.focus();
    const event = key(outside);
    expect(onClose).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(closeOtherPane).toHaveBeenCalledOnce();
    unmount();
    expect(doc.activeElement).toBe(outside);
    expect(opener.focus).not.toHaveBeenCalled();
  });

  it.each(['reader', 'document-body'])('returns focus to the opener on cleanup from %s and removes the key listener', (focused) => {
    const { onClose } = mount();
    if (focused === 'document-body') doc.activeElement = doc.body;
    unmount();
    expect(doc.activeElement).toBe(opener);
    expect(opener.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(browser.listeners).toHaveLength(0);
    key(body);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not restore focus to a removed opener', () => {
    mount();
    opener.isConnected = false;
    unmount();
    expect(opener.focus).not.toHaveBeenCalled();
  });

  it('keeps the sender, preview and complete prompt with back and copy icon controls', () => {
    const prompt = `첫 줄\n\n${'긴 본문 '.repeat(100)}\n마지막 줄\n`;
    const props = mount({ prompt });
    expect(view!.root.findByType('pre').children.join('')).toBe(prompt);
    const header = view!.root.findByType('header');
    expect(header.findByProps({ children: '나 · 오늘 14:32' })).toBeDefined();
    expect(header.findByProps({ children: props.preview })).toBeDefined();
    const [back, copy] = view!.root.findAllByType('button');
    expect(back!.props['aria-label']).toBe('ide.streamRenderer.promptReader.back');
    expect(back!.props.title).toBe('ide.streamRenderer.promptReader.back (Esc)');
    expect(back!.props.className.split(' ')).toContain('right-10');
    expect(copy!.props['aria-label']).toBe('ide.streamRenderer.copy');
    expect(copy!.props.title).toBe('ide.streamRenderer.copy');
    expect(copy!.props.className.split(' ')).toContain('right-2');
    for (const button of [back!, copy!]) {
      expect(button.children.filter((child) => typeof child === 'string')).toHaveLength(0);
      expect(button.findByType('svg').props['aria-hidden']).toBe('true');
    }
    act(() => copy!.props.onClick());
    expect(props.onCopy).toHaveBeenCalledOnce();
    expect(props.onClose).not.toHaveBeenCalled();
    act(() => view!.update(<FullscreenPrompt {...props} copied />));
    const copied = view!.root.findByProps({ 'aria-label': 'ide.streamRenderer.copied' });
    expect(copied.props.title).toBe('ide.streamRenderer.copied');
    expect(copied.props.className.split(' ')).toContain('right-2');
    expect(copied.findAllByType('svg')).toHaveLength(1);
    act(() => back!.props.onClick());
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it.each([1, 1.6])('keeps normal prompt layout and typography hooks with one shared zoom (%s)', (zoom) => {
    graph.ideTextZoom = zoom;
    mount();
    const stream = view!.root.findByProps({ 'data-ide-role': 'user' });
    expect(stream.props.className.split(' ')).toContain('ide-stream');
    expect(stream.props.style?.zoom).toBe(zoom === 1 ? undefined : zoom);
    expect(stream.findAllByType('button')).toHaveLength(2);
    expect(stream.findAll((node) => typeof node.type === 'string' && node.props.className?.split(' ').includes('ide-user-msg'))).toHaveLength(1);
    const pre = stream.findByType('pre');
    expect(pre.props.style?.zoom).toBeUndefined();
    expect(pre.props.className.split(' ')).toContain('ide-prompt-text');
    expect(pre.props['data-prompt-reader-body']).toBeDefined();
  });
});
