import type { ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDEContextMenu, type ContextMenuItem } from './IDEContextMenu.js';

vi.mock('react-dom', () => ({ createPortal: (children: ReactNode) => children }));
vi.mock('../ScrollFade.js', () => ({ ScrollFade: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('../Shortcuts/KeyHint.js', () => ({ KeyHint: () => null }));

let view: ReactTestRenderer | undefined;
let browser: EventTarget & { innerWidth: number; innerHeight: number };
let doc: { body: object; activeElement: TestElement | null };
const elements = new Map<string, TestElement>();

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) };
}

/** Minimal measured nodes; real menu handlers/effects and the dismissal hook still run. */
class TestElement extends EventTarget {
  style: Record<string, string> = {};
  disabled = false;
  inside = true;
  tagName = 'DIV';
  isContentEditable = false;
  width = 180;
  height = 72;
  constructor(readonly id: string, readonly role: string | undefined) { super(); }
  blur = vi.fn();
  focus = vi.fn(() => { if (doc.activeElement !== this) doc.activeElement?.blur(); doc.activeElement = this; });
  contains = (target: TestElement | null): boolean => !!target?.inside;
  closest = (): TestElement | null => {
    let instance = view?.root.findAllByType('button').find((button) => button.props.id === this.id)?.parent;
    while (instance && instance.props.role !== 'menu') instance = instance.parent;
    return instance?.instance ?? null;
  };
  querySelector = (selector: string): TestElement | null => selector === '[role="menu"]'
    ? panels()[0]?.instance ?? null : this.querySelectorAll()[0] ?? null;
  querySelectorAll = (): TestElement[] => {
    const panel = panels().find((candidate) => (candidate.props.id ?? 'root-menu') === this.id);
    return (panel ?? view?.root)?.findAllByType('button').filter((button) => !button.props.disabled).map((button) => button.instance) ?? [];
  };
  getBoundingClientRect = (): DOMRect => {
    if (this.role === 'menuitem') {
      const owner = this.closest();
      const parent = owner?.getBoundingClientRect() ?? rect(100, 100, 180, 72);
      const row = Number(this.id.slice(this.id.lastIndexOf('-') + 1));
      return rect(parent.left + 1, parent.top + 3 + row * 24, parent.width - 2, 24);
    }
    return rect(Number.parseFloat(this.style.left ?? '0'), Number.parseFloat(this.style.top ?? '0'),
      Math.min(this.width, Number.parseFloat(this.style.maxWidth ?? 'Infinity')),
      Math.min(this.height, Number.parseFloat(this.style.maxHeight ?? 'Infinity')));
  };
}

beforeEach(() => {
  elements.clear();
  browser = Object.assign(new EventTarget(), { innerWidth: 1000, innerHeight: 700 });
  doc = { body: {}, activeElement: null };
  vi.stubGlobal('window', browser);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('Element', TestElement);
  vi.stubGlobal('HTMLElement', TestElement);
});
afterEach(() => {
  act(() => view?.unmount());
  view = undefined;
  vi.unstubAllGlobals();
});

