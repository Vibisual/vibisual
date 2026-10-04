import { createElement, useLayoutEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmenuKey } from './contextMenuSubmenu.js';
import { useCanvasMenuPlacement } from './useCanvasMenuPlacement.js';

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) };
}

/** Model the browser applying inline size constraints before the next measurement. */
class Box extends EventTarget {
  style: Record<string, string> = {};
  scrollTop = 0;
  constructor(public width: number, public height: number) { super(); }
  getBoundingClientRect = vi.fn((): DOMRect => rect(
    Number.parseFloat(this.style.left ?? '0'), Number.parseFloat(this.style.top ?? '0'),
    Math.min(this.width, Number.parseFloat(this.style.maxWidth ?? 'Infinity')),
    Math.min(this.height, Number.parseFloat(this.style.maxHeight ?? 'Infinity')),
  ));
}

class ObservedResize {
  static instances: ObservedResize[] = [];
  observe = vi.fn<(element: Element) => void>();
  disconnect = vi.fn();
  constructor(readonly notify: () => void) { ObservedResize.instances.push(this); }
}

const renderers = new Set<ReactTestRenderer>();
let viewport: EventTarget & { offsetLeft: number; offsetTop: number; width: number; height: number };
let browser: EventTarget & { innerWidth: number; innerHeight: number; visualViewport: typeof viewport | undefined };

beforeEach(() => {
  viewport = Object.assign(new EventTarget(), { offsetLeft: 0, offsetTop: 0, width: 1000, height: 700 });
  browser = Object.assign(new EventTarget(), { innerWidth: 1000, innerHeight: 700, visualViewport: viewport });
  ObservedResize.instances = [];
  vi.stubGlobal('window', browser);
  vi.stubGlobal('ResizeObserver', ObservedResize);
});

afterEach(() => {
  act(() => { for (const renderer of renderers) renderer.unmount(); });
  renderers.clear();
  vi.unstubAllGlobals();
});

function mount(x = 980, y = 680, open: SubmenuKey | null = 'codex') {
  const menu = new Box(200, 240);
  const list = new Box(200, 240);
  const trigger = new Box(192, 40);
  const child = new Box(260, 300);
  let rowOffset = 60;
  const measuredMenu = menu.getBoundingClientRect.getMockImplementation()!;
  menu.getBoundingClientRect.mockImplementation(() => {
    const bounds = measuredMenu();
    return rect(bounds.left, bounds.top, bounds.width, list.getBoundingClientRect().height);
  });
  // A real row follows both its positioned parent and the scrollable list.
  trigger.getBoundingClientRect.mockImplementation(() => {
    const parent = menu.getBoundingClientRect();
    return rect(parent.left + 4, parent.top + rowOffset - list.scrollTop, parent.width - 8, trigger.height);
  });
  const menuRef = { current: menu as unknown as HTMLDivElement };
  const listRef = { current: list as unknown as HTMLDivElement };
  const triggerRef = { current: open ? trigger as unknown as HTMLButtonElement : null };
  const childRef = { current: open ? child as unknown as HTMLDivElement : null };
  const beforePaint: { menu: string[]; child: string[] }[] = [];
  let side: ReturnType<typeof useCanvasMenuPlacement> = 'right';
  let renderer: ReactTestRenderer;
  function Probe(props: { x: number; y: number; open: SubmenuKey | null }): null {
    side = useCanvasMenuPlacement(props.x, props.y, props.open, menuRef, listRef, triggerRef, childRef);
    useLayoutEffect(() => {
      beforePaint.push({ menu: [menu.style.left!, menu.style.top!], child: [child.style.left!, child.style.top!] });
    });
    return null;
  }
  act(() => { renderer = create(createElement(Probe, { x, y, open })); renderers.add(renderer); });
  return {
    menu, list, trigger, child, beforePaint, get side() { return side; },
    get rowOffset() { return rowOffset; },
    set rowOffset(value: number) { rowOffset = value; },
    update(next: { x: number; y: number; open: SubmenuKey | null }): void {
      triggerRef.current = next.open ? trigger as unknown as HTMLButtonElement : null;
      childRef.current = next.open ? child as unknown as HTMLDivElement : null;
      act(() => renderer.update(createElement(Probe, next)));
    },
    unmount(): void { act(() => renderer.unmount()); renderers.delete(renderer); },
  };
}

function dispatch(target: EventTarget, type: string): void {
  act(() => { target.dispatchEvent(new Event(type)); });
}

