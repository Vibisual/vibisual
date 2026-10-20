import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTimeline } from '../resolveTimeline.js';
import { COMPOSITION_LOAD_TIMEOUT_MS, COMPOSITION_SEEK_TIMEOUT_MS } from '../constants.js';
import type { VideoDoc, VideoItem } from '../types.js';
import type { MediaProvider } from './canvas2d.js';
import { CompositionFrame } from './compositionFrame.js';
import { HtmlSceneStage } from './htmlStage.js';

type Message = Record<string, unknown>;

/** Minimal DOM transport: replies are controlled so warm/active/dispose races are reproducible. */
class Element {
  style: Record<string, string> = {};
  children: Element[] = [];
  parent: Element | null = null;
  className = '';
  src = '';
  width = 0;
  height = 0;
  readonly messages: Message[] = [];
  readonly contentWindow = { postMessage: (message: Message) => this.messages.push(message) };
  readonly ctx = { clearRect: vi.fn(), drawImage: vi.fn() };
  constructor(readonly tag: string) {}
  setAttribute(): void {}
  addEventListener(): void {}
  appendChild(child: Element): Element { child.remove(); child.parent = this; this.children.push(child); return child; }
  replaceChildren(...children: Element[]): void { for (const child of [...this.children]) child.remove(); for (const child of children) this.appendChild(child); }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  getContext(): typeof this.ctx { return this.ctx; }
}

let nodes: Element[];
let listeners: Set<(e: MessageEvent) => void>;
const owners: Array<{ dispose(): void }> = [];

beforeEach(() => {
  vi.useFakeTimers();
  nodes = [];
  listeners = new Set();
  vi.stubGlobal('window', {
    addEventListener: (_: string, listener: (e: MessageEvent) => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: (e: MessageEvent) => void) => listeners.delete(listener),
  });
  vi.stubGlobal('document', {
    createElement: (tag: string) => { const el = new Element(tag); nodes.push(el); return el; },
    getElementById: () => ({}),
    fonts: { ready: Promise.resolve() },
    body: new Element('body'),
  });
});