function mount(items: ContextMenuItem[], x = 100, y = 100): ReturnType<typeof vi.fn> {
  const onClose = vi.fn();
  act(() => {
    view = create(<IDEContextMenu x={x} y={y} items={items} onClose={onClose} density="compact" />, {
      createNodeMock: (element) => {
        const props = element.props as { id?: string; role?: string; disabled?: boolean };
        const id = props.id ?? (props.role === 'menu' ? 'root-menu' : 'boundary');
        let node = elements.get(id);
        if (!node) { node = new TestElement(id, props.role); elements.set(id, node); }
        node.disabled = !!props.disabled;
        return node;
      },
    });
  });
  return onClose;
}
function panels(): ReactTestInstance[] { return view?.root.findAll((item) => item.type === 'div' && item.props.role === 'menu') ?? []; }
function button(label: string): ReactTestInstance {
  return view!.root.findAllByType('button').find((item) => item.findAllByType('span').some((span) => span.children.join('') === label))!;
}
function click(label: string, detail = 1): void { act(() => button(label).props.onClick({ detail })); }
function hover(label: string): void { act(() => button(label).props.onMouseEnter()); }
function key(label: string, name: string, composing = false): ReturnType<typeof vi.fn> {
  const node = button(label).instance as TestElement;
  node.focus();
  const preventDefault = vi.fn();
  const owner = panels().find((panel) => panel.instance === node.closest())!;
  act(() => owner.props.onKeyDown({ key: name, target: node, nativeEvent: { isComposing: composing }, preventDefault, stopPropagation: vi.fn() }));
  return preventDefault;
}
function dispatch(type: string, props: Record<string, unknown> = {}): Event {
  const event = new Event(type, { cancelable: true });
  for (const [name, value] of Object.entries(props)) Object.defineProperty(event, name, { value });
  act(() => { browser.dispatchEvent(event); });
  return event;
}
function hideMenu(): { items: ContextMenuItem[]; parent: ReturnType<typeof vi.fn>; leaf: ReturnType<typeof vi.fn> } {
  const parent = vi.fn();
  const leaf = vi.fn();
  return { parent, leaf, items: [
    { id: 'hide', label: 'Hide', onClick: parent, children: [
      { label: 'Bubble', onClick: leaf },
      { label: 'Links', onClick: vi.fn() },
    ] },
    { label: 'Delete', onClick: vi.fn() },
  ] };
}

