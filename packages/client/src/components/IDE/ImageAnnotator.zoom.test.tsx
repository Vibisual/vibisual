import type { ComponentProps } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageLightboxView } from './ImageAnnotator.js';
import { ImagePixelWorkerEngine } from './imagePixelWorkerEngine.js';
import type { ImagePixelMessage, ImagePixelReply } from './imagePixelWorkerProtocol.js';

const graph = vi.hoisted(() => ({
  agents: [], updateAgentSessionInputAttachments: vi.fn(), markWorkspaceImageSaved: vi.fn(),
}));
vi.mock('react-i18next', () => {
  const t = (key: string): string => key;
  return { useTranslation: () => ({ t }) };
});
vi.mock('../../stores/graphStore.js', () => ({
  useGraphStore: (selector: (state: typeof graph) => unknown) => selector(graph),
  agentSessionInputKey: (agent: string, session: string | null) => `${agent}:${session}`,
}));
vi.mock('./imageClipboard.js', () => ({ resolveClipboardSurface: () => null, copyImageToClipboard: vi.fn() }));

type Props = ComponentProps<typeof ImageLightboxView>;
let view: ReactTestRenderer | undefined;
let browser: EventTarget;
let doc: { body: TestElement; documentElement: TestElement; activeElement: TestElement | null; createElement: ReturnType<typeof vi.fn> };
let dialog: TestElement;
let viewport: TestElement;
let surface: TestElement;
let raster: TestImage;
let overlay: TestElement;
let viewportSize: { width: number; height: number };
let observers: TestResizeObserver[];
let canvas: { width: number; height: number; getContext: ReturnType<typeof vi.fn>; toBlob: ReturnType<typeof vi.fn> };
let context: { drawImage: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn>; restore: ReturnType<typeof vi.fn>; strokeRect: ReturnType<typeof vi.fn> };

/** Only browser boundaries are mocked: sizing, focus, identity, events, and canvas output. */
class TestElement extends EventTarget {
  isConnected = true;
  isContentEditable = false;
  scrollLeft = 0;
  scrollTop = 0;
  constructor(readonly name: string, readonly parent: TestElement | null = null) { super(); }
  focus = vi.fn(() => { doc.activeElement = this; });
  blur = vi.fn(() => { if (doc.activeElement === this) doc.activeElement = doc.body; });
  contains(target: TestElement | null): boolean {
    for (let node = target; node; node = node.parent) if (node === this) return true;
    return false;
  }
  get clientWidth(): number { return viewportSize.width; }
  get clientHeight(): number { return viewportSize.height; }
  getBoundingClientRect() {
    if (this === viewport) return { left: 100, top: 80, ...viewportSize };
    const size = view ? surfaceView().props.style as { width: number; height: number } : { width: 0, height: 0 };
    return { left: 112 - viewport.scrollLeft, top: 92 - viewport.scrollTop, ...size };
  }
  setPointerCapture = vi.fn();
  releasePointerCapture = vi.fn();
}
class TestInput extends TestElement { constructor(readonly type: string) { super(type, dialog); } }
class TestTextArea extends TestElement {}
class TestButton extends TestElement {}
class TestSelect extends TestElement {}
class TestAnchor extends TestElement {}
class TestImage extends TestElement {
  naturalWidth = 1600;
  naturalHeight = 1200;
  complete = true;
  decode = vi.fn(async () => {});
  getAttribute(name: string): string | null { return name === 'src' ? rasterView().props.src as string : null; }
}
class TestResizeObserver {
  constructor(readonly notify: () => void) { observers.push(this); }
  observe = vi.fn();
  disconnect = vi.fn();
}

beforeEach(() => {
  browser = Object.assign(new EventTarget(), { innerWidth: 1024, innerHeight: 768 });
  viewportSize = { width: 848, height: 648 };
  observers = [];
  const html = new TestElement('html');
  doc = { body: new TestElement('body', html), documentElement: html, activeElement: null, createElement: vi.fn() };
  dialog = new TestElement('dialog', doc.body);
  viewport = new TestElement('viewport', dialog);
  surface = new TestElement('surface', viewport);
  raster = new TestImage('image', surface);
  overlay = new TestElement('overlay', surface);
  context = { drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(), strokeRect: vi.fn() };
  canvas = {
    width: 0, height: 0, getContext: vi.fn(() => context),
    toBlob: vi.fn((done: (blob: Blob) => void) => done(new Blob(['png'], { type: 'image/png' }))),
  };
  doc.createElement.mockImplementation((tag: string) => {
    if (tag !== 'canvas') throw new Error(`Unexpected DOM allocation: ${tag}`);
    return canvas;
  });
  vi.stubGlobal('window', browser);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('Node', TestElement);
  vi.stubGlobal('Element', TestElement);
  vi.stubGlobal('HTMLElement', TestElement);
  vi.stubGlobal('HTMLInputElement', TestInput);
  vi.stubGlobal('HTMLTextAreaElement', TestTextArea);
  vi.stubGlobal('HTMLButtonElement', TestButton);
  vi.stubGlobal('HTMLSelectElement', TestSelect);
  vi.stubGlobal('HTMLAnchorElement', TestAnchor);
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
});

