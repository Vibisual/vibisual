import { createRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useActiveSessionTabScroll } from './useActiveSessionTabScroll.js';

type Options = Parameters<typeof useActiveSessionTabScroll>[0];
let view: ReactTestRenderer | undefined;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let observers: MockResizeObserver[];

class MockResizeObserver {
  observed: unknown[] = [];
  disconnected = false;
  constructor(readonly callback: () => void) { observers.push(this); }
  observe(node: unknown): void { this.observed.push(node); }
  disconnect(): void { this.disconnected = true; }
}

function Probe(props: Options): null {
  useActiveSessionTabScroll(props);
  return null;
}

function render(options: Options): void {
  act(() => {
    if (view) view.update(<Probe {...options} />);
    else view = create(<Probe {...options} />);
  });
}

function flushFrame(): void {
  const pending = [...frames.values()];
  frames.clear();
  act(() => { for (const callback of pending) callback(0); });
}

function fixture() {
  const tabs = Array.from({ length: 19 }, (_, i) => ({
    dataset: { tabId: `session-${i}` }, offsetLeft: i * 160, offsetWidth: 160,
  }));
  const strip = { children: tabs, clientWidth: 480, scrollWidth: 3040, scrollLeft: 0 };
  const container = { current: strip as unknown as HTMLDivElement };
  const options: Options = {
    container, sessionId: 'session-18', orderKey: tabs.map((tab) => tab.dataset.tabId).join('\0'),
    revealKey: 1, paused: false,
  };
  return { tabs, strip, options };
}

beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  observers = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
});

afterEach(() => {
  act(() => view?.unmount());
  view = undefined;
  vi.unstubAllGlobals();
});

describe('selected session tab visibility', () => {
  it('reveals the selected session among 19 tabs and can switch back to the first', () => {
    const { strip, options } = fixture();
    render(options);
    expect(strip.scrollLeft).toBe(2560);
    render({ ...options, sessionId: 'session-0' });
    expect(strip.scrollLeft).toBe(0);
  });

  it('preserves manual scrolling on ordinary updates, but reveals on same-session reopen', () => {
    const { strip, options } = fixture();
    render(options);
    flushFrame();
    strip.scrollLeft = 0;
    render({ ...options });
    flushFrame();
    expect(strip.scrollLeft).toBe(0);
    render({ ...options, revealKey: 2 });
    expect(strip.scrollLeft).toBe(2560);
  });

  it('reveals a selected tab moved by sorting without adding or removing sessions', () => {
    const { tabs, strip, options } = fixture();
    options.sessionId = 'session-0';
    render(options);
    tabs[0]!.offsetLeft = 2880;
    tabs[18]!.offsetLeft = 0;
    strip.children = [...tabs].reverse();
    render({ ...options, orderKey: strip.children.map((tab) => tab.dataset.tabId).join('\0') });
    expect(strip.scrollLeft).toBe(2560);
  });

  it('waits for a hidden pane to gain width, then handles a narrower pane', () => {
    const { strip, options } = fixture();
    strip.clientWidth = 0;
    render(options);
    flushFrame();
    expect(strip.scrollLeft).toBe(0);
    strip.clientWidth = 480;
    observers[0]!.callback();
    flushFrame();
    expect(strip.scrollLeft).toBe(2560);
    strip.clientWidth = 320;
    observers[0]!.callback();
    flushFrame();
    expect(strip.scrollLeft).toBe(2720);
  });

  it('reacts when a preceding tab grows and pushes the selected one out of view', () => {
    const { tabs, strip, options } = fixture();
    options.sessionId = 'session-2';
    render(options);
    flushFrame();
    expect(strip.scrollLeft).toBe(0);
    expect(observers[0]!.observed).toContain(tabs[0]);
    tabs[0]!.offsetWidth += 32;
    tabs[2]!.offsetLeft += 32;
    strip.scrollWidth += 32;
    observers[0]!.callback();
    observers[0]!.callback();
    expect(frames.size).toBe(1);
    flushFrame();
    expect(strip.scrollLeft).toBe(40);
  });

  it('leaves scrolling to a tab drag and reveals after the drag ends', () => {
    const { strip, options } = fixture();
    render(options);
    render({ ...options, paused: true });
    strip.scrollLeft = 0;
    flushFrame();
    expect(strip.scrollLeft).toBe(0);
    expect(observers[0]!.disconnected).toBe(true);
    render({ ...options, paused: false });
    expect(strip.scrollLeft).toBe(2560);
  });

  it('keeps the start of an oversized tab visible without alternating between its edges', () => {
    const { strip, options } = fixture();
    strip.clientWidth = 100;
    render(options);
    expect(strip.scrollLeft).toBe(2880);
    flushFrame();
    observers[0]!.callback();
    flushFrame();
    expect(strip.scrollLeft).toBe(2880);
  });

  it('ignores the fixed main tab and an unavailable session', () => {
    const { strip, options } = fixture();
    render({ ...options, sessionId: null });
    expect(observers).toHaveLength(0);
    render({ ...options, sessionId: 'closed-session' });
    flushFrame();
    expect(strip.scrollLeft).toBe(0);
  });

  it('cancels pending work and observers on unmount', () => {
    const { strip, options } = fixture();
    render(options);
    act(() => view!.unmount());
    view = undefined;
    strip.scrollLeft = 0;
    flushFrame();
    expect(observers[0]!.disconnected).toBe(true);
    expect(strip.scrollLeft).toBe(0);
  });

  it('allows a ref without a mounted strip', () => {
    const { options } = fixture();
    render({ ...options, container: createRef<HTMLDivElement>() });
    expect(observers).toHaveLength(0);
    expect(frames.size).toBe(0);
  });
});