afterEach(() => {
  for (const owner of owners.splice(0)) owner.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function flush(): Promise<void> { for (let i = 0; i < 16; i++) await Promise.resolve(); }
function iframes(): Element[] { return nodes.filter((el) => el.tag === 'iframe'); }
function reply(frame: Element, data: Message): void {
  for (const listener of listeners) listener({ source: frame.contentWindow, data } as unknown as MessageEvent);
}
function ready(frame: Element, index = frame.messages.length - 1, mode = 'forward'): void {
  reply(frame, { __vibi: 'ready', seq: frame.messages[index]!.seq, mode });
}
function frame(): CompositionFrame {
  const f = new CompositionFrame({ src: '/comp', width: 640, height: 360, label: 'comp' });
  owners.push(f);
  return f;
}
function doc(items: VideoItem[]): VideoDoc {
  return { schemaVersion: 1, id: 'd', title: 'd', version: 1, size: { width: 640, height: 360 }, fps: 30,
    tracks: [{ id: 'v', kind: 'visual', items }], assets: { composition: {
      id: 'composition', kind: 'composition', source: { kind: 'file', path: 'comp.html' },
    } }, createdAt: 0, updatedAt: 0 };
}
const comp = (id: string, at: number, trimStart = 0): VideoItem => ({ id, kind: 'composition', assetId: 'composition', at, duration: 2, trimStart });
function stage(d: VideoDoc, extra: Partial<ConstructorParameters<typeof HtmlSceneStage>[0]> = {}): HtmlSceneStage {
  const s = new HtmlSceneStage({ doc: d, timeline: resolveTimeline(d), media: {} as MediaProvider,
    compositionSrc: (op) => `/${op.itemId}`, preview: true,
    warm: { aheadSeconds: 10, aheadMax: 2, keepParked: 1, parkedTtlMs: 1000 }, ...extra });
  owners.push(s);
  return s;
}

describe('composition frame seek ownership', () => {
  it('serializes an in-flight warm and activation, then reuses the exact warmed boundary', async () => {
    const f = frame();
    const iframe = iframes()[0]!;
    reply(iframe, { __vibi: 'loaded', mode: 'forward' });
    const warm = f.seek(0, { preview: true });
    const active = f.seek(0, { preview: true });
    await flush();
    expect(iframe.messages).toHaveLength(1);
    expect(iframe.messages[0]).toMatchObject({ t: 0, preview: true });
    ready(iframe);
    await Promise.all([warm, active]);
    expect(iframe.messages).toHaveLength(1);
    expect(iframes()).toHaveLength(1);
  });

  it('waits for warm completion before deciding whether a forward-only rewind needs a fresh frame', async () => {
    const f = frame();
    const first = iframes()[0]!;
    reply(first, { __vibi: 'loaded', mode: 'forward' });
    const warm = f.seek(0.001, { preview: true });
    const rewind = f.seek(0, { preview: true });
    await flush();
    ready(first);
    await warm;
    await flush();
    expect(iframes()).toHaveLength(2);
    const second = iframes()[1]!;
    reply(second, { __vibi: 'loaded', mode: 'forward' });
    await flush();
    expect(second.messages[0]).toMatchObject({ t: 0 });
    ready(second);
    await rewind;
  });

  it('capture requests never reuse a preview acknowledgement or request the preview fast path', async () => {
    const f = frame();
    const iframe = iframes()[0]!;
    reply(iframe, { __vibi: 'loaded' });
    const preview = f.seek(0, { preview: true });
    await flush();
    ready(iframe);
    await preview;
    const capture = f.seek(0);
    await flush();
    expect(iframe.messages).toHaveLength(2);
    expect(iframe.messages[1]).not.toHaveProperty('preview');
    ready(iframe);
    await capture;
  });

  it('closing while loading cancels the request, removes the browsing context and unregisters listeners', async () => {
    const f = frame();
    const pending = f.seek(0).catch((err: Error) => err.message);
    await flush();
    f.dispose();
    expect(await pending).toContain('disposed');
    expect((f.element as unknown as Element).children).toHaveLength(0);
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reloading cancels old loading work instead of stranding its promise', async () => {
    const f = frame();
    const previous = f.seek(1).catch((err: Error) => err.message);
    await flush();
    f.reload('/edited');
    expect(await previous).toContain('restarted');
    const current = iframes()[1]!;
    const next = f.seek(0, { preview: true });
    reply(current, { __vibi: 'loaded' });
    await flush();
    ready(current);
    await next;
  });
});

describe('stage foreground priority and lifetime', () => {
  it.each(['load', 'seek'])('a preview %s timeout reports the failure and never resolves as a ready frame', async (kind) => {
    const onCompositionEvent = vi.fn();
    const s = stage(doc([comp('a', 0)]), { onCompositionEvent });
    const pending = s.seek(0).catch((err: Error) => err);
    if (kind === 'seek') reply(iframes()[0]!, { __vibi: 'loaded' });
    await flush();
    await vi.advanceTimersByTimeAsync(kind === 'load' ? COMPOSITION_LOAD_TIMEOUT_MS : COMPOSITION_SEEK_TIMEOUT_MS);
    expect(await pending).toBeInstanceOf(Error);
    expect(onCompositionEvent).toHaveBeenCalledWith('a', expect.objectContaining({ kind: 'error' }));
  });

  it('warms only after the visible frame completes and warms the exact trimmed scene boundary', async () => {
    const s = stage(doc([comp('a', 0), comp('b', 2, 3)]));
    const first = s.seek(0);
    await flush();
    expect(iframes()).toHaveLength(1);
    const a = iframes()[0]!;
    reply(a, { __vibi: 'loaded', mode: 'forward' });
    await flush();
    expect(iframes()).toHaveLength(1);
    ready(a);
    await first;
    await vi.advanceTimersByTimeAsync(0);
    expect(iframes()).toHaveLength(2);
    const b = iframes()[1]!;
    reply(b, { __vibi: 'loaded', mode: 'forward' });
    await flush();
    expect(b.messages[0]).toMatchObject({ t: 3, preview: true });
    const active = s.seek(2);
    await flush();
    expect(b.messages).toHaveLength(1);
    ready(b);
    await active;
    expect(iframes()).toHaveLength(2);
    expect(b.messages).toHaveLength(1);
  });

  it('strict export forces capture semantics and never creates background warm frames', async () => {
    const s = stage(doc([comp('a', 0), comp('b', 2)]), { strict: true });
    const pending = s.seek(0);
    const a = iframes()[0]!;
    reply(a, { __vibi: 'loaded' });
    await flush();
    expect(a.messages[0]).not.toHaveProperty('preview');
    ready(a);
    await pending;
    await vi.advanceTimersByTimeAsync(0);
    expect(iframes()).toHaveLength(1);
  });

  it('does not create future documents after closing with scheduled warm work', async () => {
    const s = stage(doc([comp('b', 2)]));
    await s.seek(0);
    s.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(iframes()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('late decoded media cannot repopulate a canvas released by closing the stage', async () => {
    let finish!: (src: CanvasImageSource) => void;
    const media = { getFrame: () => new Promise<CanvasImageSource>((resolve) => { finish = resolve; }) } as unknown as MediaProvider;
    const s = stage(doc([{ id: 'v', kind: 'footage', assetId: 'source', at: 0, duration: 2 }]), { media });
    const pending = s.seek(0);
    const canvas = nodes.find((el) => el.tag === 'canvas')!;
    s.dispose();
    finish({ width: 640, height: 360 } as CanvasImageSource);
    await pending;
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(canvas.ctx.drawImage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
