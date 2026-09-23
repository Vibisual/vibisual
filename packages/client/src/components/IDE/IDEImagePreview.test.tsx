import { createElement, type ComponentProps } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDEImagePreview } from './IDEImagePreview.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

type PreviewProps = ComponentProps<typeof IDEImagePreview>;
type Size = { width: number; height: number };
const mounted = new Set<ReactTestRenderer>();

afterEach(() => {
  act(() => mounted.forEach((renderer) => renderer.unmount()));
  mounted.clear();
});

function wheel(deltaY: number, ctrlKey = true): Event {
  return Object.assign(new Event('wheel', { cancelable: true, bubbles: true }), {
    deltaY, ctrlKey, deltaMode: 0, clientX: 200, clientY: 100,
  });
}

function fixture(initial: Partial<PreviewProps> = {}) {
  let renderer!: ReactTestRenderer;
  let viewport!: EventTarget & { scrollLeft: number; scrollTop: number; clientHeight: number };
  const image = {
    naturalWidth: 1600,
    naturalHeight: 800,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 200 }),
  };
  const onNatural = vi.fn();
  const onOpen = vi.fn();
  let props: PreviewProps = { url: 'blob:first', status: 'ready', fit: true, onNatural, onOpen, ...initial };
  act(() => {
    renderer = create(createElement(IDEImagePreview, props), {
      createNodeMock: (node) => {
        if (node.type === 'img') return image;
        if (node.type === 'div' && node.props.className.includes('bg-alpha-checker')) {
          viewport = Object.assign(new EventTarget(), { scrollLeft: 0, scrollTop: 0, clientHeight: 300 });
          vi.spyOn(viewport, 'addEventListener');
          return viewport;
        }
        return null;
      },
    });
  });
  mounted.add(renderer);
  return {
    renderer, image, onNatural, onOpen,
    get viewport() { return viewport; },
    size: () => renderer.root.findByType('img').props.style as Size | undefined,
    scroll: (deltaY: number, ctrlKey = true) => {
      const event = wheel(deltaY, ctrlKey);
      act(() => { viewport.dispatchEvent(event); });
      return event;
    },
    update: (next: Partial<PreviewProps>) => {
      props = { ...props, ...next };
      act(() => renderer.update(createElement(IDEImagePreview, props)));
    },
    unmount: () => {
      act(() => renderer.unmount());
      mounted.delete(renderer);
    },
  };
}

describe('IDEImagePreview wheel zoom', () => {
  it('zooms from the displayed fitted size, preserving the aspect ratio and consuming Ctrl+wheel', () => {
    const h = fixture();
    expect(h.viewport.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false });
    const up = h.scroll(-100);
    const enlarged = h.size()!;
    expect(up.defaultPrevented).toBe(true);
    expect(enlarged.width).toBeGreaterThan(400);
    expect(enlarged.width).toBeLessThan(h.image.naturalWidth);
    expect(enlarged.width / enlarged.height).toBe(2);

    const down = h.scroll(100);
    expect(down.defaultPrevented).toBe(true);
    expect(h.size()!.width).toBeLessThan(enlarged.width);
    expect(h.size()!.width).toBeCloseTo(400);
    expect(h.size()!.height).toBeCloseTo(200);
  });

  it('leaves ordinary scrolling and horizontal-only Ctrl+wheel untouched', () => {
    const h = fixture();
    expect(h.scroll(-100, false).defaultPrevented).toBe(false);
    expect(h.scroll(0).defaultPrevented).toBe(false);
    expect(h.size()).toBeUndefined();
  });

  it('accumulates rapid wheel input before React commits as well as separately committed input', () => {
    const rapid = fixture();
    const separate = fixture();
    act(() => {
      rapid.viewport.dispatchEvent(wheel(-100));
      rapid.viewport.dispatchEvent(wheel(-100));
      rapid.viewport.dispatchEvent(wheel(-100));
    });
    separate.scroll(-100);
    const singleWidth = separate.size()!.width;
    separate.scroll(-100);
    separate.scroll(-100);
    expect(rapid.size()!.width).toBeGreaterThan(singleWidth);
    expect(rapid.size()!.width).toBeCloseTo(separate.size()!.width);
    expect(rapid.size()!.height).toBeCloseTo(separate.size()!.height);
  });

  it('resets manual zoom and scrolling for fit commands and another image', () => {
    const h = fixture();
    h.scroll(-100);
    h.viewport.scrollLeft = 90;
    h.viewport.scrollTop = 50;
    h.update({ fit: false });
    expect(h.size()).toBeUndefined();
    expect(h.viewport.scrollLeft).toBe(0);
    expect(h.viewport.scrollTop).toBe(0);

    h.scroll(-100);
    h.update({ fit: true });
    expect(h.size()).toBeUndefined();
    h.scroll(-100);
    h.update({ url: 'blob:second' });
    expect(h.size()).toBeUndefined();
    expect(h.scroll(-100).defaultPrevented).toBe(true);
    expect(h.size()!.width).toBeGreaterThan(400);
  });

  it('attaches after loading, removes the old listener during reload, and cleans up on unmount', () => {
    const h = fixture({ url: null, status: 'loading' });
    expect(h.renderer.root.findAllByType('img')).toHaveLength(0);
    h.update({ url: 'blob:loaded', status: 'ready' });
    expect(h.scroll(-100).defaultPrevented).toBe(true);
    const oldViewport = h.viewport;

    h.update({ url: null, status: 'loading' });
    const staleWheel = wheel(-100);
    oldViewport.dispatchEvent(staleWheel);
    expect(staleWheel.defaultPrevented).toBe(false);
    h.update({ url: 'blob:reloaded', status: 'ready' });
    expect(h.size()).toBeUndefined();
    expect(h.scroll(-100).defaultPrevented).toBe(true);
    const currentViewport = h.viewport;
    h.unmount();
    const afterUnmount = wheel(-100);
    currentViewport.dispatchEvent(afterUnmount);
    expect(afterUnmount.defaultPrevented).toBe(false);
  });

  it('continues reporting natural dimensions and opening the image editor after zooming', () => {
    const h = fixture();
    act(() => h.renderer.root.findByType('img').props.onLoad({ currentTarget: h.image }));
    expect(h.onNatural).toHaveBeenCalledWith({ w: 1600, h: 800 });
    h.scroll(-100);
    expect(h.onOpen).not.toHaveBeenCalled();
    act(() => h.renderer.root.findByType('button').props.onClick());
    expect(h.onOpen).toHaveBeenCalledOnce();
  });
});
