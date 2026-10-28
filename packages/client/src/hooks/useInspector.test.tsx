import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SiteProbeResult } from '../utils/inspectorSite.js';
import { registerInspectorPicker, type InspectorPickLevel, type InspectorPickLevels } from '../utils/inspectorPick.js';
import { useInspector } from './useInspector.js';

// Exercise the hook's event/state flow without requiring a layout engine. Geometry and
// clipboard formatting already have their own tests; here the selected DOM identity matters.
vi.mock('../utils/inspector.js', () => ({
  INSPECTOR_OVERLAY_ID: 'vibisual-inspector-overlay',
  getClassString: () => '',
  getAdjustedRect: (el: Element) => el.getBoundingClientRect(),
  buildClipboardText: (el: Element) => `selected:${el.id}`,
  buildRegionClipboardText: () => 'region',
}));

const site = vi.hoisted(() => ({
  probe: vi.fn<(...args: unknown[]) => Promise<SiteProbeResult | null>>(),
}));
vi.mock('../utils/inspectorSite.js', () => ({
  probeWorkspaceSite: site.probe,
  buildSiteClipboardText: (hit: { id: string }) => `remote:${hit.id}`,
  siteHitSummary: (hit: { id: string }) => hit.id,
}));

type Listener = (event: TestEvent) => void;
type ListenerOptions = boolean | { capture?: boolean };
const captureOf = (options?: ListenerOptions): boolean =>
  typeof options === 'boolean' ? options : options?.capture === true;

class EventHub {
  private readonly listeners = new Map<string, Array<{ listener: Listener; capture: boolean }>>();

  addEventListener(type: string, listener: Listener, options?: ListenerOptions): void {
    const entries = this.listeners.get(type) ?? [];
    entries.push({ listener, capture: captureOf(options) });
    this.listeners.set(type, entries);
  }

  removeEventListener(type: string, listener: Listener, options?: ListenerOptions): void {
    const capture = captureOf(options);
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(
      (entry) => entry.listener !== listener || entry.capture !== capture,
    ));
  }

  emit(type: string, event: TestEvent, capture: boolean): void {
    for (const entry of [...(this.listeners.get(type) ?? [])]) {
      if (entry.capture !== capture) continue;
      entry.listener(event);
      if (event.immediateStopped) break;
    }
  }
}

class TestEvent {
  key = '';
  repeat = false;
  altKey = true;
  shiftKey = false;
  button = 0;
  clientX = 0;
  clientY = 0;
  deltaY = 0;
  target: Element | null = null;
  defaultPrevented = false;
  propagationStopped = false;
  immediateStopped = false;

  constructor(values: Partial<TestEvent>) { Object.assign(this, values); }
  preventDefault(): void { this.defaultPrevented = true; }
  stopPropagation(): void { this.propagationStopped = true; }
  stopImmediatePropagation(): void { this.immediateStopped = true; this.propagationStopped = true; }
}

function element(id: string, tagName = 'BUTTON', parentElement: Element | null = null): Element {
  return {
    id, tagName, parentElement, textContent: id,
    closest: () => null,
    getBoundingClientRect: () => ({ left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 }),
  } as unknown as Element;
}

let renderer: ReactTestRenderer;
let result: ReturnType<typeof useInspector>;
let windowEvents: EventHub;
let documentEvents: EventHub;
let hitAt: (x: number, y: number) => Element | null;
let clipboard: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
let frames: HTMLIFrameElement[];
let frameObservers: Set<() => void>;

function pointerStyle(): CSSStyleDeclaration {
  let value = '';
  let priority = '';
  return {
    get pointerEvents() { return value; },
    set pointerEvents(next: string) { value = next; priority = ''; },
    getPropertyValue: (name: string) => name === 'pointer-events' ? value : '',
    getPropertyPriority: (name: string) => name === 'pointer-events' ? priority : '',
    setProperty(name: string, next: string, nextPriority = '') {
      if (name === 'pointer-events') { value = next; priority = nextPriority; }
    },
    removeProperty(name: string) {
      if (name !== 'pointer-events') return '';
      const old = value;
      value = ''; priority = '';
      return old;
    },
  } as CSSStyleDeclaration;
}

