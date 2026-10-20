import type { ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDialogHost } from './AppDialogHost.js';
import { alertDialog, answerAppDialog, confirmDialog, getAppDialog, installAppDialogKeyboardGuard, promptDialog } from '../../utils/appDialog.js';
import { installInputCompositionGuard } from '../../utils/inputComposition.js';

vi.mock('react-dom', () => ({ createPortal: (children: ReactNode) => children }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

class TestElement extends EventTarget {
  isConnected = true;
  readonly tagName: string;
  readonly select = vi.fn();
  constructor(readonly type: string, readonly dialogId = 0, readonly label = '') {
    super();
    this.tagName = type.toUpperCase();
  }
  focus(): void {
    doc.activeElement = this;
    emit(doc, 'focusin', this);
  }
  contains(node: TestElement | null): boolean { return node === this || !!this.dialogId && node?.dialogId === this.dialogId; }
  getAttribute(): null { return null; }
}

let doc: EventTarget & { activeElement: TestElement | null; body: TestElement };
let browser: EventTarget & { innerWidth: number; innerHeight: number; requestAnimationFrame: (fn: FrameRequestCallback) => number; cancelAnimationFrame: (id: number) => void };
let view: ReactTestRenderer | undefined;
let previous: TestElement;
let nodes: TestElement[];
let backgroundKey: ReturnType<typeof vi.fn<(event: Event) => void>>;
let disposeComposition: () => void;
let frames: Map<number, FrameRequestCallback>;

function emit(target: EventTarget, type: string, eventTarget: TestElement | null, values: Record<string, unknown> = {}): Event {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'target', { value: eventTarget });
  for (const [name, value] of Object.entries(values)) Object.defineProperty(event, name, { value });
  target.dispatchEvent(event);
  return event;
}
function key(value: string, extras: Record<string, unknown> = {}): Event {
  let event!: Event;
  act(() => { event = emit(browser, 'keydown', doc.activeElement, { key: value, ...extras }); });
  return event;
}
function node(type: string, label?: string): TestElement {
  return [...nodes].reverse().find((item) => item.type === type && (label === undefined || item.label === label))!;
}
function open<T>(ask: () => Promise<T>): Promise<T> {
  let result!: Promise<T>;
  act(() => { result = ask(); });
  return result;
}

beforeEach(() => {
  nodes = [];
  frames = new Map();
  let frameId = 0;
  browser = Object.assign(new EventTarget(), {
    innerWidth: 1000, innerHeight: 800,
    requestAnimationFrame: (fn: FrameRequestCallback) => { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame: (id: number) => { frames.delete(id); },
  });
  previous = new TestElement('textarea');
  doc = Object.assign(new EventTarget(), { activeElement: previous as TestElement | null, body: new TestElement('body') });
  vi.stubGlobal('window', browser);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('HTMLElement', TestElement);
  disposeComposition = installInputCompositionGuard(browser as unknown as Window);
  installAppDialogKeyboardGuard(browser as unknown as Window);
  backgroundKey = vi.fn<(event: Event) => void>();
  browser.addEventListener('keydown', backgroundKey, true);
  act(() => {
    view = create(<AppDialogHost />, {
      createNodeMock(element) {
        const props = element.props as { children?: unknown };
        const result = new TestElement(String(element.type), getAppDialog()?.id, String(props.children ?? ''));
        nodes.push(result);
        return result;
      },
    });
  });
});

afterEach(() => {
  act(() => view?.unmount());
  view = undefined;
  while (getAppDialog()) answerAppDialog(getAppDialog()!.id, null);
  disposeComposition();
  vi.unstubAllGlobals();
});

describe('common designed dialog host', () => {
  it('renders nothing while idle', () => {
    expect(view!.toJSON()).toBeNull();
  });

  it('starts confirmation on Cancel, so Enter safely cancels and restores previous focus', async () => {
    const result = open(() => confirmDialog('Discard unsaved edits?', { tone: 'danger' }));
    expect(doc.activeElement).toBe(node('button', 'common.cancel'));
    expect(view!.root.findByProps({ role: 'alertdialog' }).props['aria-modal']).toBe('true');
    expect(key('Enter').defaultPrevented).toBe(true);
    await expect(result).resolves.toBe(false);
    expect(doc.activeElement).toBe(previous);
    expect(backgroundKey).not.toHaveBeenCalled();
  });

  it('focuses and selects the prompt default, then submits the current empty input distinctly from cancellation', async () => {
    const result = open(() => promptDialog('Name', 'Existing'));
    const input = node('input');
    expect(doc.activeElement).toBe(input);
    expect(input.select).toHaveBeenCalledOnce();
    expect(view!.root.findByType('input').props.value).toBe('Existing');
    act(() => view!.root.findByType('input').props.onChange({ target: { value: '' } }));
    key('Enter');
    await expect(result).resolves.toBe('');
    const cancelled = open(() => promptDialog('Name', 'Existing'));
    key('Escape');
    await expect(cancelled).resolves.toBeNull();
  });

  it('renders provided labels and allows explicit confirmation', async () => {
    const result = open(() => confirmDialog('Unsaved changes', { title: 'Close editor', confirmLabel: 'Discard', cancelLabel: 'Keep editing', tone: 'danger' }));
    expect(view!.root.findByType('h2').children).toEqual(['Close editor']);
    const accept = view!.root.findAllByType('button').find((button) => button.children[0] === 'Discard')!;
    expect(accept.props.className).toContain('bg-red-800');
    act(() => accept.props.onClick());
    await expect(result).resolves.toBe(true);
  });

  it('cycles Tab and Shift+Tab within prompt controls and catches background focus changes', () => {
    void open(() => promptDialog('Name'));
    const input = node('input');
    const cancel = node('button', 'common.cancel');
    const accept = node('button', 'common.confirm');
    key('Tab', { shiftKey: true });
    expect(doc.activeElement).toBe(accept);
    key('Tab');
    expect(doc.activeElement).toBe(input);
    key('Tab');
    expect(doc.activeElement).toBe(cancel);
    key('Tab');
    expect(doc.activeElement).toBe(accept);
    act(() => previous.focus());
    expect(doc.activeElement).toBe(input);
    expect(backgroundKey).not.toHaveBeenCalled();
  });

  it('ignores repeated Escape/Enter so holding a key cannot answer the next queued dialog', async () => {
    const first = open(() => confirmDialog('First'));
    const second = open(() => confirmDialog('Second'));
    const firstId = getAppDialog()!.id;
    key('Escape', { repeat: true });
    expect(getAppDialog()!.id).toBe(firstId);
    key('Escape');
    await expect(first).resolves.toBe(false);
    const secondId = getAppDialog()!.id;
    key('Enter', { repeat: true });
    expect(getAppDialog()!.id).toBe(secondId);
    key('Escape', { repeat: true });
    expect(getAppDialog()!.id).toBe(secondId);
    key('Escape');
    await expect(second).resolves.toBe(false);
  });

  it('does not let a stale button double-click answer the following prompt', async () => {
    const first = open(() => confirmDialog('First'));
    const second = open(() => promptDialog('Second', 'new seed'));
    const staleAccept = view!.root.findAllByType('button')[1]!.props.onClick as () => void;
    act(staleAccept);
    await expect(first).resolves.toBe(true);
    expect(view!.root.findByType('input').props.value).toBe('new seed');
    act(staleAccept);
    expect(getAppDialog()!.message).toBe('Second');
    key('Enter');
    await expect(second).resolves.toBe('new seed');
  });

  it.each(['Enter', 'Escape', 'Tab'])('leaves IME %s to native composition and never runs background shortcuts', (value) => {
    void open(() => promptDialog('Name'));
    const input = node('input');
    const id = getAppDialog()!.id;
    const event = key(value, { isComposing: true, keyCode: 229 });
    expect(event.defaultPrevented).toBe(false);
    expect(getAppDialog()!.id).toBe(id);
    expect(doc.activeElement).toBe(input);
    expect(backgroundKey).not.toHaveBeenCalled();
  });

  it('does not submit the composition-end settling Enter until the next frame', async () => {
    const result = open(() => promptDialog('Name', '한글'));
    const input = node('input');
    emit(browser, 'compositionstart', input);
    emit(browser, 'compositionend', input);
    expect(key('Enter').defaultPrevented).toBe(false);
    expect(getAppDialog()).not.toBeNull();
    for (const [id, fn] of frames) { frames.delete(id); fn(0); }
    key('Enter');
    await expect(result).resolves.toBe('한글');
  });

  it('blocks underlying capture commands while allowing ordinary input browser defaults', () => {
    void open(() => promptDialog('Name'));
    expect(key('a').defaultPrevented).toBe(false);
    expect(key('s', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(backgroundKey).not.toHaveBeenCalled();
    key('Escape');
    key('s', { ctrlKey: true });
    expect(backgroundKey).toHaveBeenCalledOnce();
  });

  it('focuses the single alert action and acknowledges it on Enter', async () => {
    const result = open(() => alertDialog('Complete'));
    expect(view!.root.findAllByType('button')).toHaveLength(1);
    expect(doc.activeElement).toBe(node('button', 'common.confirm'));
    key('Tab');
    expect(doc.activeElement).toBe(node('button', 'common.confirm'));
    key('Enter');
    await expect(result).resolves.toBeUndefined();
  });
});