describe('useCanvasMenuPlacement', () => {
  it('positions before paint and anchors the child to the already-clamped parent', () => {
    const h = mount();
    // A passive effect or measuring the row before moving its parent fails this snapshot.
    expect(h.beforePaint[0]).toEqual({ menu: ['792px', '452px'], child: ['536px', '392px'] });
    expect(h.side).toBe('left');
    expect(h.menu.style.maxWidth).toBe('984px');
    expect(h.list.style.maxHeight).toBe('684px');
  });

  it('prefers the right side when it fits and flips after the pointer moves to the right edge', () => {
    const h = mount(50, 100);
    expect(h.side).toBe('right');
    expect(h.child.style.left).toBe('246px');
    expect(h.child.style.top).toBe('160px');
    h.update({ x: 980, y: 100, open: 'codex' });
    expect(h.side).toBe('left');
    expect(h.child.style.left).toBe('536px');
    expect(h.child.style.top).toBe('160px');
    expect(ObservedResize.instances[0]!.disconnect).toHaveBeenCalledOnce();
  });

  it('uses window resize without visualViewport and constrains both menus on narrow screens', () => {
    browser.visualViewport = undefined;
    const h = mount();
    browser.innerWidth = 180;
    browser.innerHeight = 220;
    dispatch(browser, 'resize');
    expect(h.menu.style).toMatchObject({ maxWidth: '164px', left: '8px', top: '8px' });
    expect(h.list.style.maxHeight).toBe('204px');
    expect(h.child.style).toMatchObject({ maxWidth: '164px', maxHeight: '104px', minWidth: 'min(16rem, 164px)', left: '8px', top: '108px' });
    expect(h.side).toBe('below');
    expect(h.child.getBoundingClientRect().top).toBeGreaterThanOrEqual(h.trigger.getBoundingClientRect().bottom);
    expect(h.menu.getBoundingClientRect().right).toBe(172);
    expect(h.child.getBoundingClientRect().bottom).toBe(212);
    h.rowOffset = 160;
    h.update({ x: 980, y: 680, open: 'apps' });
    expect(h.child.style.minWidth).toBe('min(18rem, 164px)');
    expect(h.side).toBe('above');
    expect(h.child.getBoundingClientRect().top).toBeGreaterThanOrEqual(8);
    expect(h.child.getBoundingClientRect().bottom).toBeLessThanOrEqual(h.trigger.getBoundingClientRect().top);
  });

  it('tracks the visual viewport size and panning offset', () => {
    const h = mount(10, 10);
    Object.assign(viewport, { width: 500, height: 400, offsetLeft: 100, offsetTop: 200 });
    dispatch(viewport, 'resize');
    expect(h.menu.style).toMatchObject({ left: '108px', top: '208px', maxWidth: '484px' });
    expect(h.child.style).toMatchObject({ left: '304px', top: '268px', maxHeight: '384px' });
    viewport.offsetLeft = 200;
    viewport.offsetTop = 250;
    dispatch(viewport, 'scroll');
    expect(h.menu.style).toMatchObject({ left: '208px', top: '258px' });
    expect(h.child.style).toMatchObject({ left: '404px', top: '318px' });
  });

  it('remeasures changing content through ResizeObserver without a window resize', () => {
    const h = mount();
    const observer = ObservedResize.instances.at(-1)!;
    expect(observer.observe.mock.calls.map(([element]) => element)).toEqual([h.menu, h.list, h.trigger, h.child]);
    h.menu.width = 320;
    h.list.height = 500;
    h.child.height = 600;
    act(() => observer.notify());
    expect(h.menu.style).toMatchObject({ left: '672px', top: '192px' });
    expect(h.child.style).toMatchObject({ left: '416px', top: '92px' });
    h.child.height = 900;
    act(() => observer.notify());
    expect(h.child.style.top).toBe('8px');
    expect(h.child.getBoundingClientRect().height).toBe(684);
  });

  it('keeps a fixed child attached to its row while the parent list scrolls', () => {
    const h = mount(50, 100);
    h.list.scrollTop = 45;
    dispatch(h.list, 'scroll');
    expect(h.menu.style.top).toBe('100px');
    expect(h.child.style).toMatchObject({ left: '246px', top: '115px' });
  });

  it('remeasures a moved row on render even when the capped parent dimensions do not change', () => {
    const h = mount(50, 100);
    h.list.height = 900;
    act(() => ObservedResize.instances.at(-1)!.notify());
    expect(h.menu.style.top).toBe('8px');
    expect(h.child.style.top).toBe('68px');
    h.rowOffset = 140;
    h.update({ x: 50, y: 100, open: 'codex' });
    expect(h.menu.style.top).toBe('8px');
    expect(h.child.style.top).toBe('148px');
  });

  it('measures a newly opened child and removes observers and all listeners when closed', () => {
    const browserRemove = vi.spyOn(browser, 'removeEventListener');
    const viewportRemove = vi.spyOn(viewport, 'removeEventListener');
    const h = mount(50, 100, null);
    expect(h.child.getBoundingClientRect).not.toHaveBeenCalled();
    h.update({ x: 50, y: 100, open: 'codex' });
    expect(h.child.style).toMatchObject({ left: '246px', top: '160px' });
    const listRemove = vi.spyOn(h.list, 'removeEventListener');
    const observer = ObservedResize.instances.at(-1)!;
    h.unmount();
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(browserRemove).toHaveBeenCalledWith('resize', observer.notify);
    expect(viewportRemove).toHaveBeenCalledWith('resize', observer.notify);
    expect(viewportRemove).toHaveBeenCalledWith('scroll', observer.notify);
    expect(listRemove).toHaveBeenCalledWith('scroll', observer.notify);
    h.menu.getBoundingClientRect.mockClear();
    dispatch(browser, 'resize');
    dispatch(viewport, 'resize');
    dispatch(viewport, 'scroll');
    dispatch(h.list, 'scroll');
    expect(h.menu.getBoundingClientRect).not.toHaveBeenCalled();
  });
});
