import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTimeline } from '../resolveTimeline.js';
import type { VideoDoc, VideoItem } from '../types.js';
import type { MediaProvider } from './canvas2d.js';
import { CompositionFrame, playTimeAt, samePlay, type CompositionPlay } from './compositionFrame.js';
import { HtmlSceneStage } from './htmlStage.js';

/**
 * §5.13 (Z) 41-1·41-2·41-5 — ① `loaded{port:true}` 뒤 요청·답은 포트로만 ② 재생 중엔 seek 대신 `play` 기준식(같은 직선이면 다시 안 보낸다)
 * ③ 재생 중 seek 는 답을 기다리지 않는다 ④ 코드가 바뀐 컴포지션은 새 프레임이 첫 그림을 낼 때까지 옛 프레임이 보인다.
 */

type Message = Record<string, unknown>;

class FakePort {
  readonly sent: Message[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  closed = false;
  postMessage(message: Message): void { this.sent.push(message); }
  close(): void { this.closed = true; }
}

const channels: { port1: FakePort; port2: FakePort }[] = [];
class FakeChannel {
  readonly port1 = new FakePort();
  readonly port2 = new FakePort();
  constructor() { channels.push(this); }
}

class Element {
  style: Record<string, string> = {};
  children: Element[] = [];
  parent: Element | null = null;
  className = '';
  src = '';
  width = 0;
  height = 0;
  readonly messages: Message[] = [];
  readonly transfers: unknown[][] = [];
  readonly contentWindow = { postMessage: (message: Message, _origin?: string, transfer?: unknown[]) => { this.messages.push(message); this.transfers.push(transfer ?? []); } };
  readonly ctx = { clearRect: vi.fn(), drawImage: vi.fn() };
  constructor(readonly tag: string) {}
  get nextSibling(): Element | null { const list = this.parent?.children ?? []; return list[list.indexOf(this) + 1] ?? null; }
  setAttribute(): void {}
  addEventListener(): void {}
  appendChild(child: Element): Element { child.remove(); child.parent = this; this.children.push(child); return child; }
  insertBefore(child: Element, ref: Element | null): Element {
    child.remove();
    child.parent = this;
    const at = ref ? this.children.indexOf(ref) : -1;
    if (at < 0) this.children.push(child); else this.children.splice(at, 0, child);
    return child;
  }
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
  channels.length = 0;
  listeners = new Set();
  vi.stubGlobal('MessageChannel', FakeChannel);
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

async function flush(): Promise<void> { for (let i = 0; i < 24; i++) await Promise.resolve(); }
function iframes(): Element[] { return nodes.filter((el) => el.tag === 'iframe'); }
function fromWindow(frame: Element, data: Message): void {
  for (const listener of listeners) listener({ source: frame.contentWindow, data } as unknown as MessageEvent);
}
/** 런타임 쪽에서 포트로 답한다(무대가 건넨 포트의 상대편 = port1 의 onmessage). */
function fromPort(channel: { port1: FakePort }, data: Message): void { channel.port1.onmessage?.({ data }); }

function frame(onPainted?: () => void): CompositionFrame {
  const f = new CompositionFrame({ src: '/comp', width: 640, height: 360, label: 'comp', ...(onPainted ? { onPainted } : {}) });
  owners.push(f);
  return f;
}

const PLAY: CompositionPlay = { base: 1, anchor: 1_000_000, min: 0, until: 2, grid: 0, fps: 30 };

describe('§5.13 (Z) 41-1 직통 채널', () => {
  it('포트를 받을 수 있다고 하면 포트를 건네고, 그 뒤 seek·답은 포트로만 오간다', async () => {
    const f = frame();
    const iframe = iframes()[0]!;
    fromWindow(iframe, { __vibi: 'loaded', port: true });
    expect(iframe.messages).toEqual([{ __vibi: 'port' }]);
    expect(channels).toHaveLength(1);
    expect(iframe.transfers[0]).toEqual([channels[0]!.port2]);
    const pending = f.seek(0.5, { preview: true });
    await flush();
    expect(iframe.messages).toHaveLength(1); // 창 메시지로는 더 보내지 않는다
    const seek = channels[0]!.port1.sent[0]!;
    expect(seek).toMatchObject({ __vibi: 'seek', t: 0.5, preview: true });
    fromPort(channels[0]!, { __vibi: 'ready', seq: seek['seq'] });
    await pending;
    expect(f.painted).toBe(true);
  });

  it('포트를 모르는 옛 런타임은 종전 창 메시지 그대로다', async () => {
    const f = frame();
    const iframe = iframes()[0]!;
    fromWindow(iframe, { __vibi: 'loaded' });
    const pending = f.seek(0.25);
    await flush();
    expect(channels).toHaveLength(0);
    expect(iframe.messages[0]).toMatchObject({ __vibi: 'seek', t: 0.25 });
    fromWindow(iframe, { __vibi: 'ready', seq: iframe.messages[0]!['seq'] });
    await pending;
  });

  it('새로 열면(다시 열기) 옛 포트를 닫고 새 문서에 새 포트를 건넨다', async () => {
    const f = frame();
    fromWindow(iframes()[0]!, { __vibi: 'loaded', port: true });
    f.reload('/edited');
    expect(channels[0]!.port1.closed).toBe(true);
    expect(f.painted).toBe(false);
    fromWindow(iframes()[1]!, { __vibi: 'loaded', port: true });
    expect(channels).toHaveLength(2);
  });
});

describe('§5.13 (Z) 41-2 스스로 재생', () => {
  it('기준식 하나를 보내고, 같은 직선(기준점만 옮긴 것)이면 다시 보내지 않는다', async () => {
    const f = frame();
    fromWindow(iframes()[0]!, { __vibi: 'loaded', port: true });
    await f.play(PLAY);
    const port = channels[0]!.port1;
    expect(port.sent).toEqual([{ __vibi: 'play', base: 1, anchor: 1_000_000, min: 0, until: 2, grid: 0, fps: 30 }]);
    expect(f.playing).toBe(true);
    await f.play({ ...PLAY, base: 1.5, anchor: 1_000_500 });
    expect(port.sent).toHaveLength(1);
    await f.play({ ...PLAY, base: 1.6, anchor: 1_000_500 });
    expect(port.sent).toHaveLength(2);
  });

  it('pause 는 멈춘 시각을 받아 오고, 그 뒤 정확한 seek 는 같은 시각이어도 다시 그린다', async () => {
    const f = frame();
    fromWindow(iframes()[0]!, { __vibi: 'loaded', port: true });
    await f.play(PLAY);
    const port = channels[0]!.port1;
    const paused = f.pause();
    await flush();
    const ask = port.sent[1]!;
    expect(ask).toMatchObject({ __vibi: 'pause' });
    fromPort(channels[0]!, { __vibi: 'paused', seq: ask['seq'], t: 1.2 });
    expect(await paused).toBe(1.2);
    expect(f.playing).toBe(false);
    const exact = f.seek(1.2, { preview: true });
    await flush();
    const seek = port.sent[2]!;
    expect(seek).toMatchObject({ __vibi: 'seek', t: 1.2 });
    fromPort(channels[0]!, { __vibi: 'ready', seq: seek['seq'] });
    await exact;
  });

  it('재생 중에 seek 가 오면 먼저 세우고 맞춘다', async () => {
    const f = frame();
    fromWindow(iframes()[0]!, { __vibi: 'loaded', port: true });
    await f.play(PLAY);
    const port = channels[0]!.port1;
    const exact = f.seek(0.4, { preview: true });
    await flush();
    expect(port.sent[1]).toMatchObject({ __vibi: 'pause' });
    fromPort(channels[0]!, { __vibi: 'paused', seq: port.sent[1]!['seq'], t: 1.1 });
    await flush();
    expect(port.sent[2]).toMatchObject({ __vibi: 'seek', t: 0.4 });
    fromPort(channels[0]!, { __vibi: 'ready', seq: port.sent[2]!['seq'] });
    await exact;
  });

  it('앞으로만 가는 컴포지션이 한 프레임 넘게 과거에서 다시 재생해야 하면 새로 연다', async () => {
    const f = frame();
    fromWindow(iframes()[0]!, { __vibi: 'loaded', port: true, mode: 'forward' });
    const anchor = Date.now();
    vi.spyOn(performance, 'now').mockReturnValue(anchor - performance.timeOrigin + 500);
    await f.play({ ...PLAY, base: 1, anchor, until: null });
    // 반복으로 처음으로 돌아왔다 — 지금(0.5초 뒤)은 1.5초인데 0초부터 다시.
    const replay = f.play({ ...PLAY, base: 0, anchor: anchor + 500, until: null });
    await flush();
    expect(iframes()).toHaveLength(2);
    fromWindow(iframes()[1]!, { __vibi: 'loaded', port: true, mode: 'forward' });
    await replay;
    expect(channels.at(-1)!.port1.sent.at(-1)).toMatchObject({ __vibi: 'play', base: 0 });
  });

  it('첫 장을 스스로 재생으로 내면(played) 첫 그림을 냈다고 알린다', () => {
    const onPainted = vi.fn();
    frame(onPainted);
    fromWindow(iframes()[0]!, { __vibi: 'loaded', port: true });
    fromPort(channels[0]!, { __vibi: 'played', t: 0 });
    fromPort(channels[0]!, { __vibi: 'played', t: 0 });
    expect(onPainted).toHaveBeenCalledTimes(1);
  });

  it('기준식 계산 — min~until 안, 같은 직선 판정', () => {
    expect(playTimeAt(PLAY, 1_000_000)).toBe(1);
    expect(playTimeAt(PLAY, 1_000_250)).toBeCloseTo(1.25, 9);
    expect(playTimeAt(PLAY, 999_000)).toBe(0);
    expect(playTimeAt(PLAY, 1_005_000)).toBe(2);
    expect(samePlay(PLAY, { ...PLAY, base: 2, anchor: 1_001_000 })).toBe(true);
    expect(samePlay(PLAY, { ...PLAY, base: 2.1, anchor: 1_001_000 })).toBe(false);
  });
});

function doc(items: VideoItem[]): VideoDoc {
  return { schemaVersion: 1, id: 'd', title: 'd', version: 1, size: { width: 640, height: 360 }, fps: 30,
    tracks: [{ id: 'v', kind: 'visual', items }], assets: { composition: {
      id: 'composition', kind: 'composition', source: { kind: 'file', path: 'comp.html' }, contentHash: 'h1',
    } }, createdAt: 0, updatedAt: 0 } as unknown as VideoDoc;
}
const comp = (id: string, at: number, duration = 2, trimStart = 0): VideoItem => ({ id, kind: 'composition', assetId: 'composition', at, duration, trimStart });
function stage(d: VideoDoc, extra: Partial<ConstructorParameters<typeof HtmlSceneStage>[0]> = {}): HtmlSceneStage {
  const s = new HtmlSceneStage({ doc: d, timeline: resolveTimeline(d), media: {} as MediaProvider,
    compositionSrc: (op, asset) => `/${op.itemId}?v=${asset?.contentHash ?? ''}`, preview: true, ...extra });
  owners.push(s);
  return s;
}

describe('§5.13 (Z) 41-2·41-5 재생 중 무대', () => {
  it('재생 중 seek 는 컴포지션 답을 기다리지 않고 끝나며, 보이는 컴포지션에 기준식을 건다', async () => {
    const s = stage(doc([comp('a', 0, 4, 1)]));
    s.play({ t: 0.5, perfMs: 10_000 });
    let done = false;
    void s.seek(0.5).then(() => { done = true; });
    await flush();
    expect(done).toBe(true); // 컴포지션이 아직 뜨지도 않았는데 끝났다
    const iframe = iframes()[0]!;
    fromWindow(iframe, { __vibi: 'loaded', port: true });
    await flush();
    const play = channels[0]!.port1.sent.find((m) => m['__vibi'] === 'play')!;
    expect(play).toMatchObject({ base: 1.5, min: 1, until: 5, grid: -1, fps: 30 });
    expect(play['anchor']).toBeCloseTo(performance.timeOrigin + 10_000, 3);
  });

  it('보여야 할 컴포지션이 첫 그림을 못 냈으면 알리고, 그리면 걷는다 · 재생을 끝내면 늘 false', async () => {
    const onCold = vi.fn();
    const s = stage(doc([comp('a', 0)]), { onCold });
    s.play({ t: 0, perfMs: 0 });
    await s.seek(0);
    expect(onCold).toHaveBeenLastCalledWith(true);
    fromWindow(iframes()[0]!, { __vibi: 'loaded', port: true });
    fromPort(channels[0]!, { __vibi: 'played', t: 0 });
    await s.seek(1 / 30);
    expect(onCold).toHaveBeenLastCalledWith(false);
    onCold.mockClear();
    s.stopPlay();
    expect(onCold).not.toHaveBeenCalled(); // 이미 false
    expect(s.playing).toBe(false);
  });

  it('재생을 끝내면 컴포지션을 세우고, 다음 seek 는 종전처럼 정확한 한 장을 기다린다', async () => {
    const s = stage(doc([comp('a', 0)]));
    s.play({ t: 0, perfMs: 0 });
    await s.seek(0);
    fromWindow(iframes()[0]!, { __vibi: 'loaded', port: true });
    await flush();
    const port = channels[0]!.port1;
    expect(port.sent.some((m) => m['__vibi'] === 'play')).toBe(true);
    s.stopPlay();
    await flush();
    const pause = port.sent.find((m) => m['__vibi'] === 'pause')!;
    fromPort(channels[0]!, { __vibi: 'paused', seq: pause['seq'], t: 0.4 });
    let done = false;
    const exact = s.seek(0.4).then(() => { done = true; });
    await flush();
    expect(done).toBe(false); // 정확한 seek 는 답을 기다린다
    const seek = port.sent.find((m) => m['__vibi'] === 'seek')!;
    expect(seek).toMatchObject({ t: 0.4, preview: true });
    fromPort(channels[0]!, { __vibi: 'ready', seq: seek['seq'] });
    await exact;
    expect(done).toBe(true);
  });

  it('코드가 바뀐 컴포지션은 새 프레임이 첫 그림을 낼 때까지 옛 프레임을 둔다(로딩 동안 빈 칸 ❌)', async () => {
    const first = doc([comp('a', 0)]);
    const s = stage(first);
    const seek0 = s.seek(0);
    const oldFrame = iframes()[0]!;
    fromWindow(oldFrame, { __vibi: 'loaded', port: true });
    await flush();
    fromPort(channels[0]!, { __vibi: 'ready', seq: channels[0]!.port1.sent[0]!['seq'] });
    await seek0;
    const edited = { ...first, assets: { composition: { ...first.assets['composition']!, contentHash: 'h2' } } } as VideoDoc;
    s.setDoc(edited, resolveTimeline(edited));
    const seek1 = s.seek(0);
    await flush();
    expect(iframes()).toHaveLength(2);
    expect(oldFrame.parent).not.toBeNull(); // 옛 그림은 아직 그대로
    fromPort(channels[0]!, { __vibi: 'ready', seq: channels[0]!.port1.sent.at(-1)!['seq'] });
    await seek1;
    const fresh = iframes()[1]!;
    fromWindow(fresh, { __vibi: 'loaded', port: true });
    await flush();
    const ask = channels[1]!.port1.sent.find((m) => m['__vibi'] === 'seek')!;
    fromPort(channels[1]!, { __vibi: 'ready', seq: ask['seq'] });
    await flush();
    expect(channels[0]!.port1.closed).toBe(true); // 옛 프레임은 첫 그림 뒤에 걷혔다
    expect(oldFrame.parent?.parent ?? null).toBeNull();
  });
});
