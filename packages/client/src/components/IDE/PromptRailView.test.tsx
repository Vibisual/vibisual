import type { ComponentProps, ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptRail } from './PromptRailView.js';

vi.mock('react-dom', () => ({ createPortal: (children: ReactNode) => children }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
vi.mock('../../utils/inspector.js', () => ({
  visualClientRect: (element: HTMLElement) => element.getBoundingClientRect(), visualRectScale: () => 1,
}));

class TestElement extends EventTarget {
  clientWidth = 390;
  scrollTop = 100;
  focus = vi.fn();
  constructor(readonly parent: TestElement | null = null) { super(); }
  contains(target: TestElement | null): boolean {
    for (let node = target; node; node = node.parent) if (node === this) return true;
    return false;
  }
  getBoundingClientRect = (): DOMRect => ({
    x: 200, y: 100, left: 200, top: 100, right: 200 + this.clientWidth, bottom: 180,
    width: this.clientWidth, height: 80, toJSON: () => ({}),
  });
}
class TestResizeObserver {
  target: TestElement | null = null;
  constructor(readonly callback: ResizeObserverCallback) { observers.push(this); }
  observe(target: TestElement): void { this.target = target; }
  disconnect(): void { this.target = null; }
}

let view: ReactTestRenderer | undefined;
let browser: EventTarget & { innerWidth: number; innerHeight: number };
let media: EventTarget & { matches: boolean };
let host: TestElement;
let rail: TestElement;
let track: TestElement;
let scroll: TestElement;
let observers: TestResizeObserver[];
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
const label = (name: string): string => `ide.mainArea.${name}`;
const buttons = (name: string): ReactTestInstance[] => view!.root.findAll((el) => el.type === 'button' && el.props['aria-label'] === label(name));
const toggle = (): ReactTestInstance => buttons('promptRail')[0]!;
const click = (name: string): void => { act(() => buttons(name)[0]!.props.onClick()); };
const isExpanded = (): boolean => toggle().props['aria-expanded'] === true;

beforeEach(() => {
  host = new TestElement(); rail = new TestElement(host); track = new TestElement(rail); scroll = new TestElement();
  observers = []; frames = new Map(); frameId = 0;
  media = Object.assign(new EventTarget(), { matches: false });
  browser = Object.assign(new EventTarget(), {
    innerWidth: 1200, innerHeight: 800, matchMedia: () => media,
    requestAnimationFrame: (callback: FrameRequestCallback): number => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id: number): void => { frames.delete(id); },
  });
  vi.stubGlobal('window', browser);
  vi.stubGlobal('document', { body: new TestElement() });
  vi.stubGlobal('Element', TestElement);
  vi.stubGlobal('HTMLElement', TestElement);
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
});
afterEach(() => {
  act(() => view?.unmount()); view = undefined;
  vi.unstubAllGlobals();
});

function mount(overrides: Partial<ComponentProps<typeof PromptRail>> = {}): ComponentProps<typeof PromptRail> {
  const props: ComponentProps<typeof PromptRail> = {
    prompts: ['a', 'b', 'c'].map((id) => ({ id, text: `Prompt ${id}` })),
    probe: () => ({ ownerId: 'a', anchored: true, lastVisibleId: 'b', atBottom: false }),
    scrollEl: scroll as unknown as HTMLElement,
    onJumpToPrompt: vi.fn(), onJumpToTop: vi.fn(), onJumpToBottom: vi.fn(), showJumpBottom: false,
    ...overrides,
  };
  act(() => { view = create(<PromptRail {...props} />, { createNodeMock: (element) => {
    const attributes = element.props as Record<string, unknown>;
    return attributes.role === 'group' ? rail : attributes.onPointerMove ? track
      : element.type === 'button' ? new TestElement(rail) : host;
  } }); });
  act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(0)); });
  return props;
}
function dispatch(target: EventTarget, type: string, attributes: Record<string, unknown> = {}): void {
  const event = new Event(type);
  for (const [key, value] of Object.entries(attributes)) Object.defineProperty(event, key, { value });
  act(() => { target.dispatchEvent(event); });
}
function resize(width: number): void {
  host.clientWidth = width;
  act(() => observers.forEach((observer) => {
    if (observer.target) observer.callback([{ target: observer.target, borderBoxSize: [{ inlineSize: width }] }] as unknown as ResizeObserverEntry[], observer as unknown as ResizeObserver);
  }));
}