afterEach(() => {
  act(() => view?.unmount());
  view = undefined;
  vi.unstubAllGlobals();
});

function mount(overrides: Partial<Props> = {}, load = true): Props {
  const props: Props = {
    state: { url: 'blob:original', origin: { slot: 'vibimage', cell: null } },
    agentId: 'agent-zoom', activeSessionId: null, canAttach: false, onClose: vi.fn(), ...overrides,
  };
  act(() => {
    view = create(<ImageLightboxView {...props} />, {
      createNodeMock: (element) => {
        const attrs = element.props as Record<string, unknown>;
        if (attrs.role === 'dialog') return dialog;
        const classes = typeof attrs.className === 'string' ? attrs.className : '';
        if (classes.includes('overscroll-contain')) return viewport;
        if (classes.includes('relative m-auto shrink-0')) return surface;
        if (element.type === 'img') return raster;
        if (element.type === 'canvas') return canvas;
        if (element.type === 'svg' && attrs.onPointerDown) return overlay;
        return null;
      },
    });
  });
  if (load) act(() => rasterView().props.onLoad({ currentTarget: raster }));
  return props;
}

function rasterView(): ReactTestInstance { return view!.root.findAllByType('img')[0]!; }
function surfaceView(): ReactTestInstance { return rasterView().parent!; }
function annotationView(): ReactTestInstance {
  return view!.root.findAllByType('svg').find((node) => !!node.props.onPointerDown)!;
}
function button(label: string): ReactTestInstance {
  return view!.root.findAllByType('button').find((node) => node.props['aria-label'] === `ide.imageAnnotate.${label}`)!;
}
function click(label: string): void { act(() => button(label).props.onClick()); }
function percent(): string { return view!.root.findByType('output').children.join(''); }
function key(keyValue: string, extras: Record<string, unknown> = {}, target = dialog): KeyboardEvent {
  const event = new Event('keydown', { cancelable: true }) as KeyboardEvent;
  const { defaultPrevented = false, ...properties } = extras;
  for (const [name, value] of Object.entries({ key: keyValue, target, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, isComposing: false, keyCode: 0, ...properties })) {
    Object.defineProperty(event, name, { value });
  }
  if (defaultPrevented) event.preventDefault();
  act(() => { browser.dispatchEvent(event); });
  return event;
}
function pointer(x: number, y: number) {
  const bounds = overlay.getBoundingClientRect();
  return { clientX: bounds.left + bounds.width * x, clientY: bounds.top + bounds.height * y,
    button: 0, pointerId: 1, currentTarget: overlay, stopPropagation: vi.fn(), preventDefault: vi.fn() };
}
function drawRect(from = 0.25, to = 0.5): void {
  click('tool.rect');
  act(() => annotationView().props.onPointerDown(pointer(from, from)));
  act(() => annotationView().props.onPointerMove(pointer(to, to)));
  act(() => annotationView().props.onPointerUp(pointer(to, to)));
}

/** Bubble through host nodes, including the viewport's propagation guard. */
function mouse(target: ReactTestInstance, handler: 'onMouseDown' | 'onClick'): void {
  act(() => {
    let stopped = false;
    for (let node: ReactTestInstance | null = target; node && !stopped; node = node.parent) {
      if (typeof node.type !== 'string') continue;
      node.props[handler]?.({
        target, currentTarget: node, button: 0, clientX: 120, clientY: 100,
        stopPropagation: () => { stopped = true; }, preventDefault: vi.fn(),
      });
    }
  });
}