function iframe(contentDocument: { elementFromPoint: (x: number, y: number) => Element | null } | null): HTMLIFrameElement {
  return {
    id: 'preview-frame', tagName: 'IFRAME', parentElement: null, textContent: '',
    closest: () => null,
    contentDocument,
    contentWindow: { location: { href: 'https://preview.test/current.html' } },
    src: 'https://preview.test/original.html',
    style: pointerStyle(),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    getBoundingClientRect: () => ({ left: 100, top: 10, right: 200, bottom: 110, width: 100, height: 100 }),
  } as unknown as HTMLIFrameElement;
}

/** Native hit-testing observes the frame's current pointer-events and the foreground DOM.
 * The inspector may temporarily restore a frame's original style while querying the hit. */
function withFrameHit(frame: HTMLIFrameElement, behind: (x: number, y: number) => Element | null = () => null): typeof hitAt {
  return (x, y) => {
    const rect = frame.getBoundingClientRect();
    return frame.style.pointerEvents !== 'none'
      && x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom
      ? frame
      : behind(x, y);
  };
}

function remoteResult(id = 'remote-heading'): SiteProbeResult {
  return {
    url: 'https://preview.test/current.html',
    hit: {
      id, tag: 'h1', cls: '', text: 'Remote heading',
      rect: { x: 0, y: 0, width: 100, height: 30 },
      attrs: [], path: 'h1', at: null, atHops: 0, hasParent: true,
    },
  };
}

function delayedRemoteProbe(): (value: SiteProbeResult | null) => void {
  let resolve!: (value: SiteProbeResult | null) => void;
  site.probe.mockReturnValue(new Promise<SiteProbeResult | null>((done) => { resolve = done; }));
  return resolve;
}

function Probe(): null { result = useInspector(); return null; }

/** Window capture -> document capture -> target -> document/window bubble. A stopped
 * target models React inputs/editors that consume keyboard or mouse events. */
function dispatch(type: string, values: Partial<TestEvent>, stopAtTarget = false): TestEvent {
  const event = new TestEvent(values);
  windowEvents.emit(type, event, true);
  if (!event.propagationStopped) documentEvents.emit(type, event, true);
  if (!event.propagationStopped && stopAtTarget) event.stopPropagation();
  if (!event.propagationStopped) documentEvents.emit(type, event, false);
  if (!event.propagationStopped) windowEvents.emit(type, event, false);
  return event;
}

function altDown(stopAtTarget = false): void {
  act(() => { dispatch('keydown', { key: 'Alt' }, stopAtTarget); });
}

function hover(x: number, stopAtTarget = false): void {
  act(() => { dispatch('mousemove', { clientX: x, clientY: 20 }, stopAtTarget); });
}

function parentByWheel(): void {
  act(() => { dispatch('wheel', { deltaY: -100, clientX: 20, clientY: 20 }); });
}