describe('PromptRail responsive disclosure', () => {
  it('keeps a single prompt reachable without displaying the full rail by default', () => {
    mount({ prompts: [{ id: 'a', text: 'One prompt' }] });
    expect(isExpanded()).toBe(false);
    expect(view!.root.findAllByType('button')).toHaveLength(1);
    click('promptRail');
    expect(isExpanded()).toBe(true);
    expect(buttons('jumpToTop')).toHaveLength(1);
    expect(buttons('promptPrev')).toHaveLength(1);
    expect(buttons('promptNext')).toHaveLength(1);
    click('promptRail');
    expect(isExpanded()).toBe(false);
  });

  it('offers a direct bottom jump while collapsed when newer content is below', () => {
    const props = mount({ showJumpBottom: true });
    expect(isExpanded()).toBe(false);
    expect(buttons('jumpToBottom')[0]!.props.disabled).toBe(false);
    click('jumpToBottom');
    expect(props.onJumpToBottom).toHaveBeenCalledOnce();
    expect(isExpanded()).toBe(false);
  });

  it.each(['promptNext', 'jumpToTop', 'jumpToBottom'])('closes after %s navigation', (action) => {
    const props = mount({ showJumpBottom: true });
    click('promptRail'); click(action);
    expect(isExpanded()).toBe(false);
    if (action === 'promptNext') expect(props.onJumpToPrompt).toHaveBeenCalledWith('b');
    else if (action === 'jumpToTop') expect(props.onJumpToTop).toHaveBeenCalledOnce();
    else expect(props.onJumpToBottom).toHaveBeenCalledOnce();
  });

  it.each(['left', 'right'])('jumps from the horizontal track %s edge and closes', (edge) => {
    const props = mount(); click('promptRail');
    const bounds = track.getBoundingClientRect();
    const marker = view!.root.findAll((el) => el.type === 'div' && typeof el.props.onPointerMove === 'function')[0]!;
    act(() => marker.props.onClick({ clientX: edge === 'left' ? bounds.left : bounds.right, clientY: edge === 'left' ? bounds.bottom : bounds.top }));
    expect(props.onJumpToPrompt).toHaveBeenCalledWith(edge === 'left' ? 'a' : 'c');
    expect(isExpanded()).toBe(false);
  });

  it.each(['wheel', 'touchstart', 'keydown'])('closes when the conversation receives %s', (event) => {
    mount(); click('promptRail'); dispatch(scroll, event, { key: 'ArrowDown' });
    expect(isExpanded()).toBe(false);
  });

  it('keeps navigation open while streamed content scrolls automatically', () => {
    mount(); click('promptRail'); dispatch(scroll, 'scroll');
    expect(isExpanded()).toBe(true);
  });

  it('keeps inside presses open and closes on an outside press after release', () => {
    mount(); click('promptRail');
    dispatch(browser, 'pointerdown', { target: rail, clientX: 220, clientY: 120 });
    expect(isExpanded()).toBe(true);
    dispatch(browser, 'pointerup');
    dispatch(browser, 'pointerdown', { target: scroll, clientX: 20, clientY: 120 });
    expect(isExpanded()).toBe(false);
  });

  it('closes on Escape without passing it to the surrounding window', () => {
    mount(); click('promptRail');
    const event = { key: 'Escape', stopPropagation: vi.fn(), preventDefault: vi.fn() };
    const wrapper = view!.root.findAll((el) => el.type === 'div' && typeof el.props.onKeyDown === 'function')[0]!;
    act(() => wrapper.props.onKeyDown(event));
    expect(isExpanded()).toBe(false);
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });

  it('preserves the full desktop rail and resets disclosure when the pane shrinks again', () => {
    mount(); click('promptRail'); resize(900);
    expect(buttons('promptRail')).toHaveLength(0);
    expect(buttons('promptNext')).toHaveLength(1);
    expect(buttons('jumpToBottom')[0]!.props.disabled).toBe(true);
    resize(390);
    expect(isExpanded()).toBe(false);
  });

  it('uses the phone viewport before the conversation width is measured', () => {
    host.clientWidth = 0; media.matches = true; mount();
    expect(isExpanded()).toBe(false);
  });

  it('does not open hover previews for touch pointers', () => {
    mount(); click('promptRail');
    act(() => buttons('promptNext')[0]!.props.onPointerEnter({ pointerType: 'touch' }));
    const marker = view!.root.findAll((el) => el.type === 'div' && typeof el.props.onPointerMove === 'function')[0]!;
    act(() => marker.props.onPointerMove({ pointerType: 'touch', clientX: 400, clientY: 140 }));
    expect(view!.root.findAllByProps({ role: 'tooltip' })).toHaveLength(0);
    act(() => buttons('promptNext')[0]!.props.onPointerEnter({ pointerType: 'mouse' }));
    expect(view!.root.findAllByProps({ role: 'tooltip' })).toHaveLength(1);
    click('promptRail');
    expect(view!.root.findAllByProps({ role: 'tooltip' })).toHaveLength(0);
  });

  it('shows no empty disclosure and preserves bottom navigation without prompts', () => {
    const props = mount({ prompts: [] });
    expect(view!.root.findAllByType('button')).toHaveLength(0);
    act(() => view!.update(<PromptRail {...props} showJumpBottom />));
    expect(buttons('promptRail')).toHaveLength(0);
    expect(buttons('jumpToBottom')).toHaveLength(1);
  });
});