describe('ImageLightboxView outside clicks', () => {
  it.each(['outer backdrop', 'image padding'])('closes once from %s', (area) => {
    const { onClose } = mount();
    const target = area === 'outer backdrop' ? view!.root.findByProps({ role: 'dialog' }) : surfaceView().parent!;
    mouse(target, 'onMouseDown');
    mouse(target, 'onClick');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps image clicks, toolbar controls, and viewport scrollbars inside', () => {
    const { onClose } = mount();
    const viewportNode = surfaceView().parent!.parent!;
    for (const target of [rasterView(), button('zoom.in'), viewportNode]) {
      mouse(target, 'onMouseDown');
      mouse(target, 'onClick');
    }
    expect(percent()).toBe('125%');
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each(['image padding', 'outer backdrop'])('keeps an image gesture open when released on %s', (area) => {
    const { onClose } = mount();
    const target = area === 'outer backdrop' ? view!.root.findByProps({ role: 'dialog' }) : surfaceView().parent!;
    mouse(rasterView(), 'onMouseDown');
    mouse(target, 'onClick');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('protects unsaved edits from both backdrop areas', () => {
    const { onClose } = mount();
    drawRect();
    for (const target of [surfaceView().parent!, view!.root.findByProps({ role: 'dialog' })]) {
      mouse(target, 'onMouseDown');
      mouse(target, 'onClick');
    }
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('ImageLightboxView Rust worker editing', () => {
  function setupPixels(withTransparency = false) {
    const workers: TestPixelWorker[] = [];
    class TestPixelWorker {
      onmessage: ((event: MessageEvent<ImagePixelReply>) => void) | null = null;
      onerror = null;
      onmessageerror = null;
      sent: ImagePixelMessage[] = [];
      engine = new ImagePixelWorkerEngine();
      terminate = vi.fn();
      constructor() { workers.push(this); }
      postMessage(message: ImagePixelMessage, transfer: Transferable[]) {
        this.sent.push(structuredClone(message, { transfer: transfer as ArrayBuffer[] }));
      }
      finish(index: number) { this.onmessage?.({ data: this.engine.run(this.sent[index]!) } as MessageEvent<ImagePixelReply>); }
    }
    vi.stubGlobal('Worker', TestPixelWorker);
    vi.stubGlobal('HTMLCanvasElement', class { static [Symbol.hasInstance](value: unknown) { return value === canvas; } });
    vi.stubGlobal('Image', class { src = ''; naturalWidth = 2; naturalHeight = 2; async decode() {} });
    vi.stubGlobal('ImageData', class {
      constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {}
    });
    Object.assign(browser, { requestAnimationFrame: (callback: () => void) => { callback(); return 1; }, cancelAnimationFrame: vi.fn() });
    const source = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
    if (withTransparency) source[15] = 128;
    const putImageData = vi.fn();
    Object.assign(context, { getImageData: () => ({ data: source.slice() }), putImageData });
    const props = mount({}, false);
    raster.naturalWidth = 2; raster.naturalHeight = 2;
    act(() => rasterView().props.onLoad({ currentTarget: raster }));
    click('tool.alpha');
    const options = () => view!.root.findAll(node => typeof node.props.onTolerance === 'function')[0]!;
    return { workers, putImageData, props, options };
  }

  it('ignores old slider results, applies the exact preview pixels and preserves one-step undo', async () => {
    const test = setupPixels();
    const worker = test.workers[0]!;
    await act(async () => { worker.finish(0); }); // transparency
    act(() => test.options().props.onAuto());
    expect(worker.sent[1]?.job.kind).toBe('key');
    act(() => test.options().props.onTolerance(20));
    act(() => test.options().props.onTolerance(30));
    await act(async () => { worker.finish(1); });
    expect(test.putImageData).not.toHaveBeenCalled();
    expect(worker.sent).toHaveLength(3);
    await act(async () => { worker.finish(2); });
    expect(test.putImageData).toHaveBeenCalledTimes(1);
    const preview = test.putImageData.mock.calls[0]![0].data as Uint8ClampedArray;
    expect([...preview.filter((_, i) => i % 4 === 3)]).toEqual([0, 0, 255, 255]);
    await act(async () => { test.options().props.onApply(); });
    expect(worker.sent[3]?.job.kind).toBe('key');
    await act(async () => { worker.finish(3); });
    expect(test.putImageData.mock.calls[1]![0].data).toEqual(preview);
    expect(rasterView().props.src).not.toBe('blob:original');
    expect(worker.terminate).toHaveBeenCalledOnce();
    click('undo');
    expect(rasterView().props.src).toBe('blob:original');
  });

  it('terminates a pending preview on close and never paints its late result', async () => {
    const test = setupPixels(), worker = test.workers[0]!;
    await act(async () => { worker.finish(0); });
    act(() => test.options().props.onAuto());
    await act(async () => { view!.unmount(); view = undefined; });
    expect(worker.terminate).toHaveBeenCalledOnce();
    await act(async () => { worker.finish(1); });
    expect(test.putImageData).not.toHaveBeenCalled();
  });

  it('fills partial alpha in the worker and retains the original image for undo', async () => {
    const test = setupPixels(true), worker = test.workers[0]!;
    await act(async () => { worker.finish(0); });
    act(() => test.options().props.onMode('fill'));
    await act(async () => { test.options().props.onApply(); });
    expect(worker.sent[1]?.job.kind).toBe('transparent');
    await act(async () => { worker.finish(1); });
    expect(worker.sent[2]?.job.kind).toBe('fill');
    await act(async () => { worker.finish(2); });
    const result = test.putImageData.mock.calls[0]![0].data as Uint8ClampedArray;
    expect([...result.slice(12)]).toEqual([127, 127, 127, 255]);
    click('undo'); expect(rasterView().props.src).toBe('blob:original');
  });

  it('discards an in-progress apply when the source changes without reporting an error on the new image', async () => {
    const test = setupPixels(), worker = test.workers[0]!;
    await act(async () => { worker.finish(0); });
    act(() => test.options().props.onAuto());
    await act(async () => { worker.finish(1); });
    await act(async () => { test.options().props.onApply(); });
    await act(async () => { view!.update(<ImageLightboxView {...test.props} state={{ ...test.props.state, url: 'blob:replacement' }} />); });
    await act(async () => { worker.finish(2); });
    expect(rasterView().props.src).toBe('blob:replacement');
    expect(test.options().props.notice).toBeNull();
    expect(test.putImageData).toHaveBeenCalledTimes(1);
  });
});

describe('ImageLightboxView zoom controls', () => {
  it('disables controls until the image loads while preventing native Ctrl zoom', () => {
    mount({}, false);
    for (const control of ['in', 'out', 'reset']) expect(button(`zoom.${control}`).props.disabled).toBe(true);
    expect(key('=', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(percent()).toBe('100%');
    act(() => rasterView().props.onLoad({ currentTarget: raster }));
    expect(button('zoom.in').props.disabled).toBe(false);
  });

  it('zooms with buttons and resets both fitted size and scroll position', () => {
    mount();
    expect(surfaceView().props.style).toMatchObject({ width: 800, height: 600 });
    click('zoom.in');
    expect(percent()).toBe('125%');
    expect(surfaceView().props.style).toMatchObject({ width: 1000, height: 750 });
    click('zoom.out');
    click('zoom.out');
    expect(percent()).toBe('75%');
    viewport.scrollLeft = 173;
    viewport.scrollTop = 91;
    click('zoom.reset');
    expect(percent()).toBe('100%');
    expect(surfaceView().props.style).toMatchObject({ width: 800, height: 600 });
    expect([viewport.scrollLeft, viewport.scrollTop]).toEqual([0, 0]);
  });

  it.each([['+', {}], ['=', {}], ['+', { ctrlKey: true }], ['=', { metaKey: true }]])('accepts %s shortcuts with %j', (value, modifiers) => {
    mount();
    expect(key(value, modifiers).defaultPrevented).toBe(true);
    expect(percent()).toBe('125%');
    expect(key('-', modifiers).defaultPrevented).toBe(true);
    expect(percent()).toBe('100%');
    click('zoom.in');
    viewport.scrollLeft = 90;
    viewport.scrollTop = 44;
    expect(key('0', modifiers).defaultPrevented).toBe(true);
    expect(percent()).toBe('100%');
    expect([viewport.scrollLeft, viewport.scrollTop]).toEqual([0, 0]);
  });

  it('keeps consuming native zoom shortcuts at both limits', () => {
    mount();
    for (let i = 0; i < 12; i++) key('=', { ctrlKey: true });
    expect(percent()).toBe('400%');
    expect(button('zoom.in').props.disabled).toBe(true);
    expect(key('+', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(percent()).toBe('400%');
    for (let i = 0; i < 15; i++) key('-', { metaKey: true });
    expect(percent()).toBe('25%');
    expect(button('zoom.out').props.disabled).toBe(true);
    expect(key('-', { metaKey: true }).defaultPrevented).toBe(true);
    expect(percent()).toBe('25%');
  });

  it('leaves outside focus untouched and accepts body focus while the dialog is open', () => {
    mount();
    const outside = new TestElement('other-pane', doc.body);
    expect(key('+', {}, outside).defaultPrevented).toBe(false);
    expect(percent()).toBe('100%');
    expect(key('+', {}, doc.body).defaultPrevented).toBe(true);
    expect(percent()).toBe('125%');
    expect(view!.root.findByProps({ role: 'dialog' }).props['data-shortcut-scope']).toBe('dialog');
  });

  it('does not consume typing in numeric, text, multiline, or contenteditable fields', () => {
    mount();
    click('zoom.in');
    const editable = new TestElement('editable', dialog);
    editable.isContentEditable = true;
    const fields = [new TestInput('number'), new TestInput('text'), new TestTextArea('textarea', dialog), editable];
    for (const field of fields) for (const value of ['+', '-', '0']) {
      expect(key(value, {}, field).defaultPrevented).toBe(false);
      expect(percent()).toBe('125%');
    }
  });

  it.each([{ isComposing: true }, { keyCode: 229 }, { altKey: true }, { defaultPrevented: true }])('ignores reserved or already handled key events: %j', (flags) => {
    mount();
    const event = key('+', flags);
    expect(percent()).toBe('100%');
    expect(event.defaultPrevented).toBe('defaultPrevented' in flags);
  });

  it('keeps zoom shortcuts inactive while a text draft or discard dialog owns input', () => {
    mount();
    click('tool.text');
    act(() => annotationView().props.onPointerDown(pointer(0.25, 0.25)));
    expect(key('+').defaultPrevented).toBe(false);
    expect(percent()).toBe('100%');
    key('Escape');
    drawRect();
    key('Escape');
    expect(view!.root.findAllByType('p').some((node) => node.children.includes('ide.imageAnnotate.discardTitle'))).toBe(true);
    expect(key('+').defaultPrevented).toBe(false);
    expect(percent()).toBe('100%');
  });

  it('prevents a shortcut from resizing the image in the middle of a drawing gesture', () => {
    mount();
    click('tool.rect');
    act(() => annotationView().props.onPointerDown(pointer(0.25, 0.25)));
    expect(key('+', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(percent()).toBe('100%');
    act(() => annotationView().props.onPointerUp(pointer(0.25, 0.25)));
    key('+');
    expect(percent()).toBe('125%');
  });

  it('preserves natural annotation coordinates through zoom, scroll, reset, and PNG export', async () => {
    const apply = vi.fn(async (_png: Blob) => {});
    mount({ onApplyImage: apply });
    drawRect();
    for (let i = 0; i < 4; i++) click('zoom.in');
    expect(percent()).toBe('200%');
    viewport.scrollLeft = 123;
    viewport.scrollTop = 87;
    drawRect(0.5, 0.75);
    const boxes = () => annotationView().findAllByType('rect').map(({ props }) => ({ x: props.x, y: props.y, width: props.width, height: props.height }));
    const expected = [{ x: 400, y: 300, width: 400, height: 300 }, { x: 800, y: 600, width: 400, height: 300 }];
    expect(annotationView().props.viewBox).toBe('0 0 1600 1200');
    expect(boxes()).toEqual(expected);
    click('zoom.reset');
    expect(boxes()).toEqual(expected);
    click('zoom.in');
    const applyButton = view!.root.findAllByType('button').find((node) => node.children.includes('panel.options.apply'));
    expect(applyButton).toBeDefined();
    await act(async () => { applyButton!.props.onClick(); });
    expect([canvas.width, canvas.height]).toEqual([1600, 1200]);
    expect(context.drawImage).toHaveBeenCalledWith(raster, 0, 0, 1600, 1200);
    expect(context.strokeRect.mock.calls).toEqual([[400, 300, 400, 300], [800, 600, 400, 300]]);
    expect(apply).toHaveBeenCalledWith(expect.any(Blob));
  });

  it('remeasures viewport fit while retaining the selected zoom and resets when the source changes', () => {
    const props = mount();
    click('zoom.in');
    act(() => {
      viewportSize = { width: 448, height: 348 };
      observers[0]!.notify();
    });
    expect(percent()).toBe('125%');
    expect(surfaceView().props.style).toMatchObject({ width: 500, height: 375 });
    viewport.scrollLeft = 150;
    viewport.scrollTop = 95;
    act(() => view!.update(<ImageLightboxView {...props} state={{ ...props.state, url: 'blob:next' }} />));
    expect(percent()).toBe('100%');
    expect([viewport.scrollLeft, viewport.scrollTop]).toEqual([0, 0]);
  });

  it('does not mark zoom-only viewing as an image edit', () => {
    const { onClose } = mount();
    click('zoom.in');
    key('Escape');
    expect(onClose).toHaveBeenCalledOnce();
    expect(view!.root.findAllByType('p').some((node) => node.children.includes('ide.imageAnnotate.discardTitle'))).toBe(false);
  });
});