async function click(x: number): Promise<void> {
  await act(async () => { dispatch('pointerdown', { clientX: x, clientY: 20 }); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  windowEvents = new EventHub();
  documentEvents = new EventHub();
  hitAt = () => null;
  frames = [];
  frameObservers = new Set();
  site.probe.mockReset().mockResolvedValue(null);
  clipboard = vi.fn(async (_text: string) => undefined);
  vi.stubGlobal('window', Object.assign(windowEvents, { setTimeout, clearTimeout }));
  vi.stubGlobal('document', Object.assign(documentEvents, {
    body: {},
    querySelectorAll: () => frames,
    elementFromPoint: (x: number, y: number) => hitAt(x, y),
  }));
  vi.stubGlobal('navigator', { clipboard: { writeText: clipboard } });
  vi.stubGlobal('MutationObserver', class {
    constructor(private readonly onMutation: () => void) {}
    observe(): void { frameObservers.add(this.onMutation); }
    disconnect(): void { frameObservers.delete(this.onMutation); }
  });
  vi.stubGlobal('DOMRect', class {
    constructor(readonly x: number, readonly y: number, readonly width: number, readonly height: number) {}
    get left(): number { return this.x; }
    get top(): number { return this.y; }
    get right(): number { return this.x + this.width; }
    get bottom(): number { return this.y + this.height; }
  });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  act(() => { renderer = create(createElement(Probe)); });
});

afterEach(() => {
  act(() => renderer.unmount());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Alt inspector DOM target selection', () => {
  it('copies the clicked child when the last hover was the whole StudioHeader', async () => {
    const header = element('studio-header', 'DIV');
    const exportButton = element('export', 'BUTTON', header);
    hitAt = (x) => x < 50 ? header : exportButton;
    altDown();
    hover(20);
    expect(result.info?.id).toBe('studio-header');

    // No mousemove is delivered at the new coordinate before pointerdown.
    await click(80);
    expect(clipboard).toHaveBeenLastCalledWith('selected:export');
    expect(result.info?.id).toBe('export');
  });

  it('selects a normal DOM element immediately after Alt without requiring mouse movement', async () => {
    hitAt = () => element('title');
    altDown();
    await click(20);
    expect(clipboard).toHaveBeenCalledExactlyOnceWith('selected:title');
    expect(result.info?.id).toBe('title');
  });

  it('preserves the wheel-selected parent while clicking the same innermost element', async () => {
    const header = element('studio-header', 'DIV');
    const button = element('title', 'BUTTON', header);
    hitAt = () => button;
    altDown();
    hover(20);
    parentByWheel();
    expect(result.info?.id).toBe('studio-header');
    await click(20);
    expect(clipboard).toHaveBeenLastCalledWith('selected:studio-header');
  });

  it('resets a wheel-selected ancestor when the click lands on a different child', async () => {
    const header = element('studio-header', 'DIV');
    const title = element('title', 'BUTTON', header);
    const exportButton = element('export', 'BUTTON', header);
    hitAt = (x) => x < 50 ? title : exportButton;
    altDown();
    hover(20);
    parentByWheel();
    await click(80);
    expect(clipboard).toHaveBeenLastCalledWith('selected:export');
    expect(result.info?.id).toBe('export');
  });

  it('receives Alt and mouse movement before an input/editor stops bubbling', async () => {
    const input = element('title-input', 'INPUT');
    hitAt = () => input;
    altDown(true);
    expect(result.active).toBe(true);
    hover(20, true);
    expect(result.info?.id).toBe('title-input');
    await click(20);
    expect(clipboard).toHaveBeenLastCalledWith('selected:title-input');
    act(() => { dispatch('keyup', { key: 'Alt', altKey: false }, true); });
    expect(result.active).toBe(false);
    expect(result.info).toBeNull();
  });

  it('can select the same element again after an Alt shortcut deactivates the inspector', async () => {
    const button = element('title');
    hitAt = () => button;
    altDown();
    hover(20);
    act(() => { dispatch('keydown', { key: 'x', altKey: true }); });
    expect(result.active).toBe(false);
    // A fresh Alt activation must not inherit the old effect's cached hover element.
    altDown();
    hover(20);
    await click(20);
    expect(clipboard).toHaveBeenLastCalledWith('selected:title');
  });

  it('resolves a same-origin iframe child at the click coordinate instead of the prior main-document hover', async () => {
    const header = element('studio-header', 'DIV');
    const previewButton = element('preview-button');
    const innerHit = vi.fn(() => previewButton);
    const frame = iframe({ elementFromPoint: innerHit });
    frames.push(frame);
    hitAt = withFrameHit(frame, () => header);
    altDown();
    hover(20);
    await click(120);
    expect(innerHit).toHaveBeenLastCalledWith(20, 10);
    expect(clipboard).toHaveBeenLastCalledWith('selected:preview-button');
    expect(result.info?.id).toBe('preview-button');
  });

  it('discards a cached remote iframe hover when the next click is on the main document', async () => {
    const button = element('local-export');
    const frame = iframe(null);
    frames.push(frame);
    site.probe.mockResolvedValue(remoteResult());
    hitAt = withFrameHit(frame, () => button);
    altDown();
    await act(async () => { dispatch('mousemove', { clientX: 120, clientY: 20 }); });
    expect(result.info?.id).toBe('remote-heading');
    await click(20);
    expect(clipboard).toHaveBeenCalledExactlyOnceWith('selected:local-export');
    expect(result.info?.id).toBe('local-export');
  });

  it('does not overwrite a newer local click when an older remote click finishes later', async () => {
    const frame = iframe(null);
    frames.push(frame);
    const resolveRemote = delayedRemoteProbe();
    hitAt = withFrameHit(frame, () => element('local-export'));
    altDown();
    await click(120);
    expect(site.probe).toHaveBeenCalledOnce();
    expect(clipboard).not.toHaveBeenCalled();
    await click(20);
    expect(clipboard).toHaveBeenCalledExactlyOnceWith('selected:local-export');
    await act(async () => { resolveRemote(remoteResult()); });
    expect(clipboard).toHaveBeenCalledExactlyOnceWith('selected:local-export');
  });

  it('still completes a deliberate remote click after Alt is released while awaiting its response', async () => {
    const frame = iframe(null);
    frames.push(frame);
    hitAt = withFrameHit(frame);
    const resolveRemote = delayedRemoteProbe();
    altDown();
    await click(120);
    act(() => { dispatch('keyup', { key: 'Alt', altKey: false }); });
    expect(result.active).toBe(false);
    await act(async () => { resolveRemote(remoteResult()); });
    expect(clipboard).toHaveBeenCalledExactlyOnceWith('remote:remote-heading');
  });

  it('selects a foreground app button instead of an iframe covered by that app window', async () => {
    const innerHit = vi.fn(() => element('covered-preview-button'));
    frames.push(iframe({ elementFromPoint: innerHit }));
    const button = element('studio-export');
    // The frame's geometry contains this point, but the app window paints above it.
    hitAt = () => button;
    altDown();
    hover(120);
    await click(120);
    expect(result.info?.id).toBe('studio-export');
    expect(clipboard).toHaveBeenCalledExactlyOnceWith('selected:studio-export');
    expect(innerHit).not.toHaveBeenCalled();
    expect(site.probe).not.toHaveBeenCalled();
  });

  it('ignores a rendering iframe whose original pointer-events is none and preserves that style', async () => {
    const frame = iframe(null);
    frame.style.setProperty('pointer-events', 'none', 'important');
    frames.push(frame);
    const preview = element('studio-preview', 'DIV');
    hitAt = withFrameHit(frame, () => preview);
    altDown();
    hover(120);
    await click(120);
    expect(result.info?.id).toBe('studio-preview');
    expect(clipboard).toHaveBeenCalledExactlyOnceWith('selected:studio-preview');
    expect(site.probe).not.toHaveBeenCalled();
    act(() => { dispatch('keyup', { key: 'Alt', altKey: false }); });
    expect(frame.style.pointerEvents).toBe('none');
    expect(frame.style.getPropertyPriority('pointer-events')).toBe('important');
  });

  it('restores a preview iframe original pointer-events value and priority after Alt', async () => {
    const innerHit = vi.fn(() => element('preview-button'));
    const frame = iframe({ elementFromPoint: innerHit });
    frame.style.setProperty('pointer-events', 'auto', 'important');
    frames.push(frame);
    hitAt = withFrameHit(frame);
    altDown();
    expect(frame.style.pointerEvents).toBe('none');
    await click(120);
    expect(clipboard).toHaveBeenCalledExactlyOnceWith('selected:preview-button');
    expect(frame.style.pointerEvents).toBe('none');
    act(() => { dispatch('keyup', { key: 'Alt', altKey: false }); });
    expect(frame.style.pointerEvents).toBe('auto');
    expect(frame.style.getPropertyPriority('pointer-events')).toBe('important');
  });

  it('respects a render-only iframe pointer-events rule from its stylesheet', async () => {
    const frame = iframe(null);
    frames.push(frame);
    const preview = element('studio-preview', 'DIV');
    // .vs-comp disables pointer events in CSS, without any original inline value.
    hitAt = () => frame.style.pointerEvents === 'auto' ? frame : preview;
    altDown();
    await click(120);
    expect(clipboard).toHaveBeenCalledExactlyOnceWith('selected:studio-preview');
    expect(site.probe).not.toHaveBeenCalled();
    act(() => { dispatch('keyup', { key: 'Alt', altKey: false }); });
    expect(frame.style.getPropertyValue('pointer-events')).toBe('');
  });

  it('keeps newly mounted iframe events in the host and restores a removed iframe', async () => {
    altDown();
    const frame = iframe({ elementFromPoint: () => element('new-preview-button') });
    frame.style.setProperty('pointer-events', 'auto', 'important');
    frames.push(frame);
    hitAt = withFrameHit(frame);
    act(() => { frameObservers.forEach((notify) => notify()); });
    expect(frame.style.pointerEvents).toBe('none');
    await click(120);
    expect(clipboard).toHaveBeenCalledExactlyOnceWith('selected:new-preview-button');
    frames = [];
    act(() => { frameObservers.forEach((notify) => notify()); });
    expect(frame.style.pointerEvents).toBe('auto');
    expect(frame.style.getPropertyPriority('pointer-events')).toBe('important');
    act(() => { dispatch('keyup', { key: 'Alt', altKey: false }); });
    expect(frameObservers.size).toBe(1); // Only the always-mounted keyboard observer remains.
  });

  it('clears the old large local highlight while a remote frame is pending or returns no hit', async () => {
    const header = Object.assign(element('studio-screen', 'DIV'), {
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 1600, bottom: 900, width: 1600, height: 900 }),
    });
    const frame = iframe(null);
    frames.push(frame);
    hitAt = withFrameHit(frame, () => header);
    const resolveRemote = delayedRemoteProbe();
    altDown();
    hover(20);
    expect(result.info?.id).toBe('studio-screen');
    hover(120);
    expect(site.probe).toHaveBeenCalledOnce();
    expect(result.info).toBeNull();
    await act(async () => { resolveRemote(null); });
    expect(result.info).toBeNull();
  });

  it('does not restore a remote hover highlight after Alt has been released', async () => {
    const frame = iframe(null);
    frames.push(frame);
    hitAt = withFrameHit(frame, () => element('studio-screen', 'DIV'));
    const resolveRemote = delayedRemoteProbe();
    altDown();
    hover(20);
    hover(120);
    expect(result.info).toBeNull();
    act(() => { dispatch('keyup', { key: 'Alt', altKey: false }); });
    expect(result.active).toBe(false);
    await act(async () => { resolveRemote(remoteResult()); });
    expect(result.info).toBeNull();
    expect(clipboard).not.toHaveBeenCalled();
  });
});