describe('IDEContextMenu nested items', () => {
  it('opens by hover or click without executing the parent, and closes only after a leaf action', () => {
    const menu = hideMenu();
    const onClose = mount(menu.items);
    expect(panels()).toHaveLength(1);
    expect(button('Hide').props['aria-haspopup']).toBe('menu');
    hover('Hide');
    expect(panels()).toHaveLength(2);
    click('Hide');
    expect(button('Hide').props['aria-expanded']).toBe(true);
    expect(menu.parent).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    click('Bubble');
    expect(menu.leaf).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps flat menus and disabled actions intact, including empty child arrays', () => {
    const action = vi.fn();
    const blocked = vi.fn();
    const onClose = mount([
      { label: 'Disabled', onClick: blocked, disabled: true, children: [{ label: 'Hidden child', onClick: blocked }] },
      { label: 'Flat', onClick: action, children: [] },
    ]);
    hover('Disabled');
    click('Disabled');
    expect(panels()).toHaveLength(1);
    expect(blocked).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    click('Flat');
    expect(action).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('supports additional nesting and replaces the open branch when a sibling is hovered', () => {
    const menu = hideMenu();
    menu.items[0]!.children!.push({ label: 'More', onClick: vi.fn(), children: [{ label: 'Future option', onClick: vi.fn() }] });
    mount(menu.items);
    hover('Hide');
    hover('More');
    expect(panels()).toHaveLength(3);
    hover('Links');
    expect(panels()).toHaveLength(2);
    hover('Delete');
    expect(panels()).toHaveLength(1);
  });

  it('preserves input focus for pointer use, then navigates enabled children with arrow keys', () => {
    const menu = hideMenu();
    menu.items[0]!.children!.unshift({ label: 'Unavailable', disabled: true, onClick: vi.fn() });
    const input = new TestElement('input', undefined);
    input.inside = false;
    input.tagName = 'INPUT';
    doc.activeElement = input;
    mount(menu.items);
    const preventDefault = vi.fn();
    view!.root.findAllByType('div').find((div) => div.props.onMouseDown)?.props.onMouseDown({ preventDefault });
    click('Hide');
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(doc.activeElement).toBe(input);
    dispatch('keydown', { key: 'ArrowDown' });
    expect(doc.activeElement).toBe(input);
    expect(input.blur).not.toHaveBeenCalled();
    doc.activeElement = null;
    dispatch('keydown', { key: 'ArrowDown' });
    expect(doc.activeElement).toBe(button('Hide').instance);
    key('Hide', 'ArrowRight');
    expect(doc.activeElement).toBe(button('Bubble').instance);
    key('Bubble', 'ArrowDown');
    expect(doc.activeElement).toBe(button('Links').instance);
    key('Links', 'ArrowDown');
    expect(doc.activeElement).toBe(button('Bubble').instance);
    key('Bubble', 'ArrowLeft');
    expect(panels()).toHaveLength(1);
    expect(doc.activeElement).toBe(button('Hide').instance);
  });

  it.each(['INPUT', 'TEXTAREA', 'contenteditable'])('keeps %s editing alive when arrows are pressed with a menu open', (kind) => {
    const input = new TestElement('editing', undefined);
    input.inside = false;
    input.tagName = kind === 'contenteditable' ? 'DIV' : kind;
    input.isContentEditable = kind === 'contenteditable';
    doc.activeElement = input;
    mount(hideMenu().items);
    hover('Hide');
    expect(dispatch('keydown', { key: 'ArrowUp' }).defaultPrevented).toBe(false);
    expect(dispatch('keydown', { key: 'ArrowDown' }).defaultPrevented).toBe(false);
    expect(doc.activeElement).toBe(input);
    expect(input.blur).not.toHaveBeenCalled();
  });

  it('enters the last root item with ArrowUp even when a submenu is already open', () => {
    mount(hideMenu().items);
    hover('Hide');
    dispatch('keydown', { key: 'ArrowUp' });
    expect(doc.activeElement).toBe(button('Delete').instance);
  });

  it('focuses the child for keyboard activation but leaves composing keys to the IME', () => {
    mount(hideMenu().items);
    expect(key('Hide', 'ArrowRight', true)).not.toHaveBeenCalled();
    expect(panels()).toHaveLength(1);
    click('Hide', 0);
    expect(doc.activeElement).toBe(button('Bubble').instance);
  });

  it('includes descendants in outside dismissal and preserves Escape composition protection', () => {
    const onClose = mount(hideMenu().items);
    hover('Hide');
    dispatch('mousedown', { target: button('Bubble').instance, clientX: 300, clientY: 120 });
    expect(onClose).not.toHaveBeenCalled();
    const outside = new TestElement('outside', undefined);
    outside.inside = false;
    dispatch('mousedown', { target: outside, clientX: 20, clientY: 20 });
    expect(onClose).not.toHaveBeenCalled(); // A gesture that began inside still owns the press.
    dispatch('mouseup');
    dispatch('mousedown', { target: outside, clientX: 20, clientY: 20 });
    expect(onClose).toHaveBeenCalledTimes(1);
    dispatch('keydown', { key: 'Escape', isComposing: true });
    expect(onClose).toHaveBeenCalledTimes(1);
    dispatch('keydown', { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('clamps the root and opens children on the left at the right edge, resizing on narrow screens', () => {
    mount(hideMenu().items, 980, 680);
    const root = panels()[0]!.instance as TestElement;
    expect(root.style).toMatchObject({ left: '812px', top: '620px' });
    hover('Hide');
    const child = panels()[1]!.instance as TestElement;
    expect(child.style.left).toBe('633px');
    expect(child.getBoundingClientRect().right).toBeLessThanOrEqual(root.getBoundingClientRect().left + 1);
    browser.innerWidth = 160;
    browser.innerHeight = 220;
    dispatch('resize');
    expect(root.getBoundingClientRect().right).toBeLessThanOrEqual(152);
    expect(child.getBoundingClientRect().right).toBeLessThanOrEqual(152);
    expect(child.getBoundingClientRect().bottom).toBeLessThanOrEqual(212);
    expect(child.getBoundingClientRect().top).toBeGreaterThanOrEqual(8);
  });
});