/** §5.4 #15 (C) — 그린 화면은 브라우저가 판 하나만 안다 — 그린 쪽이 공급자로 안쪽을 답하면 인스펙터가 판 전체가 아니라 그 자리의 것을 집는다. */
describe('Alt inspector inside a drawn surface (pick providers)', () => {
  const part: InspectorPickLevel = { rect: { x: 5, y: 2, width: 40, height: 10 }, label: 'intro › subtitle', text: 'Vibisual · Vibistudio', clipboard: 'clip:subtitle' };
  const item: InspectorPickLevel = { rect: { x: 0, y: 0, width: 100, height: 30 }, label: 'intro (scene:title)', text: '제목', clipboard: 'clip:intro' };
  const unregister: Array<() => void> = [];
  afterEach(() => { unregister.splice(0).forEach((off) => off()); });

  function surfaceWith(answer: (at: { x: number; y: number; width: number; height: number }) => InspectorPickLevels | Promise<InspectorPickLevels>): { surface: Element; parent: Element; picker: ReturnType<typeof vi.fn> } {
    const parent = element('studio-preview', 'DIV');
    const surface = element('preview-surface', 'DIV', parent);
    const picker = vi.fn(answer);
    unregister.push(registerInspectorPicker(surface, picker));
    return { surface, parent, picker };
  }

  it('picks the drawn part under the cursor instead of the whole surface, and copies its own text', async () => {
    const { surface, picker } = surfaceWith(() => [part, item]);
    hitAt = () => surface;
    altDown();
    hover(20);
    // The provider is asked in surface-local visible pixels (surface box starts at 10,10).
    expect(picker).toHaveBeenLastCalledWith({ x: 10, y: 10, width: 100, height: 30 });
    expect(result.info?.tag).toBe('intro › subtitle');
    expect(result.info?.text).toBe('Vibisual · Vibistudio');
    expect(result.info?.rect.left).toBe(15);
    expect(result.info?.rect.top).toBe(12);
    await click(20);
    expect(clipboard).toHaveBeenCalledExactlyOnceWith('clip:subtitle');
    expect(result.copiedSummary).toBe('intro › subtitle');
  });

  it('wheels up from the part to its item, then to the surface element and its DOM parents', async () => {
    const { surface } = surfaceWith(() => [part, item]);
    hitAt = () => surface;
    altDown();
    hover(20);
    parentByWheel();
    expect(result.info?.tag).toBe('intro (scene:title)');
    await click(20);
    expect(clipboard).toHaveBeenLastCalledWith('clip:intro');
    parentByWheel();
    expect(result.info?.id).toBe('preview-surface');
    parentByWheel();
    expect(result.info?.id).toBe('studio-preview');
    await click(20);
    expect(clipboard).toHaveBeenLastCalledWith('selected:studio-preview');
  });

  it('resets the wheel depth when a different drawn thing is under the click', async () => {
    const other: InspectorPickLevel = { ...part, label: 'intro › title', text: 'See your AI agents think.', clipboard: 'clip:title' };
    const { surface } = surfaceWith((at) => (at.x < 40 ? [part, item] : [other, item]));
    hitAt = () => surface;
    altDown();
    hover(20);
    parentByWheel();
    expect(result.info?.tag).toBe('intro (scene:title)');
    await click(80);
    expect(clipboard).toHaveBeenLastCalledWith('clip:title');
    expect(result.info?.tag).toBe('intro › title');
  });

  it('falls back to the surface element itself where nothing is drawn', async () => {
    const { surface } = surfaceWith(() => []);
    hitAt = () => surface;
    altDown();
    hover(20);
    expect(result.info?.id).toBe('preview-surface');
    await click(20);
    expect(clipboard).toHaveBeenCalledExactlyOnceWith('selected:preview-surface');
  });

  it('keeps buttons on top of a surface as ordinary DOM picks (only the surface itself asks)', async () => {
    const { surface, picker } = surfaceWith(() => [part, item]);
    const pin = element('note-pin', 'BUTTON', surface);
    hitAt = () => pin;
    altDown();
    hover(20);
    await click(20);
    expect(picker).not.toHaveBeenCalled();
    expect(clipboard).toHaveBeenCalledExactlyOnceWith('selected:note-pin');
  });

  it('asks an SVG surface registered with subtree even when the browser picks a shape inside it', async () => {
    const editor = element('image-editor', 'DIV');
    const svg = element('image-stage', 'svg', editor);
    const shape = element('layer-text', 'text', element('layer-g', 'g', svg));
    const picker = vi.fn(() => [part, item]);
    unregister.push(registerInspectorPicker(svg, picker, { subtree: true }));
    hitAt = () => shape;
    altDown();
    hover(20);
    // The surface (not the picked shape) is the coordinate origin.
    expect(picker).toHaveBeenLastCalledWith({ x: 10, y: 10, width: 100, height: 30 });
    expect(result.info?.tag).toBe('intro › subtitle');
    await click(20);
    expect(clipboard).toHaveBeenCalledExactlyOnceWith('clip:subtitle');
    parentByWheel();
    parentByWheel();
    expect(result.info?.id).toBe('image-stage');
    parentByWheel();
    expect(result.info?.id).toBe('image-editor');
  });

  it('clears an old large box while an async answer is pending, then draws the answer', async () => {
    const big = Object.assign(element('studio-screen', 'DIV'), {
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 1600, bottom: 900, width: 1600, height: 900 }),
    });
    let resolve!: (levels: InspectorPickLevels) => void;
    const { surface } = surfaceWith(() => new Promise<InspectorPickLevels>((done) => { resolve = done; }));
    hitAt = (x) => (x < 50 ? big : surface);
    altDown();
    hover(20);
    expect(result.info?.id).toBe('studio-screen');
    hover(80);
    expect(result.info).toBeNull();
    await act(async () => { resolve([part, item]); });
    expect(result.info?.tag).toBe('intro › subtitle');
  });

  it('does not draw a late answer for a point the cursor already left; it asks the latest point instead', async () => {
    const answers: Array<(levels: InspectorPickLevels) => void> = [];
    const { surface, picker } = surfaceWith(() => new Promise<InspectorPickLevels>((done) => { answers.push(done); }));
    hitAt = () => surface;
    altDown();
    hover(20);
    hover(60);
    hover(70);
    expect(picker).toHaveBeenCalledOnce();
    await act(async () => { answers[0]!([part, item]); });
    // The stale answer is dropped and only the last point (70) is asked again.
    expect(result.info).toBeNull();
    expect(picker).toHaveBeenCalledTimes(2);
    expect(picker).toHaveBeenLastCalledWith({ x: 60, y: 10, width: 100, height: 30 });
    await act(async () => { answers[1]!([item]); });
    expect(result.info?.tag).toBe('intro (scene:title)');
  });

  it('still copies a deliberate click whose async answer arrives after Alt is released, but a newer click wins', async () => {
    const answers: Array<(levels: InspectorPickLevels) => void> = [];
    const { surface } = surfaceWith(() => new Promise<InspectorPickLevels>((done) => { answers.push(done); }));
    const button = element('local-export');
    hitAt = (x) => (x < 50 ? surface : button);
    altDown();
    await click(20);
    act(() => { dispatch('keyup', { key: 'Alt', altKey: false }); });
    await act(async () => { answers[0]!([part, item]); });
    expect(clipboard).toHaveBeenCalledExactlyOnceWith('clip:subtitle');

    altDown();
    await click(20);
    await click(80);
    await act(async () => { answers[answers.length - 1]!([part, item]); });
    expect(clipboard).toHaveBeenLastCalledWith('selected:local-export');
    expect(clipboard).toHaveBeenCalledTimes(2);
  });

  it('ignores a wheel event without vertical movement (horizontal swipe) instead of climbing to the parent', () => {
    const header = element('studio-header', 'DIV');
    const button = element('title', 'BUTTON', header);
    hitAt = () => button;
    altDown();
    hover(20);
    const event = dispatch('wheel', { deltaY: 0, clientX: 20, clientY: 20 });
    expect(result.info?.id).toBe('title');
    expect(event.defaultPrevented).toBe(false);
  });

  it('treats the surface as a plain element again once its provider is removed', async () => {
    const { surface, picker } = surfaceWith(() => [part, item]);
    unregister.splice(0).forEach((off) => off());
    hitAt = () => surface;
    altDown();
    hover(20);
    await click(20);
    expect(picker).not.toHaveBeenCalled();
    expect(clipboard).toHaveBeenCalledExactlyOnceWith('selected:preview-surface');
  });
});
