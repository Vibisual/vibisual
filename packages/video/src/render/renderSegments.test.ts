import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stableStringify } from '../hashItem.js';
import { resolveTimeline } from '../resolveTimeline.js';
import type { ResolvedTimeline, VideoDoc, VideoItem } from '../types.js';
import { RENDER_BACKEND_CAPABILITIES, type BackendProbe, type RenderBackend } from './backend.js';
import { buildDrawList } from './drawList.js';
import type { OutputSink } from './encode.js';
import { RenderCanceledError } from './renderDoc.js';
import { SegmentJoinError, renderDocSegmented, type SegmentRenderOptions, type SegmentStore } from './renderSegments.js';
import type { SegmentEncoderLayer } from './segmentEncode.js';
import { decoderConfigText, packSegment, unpackSegment, type SegmentPacket } from './segmentPack.js';

/**
 * §5.13 (E) 대조 시험 — 같은 문서를 ① 캐시 없이 전부 구운 것과 ② 구간을 다시 쓴 것이 같은 파일인가.
 * 프레임 그림 = 그 시각의 그리기 목록(세 백엔드가 이것만 보고 그린다), 인코더 = 한 세션 안에서 앞 프레임의 상태를 이어 가는 결정적 가짜
 * (실제 인코더의 비트 배분 상태를 흉내 — 구간마다 새로 세우지 않으면 결과가 갈린다). 먹서는 실제 Mediabunny 다.
 */

const W = 320;
const H = 180;
const DECODER = decoderConfigText({ codec: 'avc1.42001f', codedWidth: W, codedHeight: H, description: new Uint8Array([1, 0x42, 0, 0x1f, 0xff, 0xe1, 0, 4, 0x67, 0x42, 0, 0x1f, 1, 0, 2, 0x68, 0xce]) });

function makeDoc(labels: readonly string[], fps = 30): VideoDoc {
  const items: VideoItem[] = labels.map((label, i) => ({ id: `s${i}`, kind: 'text', at: i * 2, duration: 2, props: { text: label } }));
  return {
    schemaVersion: 1, id: 'd', title: 't', version: 1, size: { width: W, height: H }, fps,
    tracks: [{ id: 'v', kind: 'visual', items }], assets: {}, createdAt: 0, updatedAt: 0,
  };
}

interface FakeSurface { content: string }

class FakeBackend implements RenderBackend {
  readonly id = 'canvas2d' as const;
  readonly capabilities = RENDER_BACKEND_CAPABILITIES.canvas2d;
  readonly drawn: number[] = [];
  readonly plans: number[][] = [];
  disposed = false;
  surface: FakeSurface | null = null;

  constructor(private readonly doc: VideoDoc, private readonly timeline: ResolvedTimeline) {}

  get canvas(): OffscreenCanvas | null {
    return this.surface as unknown as OffscreenCanvas | null;
  }

  async probe(): Promise<BackendProbe> { return { id: this.id, available: true }; }
  async init(): Promise<void> { this.surface = { content: '' }; }
  plan(times: readonly number[]): void { this.plans.push([...times]); }

  async drawFrame(t: number): Promise<void> {
    if (!this.surface) throw new Error('init first');
    this.drawn.push(t);
    this.surface.content = stableStringify(buildDrawList(this.doc, this.timeline, t).map((op) => ({
      id: op.itemId, local: Number(op.localTime.toFixed(6)), props: op.resolved.item.props ?? null,
    })));
  }

  dispose(): void { this.disposed = true; }
}

function fnv(seed: number, text: string): number {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return hash;
}

/** 세션마다 상태를 새로 세우고, 프레임마다 지금 표면의 그림을 그 상태에 접는다. */
function fakeLayer(backend: FakeBackend, opts: { decoder?: string; firstKey?: boolean; decoderAfter?: { sessions: number; decoder: string } } = {}): SegmentEncoderLayer & { sessions: number } {
  const layer = {
    sessions: 0,
    async probe() { return opts.decoder ?? DECODER; },
    async open() {
      layer.sessions += 1;
      const decoder = opts.decoderAfter && layer.sessions > opts.decoderAfter.sessions ? opts.decoderAfter.decoder : opts.decoder ?? DECODER;
      let state = 0x811c9dc5;
      let frames = 0;
      const packets: SegmentPacket[] = [];
      return {
        async addFrame(j: number) {
          state = fnv(state, backend.surface?.content ?? '');
          const data = new Uint8Array(24);
          const view = new DataView(data.buffer);
          for (let k = 0; k < 6; k += 1) view.setUint32(k * 4, fnv(state, `${j}:${k}`));
          packets.push({ frame: j, key: j === 0 && opts.firstKey !== false, data, alpha: null });
          frames = j + 1;
        },
        async finish() { return { frames, decoder, packets }; },
        async cancel() { /* 가짜 — 잡은 자원이 없다 */ },
      };
    },
  };
  return layer;
}

class MemoryStore implements SegmentStore {
  readonly map = new Map<string, Uint8Array>();
  readonly gets: string[] = [];
  readonly puts: string[] = [];
  envFails = false;

  async env(): Promise<{ files: Record<string, string>; shared: string }> {
    if (this.envFails) throw new Error('env down');
    return { files: {}, shared: '' };
  }

  async has(keys: readonly string[]): Promise<ReadonlySet<string>> {
    return new Set(keys.filter((key) => this.map.has(key)));
  }

  async get(key: string): Promise<Uint8Array | null> {
    this.gets.push(key);
    return this.map.get(key) ?? null;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    this.puts.push(key);
    this.map.set(key, new Uint8Array(bytes));
  }
}

interface Run {
  readonly bytes: Uint8Array;
  readonly backend: FakeBackend;
  readonly layer: SegmentEncoderLayer & { sessions: number };
  readonly segments: { total: number; reused: number };
  readonly reusedFrames: number;
  readonly frames: number;
}

async function run(doc: VideoDoc, store: SegmentStore, over: Partial<SegmentRenderOptions> = {}, layerOpts: Parameters<typeof fakeLayer>[1] = {}): Promise<Run> {
  const timeline = resolveTimeline(doc);
  const backend = new FakeBackend(doc, timeline);
  const layer = fakeLayer(backend, layerOpts);
  const result = await renderDocSegmented({
    doc, timeline, backend, store, engine: 'test-engine',
    encoderLayer: layer, codecs: { video: 'avc', audio: null }, ...over,
  });
  if (!result.bytes) throw new Error('expected in-memory bytes');
  return { bytes: result.bytes, backend, layer, segments: result.segments, reusedFrames: result.reusedFrames, frames: result.frames };
}

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const LABELS = ['one', 'two', 'three', 'four', 'five'];

beforeEach(() => {
  // mp4 머리의 만든 시각이 벽시계를 따른다 — 두 렌더를 바이트로 맞대려면 시각을 못 박는다.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-01-02T03:04:05Z') });
});
afterEach(() => { vi.useRealTimers(); });

describe('renderDocSegmented — 전체 렌더와 구간을 다시 쓴 렌더는 같은 파일이다', () => {
  it('캐시가 비어 있으면 전부 굽고 구간마다 조각을 남긴다', async () => {
    const store = new MemoryStore();
    const cold = await run(makeDoc(LABELS), store);
    expect(cold.frames).toBe(300);
    expect(cold.segments).toEqual({ total: 5, reused: 0 });
    expect(cold.backend.drawn).toHaveLength(300);
    expect(cold.layer.sessions).toBe(5);
    expect(store.puts).toHaveLength(5);
    expect(cold.backend.disposed).toBe(true);
    // 나눠 찍는 백엔드에는 구울 프레임 시각을 전부 알린다.
    expect(cold.backend.plans).toHaveLength(1);
    expect(cold.backend.plans[0]).toHaveLength(300);
  });

  it('같은 문서를 다시 구우면 한 프레임도 그리지 않고 같은 파일이 나온다', async () => {
    const store = new MemoryStore();
    const cold = await run(makeDoc(LABELS), store);
    const warm = await run(makeDoc(LABELS), store);
    expect(warm.backend.drawn).toHaveLength(0);
    expect(warm.layer.sessions).toBe(0);
    expect(warm.segments).toEqual({ total: 5, reused: 5 });
    expect(warm.reusedFrames).toBe(300);
    expect(hex(warm.bytes)).toBe(hex(cold.bytes));
  });

  it('한 장면만 고치면 그 구간만 다시 굽고, 캐시 없이 전부 구운 것과 바이트로 같다', async () => {
    const store = new MemoryStore();
    await run(makeDoc(LABELS), store);
    const edited = makeDoc(['one', 'two', 'THREE', 'four', 'five']);
    const reuse = await run(edited, store);
    const full = await run(edited, new MemoryStore());

    expect(reuse.segments).toEqual({ total: 5, reused: 4 });
    expect(reuse.backend.drawn).toHaveLength(60);
    expect(Math.min(...reuse.backend.drawn)).toBeCloseTo(4, 9);
    expect(Math.max(...reuse.backend.drawn)).toBeLessThan(6);
    expect(reuse.layer.sessions).toBe(1);
    expect(full.backend.drawn).toHaveLength(300);
    expect(hex(reuse.bytes)).toBe(hex(full.bytes));
    // 고친 구간이 실제로 다른 그림이다(같은 파일이 우연히 나온 것이 아니다).
    expect(hex(reuse.bytes)).not.toBe(hex((await run(makeDoc(LABELS), new MemoryStore())).bytes));
    // 나눠 찍는 백엔드에는 다시 구울 구간의 시각만 알린다.
    expect(reuse.backend.plans[0]).toHaveLength(60);
  });

  it('고쳤다가 되돌리면 처음 조각을 그대로 다시 쓴다', async () => {
    const store = new MemoryStore();
    const first = await run(makeDoc(LABELS), store);
    await run(makeDoc(['one', 'two', 'THREE', 'four', 'five']), store);
    const back = await run(makeDoc(LABELS), store);
    expect(back.backend.drawn).toHaveLength(0);
    expect(hex(back.bytes)).toBe(hex(first.bytes));
  });

  it('장면을 뒤에 하나 더 붙이면 새 구간만 굽는다', async () => {
    const store = new MemoryStore();
    await run(makeDoc(LABELS), store);
    const longer = makeDoc([...LABELS, 'six']);
    const reuse = await run(longer, store);
    expect(reuse.segments).toEqual({ total: 6, reused: 5 });
    expect(reuse.backend.drawn).toHaveLength(60);
    expect(hex(reuse.bytes)).toBe(hex((await run(longer, new MemoryStore())).bytes));
  });

  it('구간 렌더(범위)도 같은 조각을 쓴다 — 파일 시각은 0 부터', async () => {
    const store = new MemoryStore();
    await run(makeDoc(LABELS), store);
    const ranged = await run(makeDoc(LABELS), store, { range: { start: 4, end: 8 } });
    expect(ranged.frames).toBe(120);
    expect(ranged.segments).toEqual({ total: 2, reused: 2 });
    expect(ranged.backend.drawn).toHaveLength(0);
    const fresh = await run(makeDoc(LABELS), new MemoryStore(), { range: { start: 4, end: 8 } });
    expect(hex(ranged.bytes)).toBe(hex(fresh.bytes));
  });

  it('이어 붙인 파일은 읽히는 mp4 이고 패킷 시각이 프레임 번호 / fps 다', async () => {
    const store = new MemoryStore();
    await run(makeDoc(LABELS), store);
    const reuse = await run(makeDoc(['one', 'two', 'THREE', 'four', 'five']), store);
    const mb = await import('mediabunny');
    const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BufferSource(reuse.bytes) });
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('no video track');
    expect(track.codec).toBe('avc');
    const sink = new mb.EncodedPacketSink(track);
    const seen: { t: number; key: boolean }[] = [];
    for await (const packet of sink.packets()) seen.push({ t: packet.timestamp, key: packet.type === 'key' });
    expect(seen).toHaveLength(300);
    seen.forEach((packet, i) => {
      expect(packet.t).toBeCloseTo(i / 30, 4);
      expect(packet.key).toBe(i % 60 === 0);
    });
  });

  it('WebM 그릇도 같은 길로 이어 붙는다', async () => {
    const store = new MemoryStore();
    const vp9 = { decoder: decoderConfigText({ codec: 'vp09.00.10.08', codedWidth: W, codedHeight: H }) };
    const over = { container: 'webm' as const, codecs: { video: 'vp9' as const, audio: null } };
    const cold = await run(makeDoc(LABELS), store, over, vp9);
    const warm = await run(makeDoc(LABELS), store, over, vp9);
    expect(warm.backend.drawn).toHaveLength(0);
    expect(hex(warm.bytes)).toBe(hex(cold.bytes));
  });
});

describe('renderDocSegmented — (E-5) 조용히 섞지 않는다', () => {
  it('깨진 조각은 없는 것으로 보고 다시 굽는다 — 결과는 같고, 그 구간부터 찍기 계획을 다시 세운다', async () => {
    const store = new MemoryStore();
    const cold = await run(makeDoc(LABELS), store);
    const victim = store.puts[1]!;
    store.map.set(victim, new Uint8Array([1, 2, 3]));
    const again = await run(makeDoc(LABELS), store);
    expect(again.segments).toEqual({ total: 5, reused: 4 });
    expect(again.backend.drawn).toHaveLength(60);
    expect(hex(again.bytes)).toBe(hex(cold.bytes));
    expect(again.backend.plans).toEqual([[], again.backend.drawn]);
    // 다시 구운 조각으로 갈아 끼웠다.
    expect(unpackSegment(store.map.get(victim)!)).not.toBeNull();
  });

  it('디코더 설정이 이번 렌더와 다른 조각은 쓰지 않는다', async () => {
    const store = new MemoryStore();
    const cold = await run(makeDoc(LABELS), store);
    const victim = store.puts[3]!;
    const stored = unpackSegment(store.map.get(victim)!)!;
    store.map.set(victim, packSegment({ ...stored, decoder: 'someone-else' }));
    const again = await run(makeDoc(LABELS), store);
    expect(again.segments.reused).toBe(4);
    expect(hex(again.bytes)).toBe(hex(cold.bytes));
  });

  it('프레임 수가 다르거나 첫 패킷이 키프레임이 아닌 조각은 쓰지 않는다', async () => {
    const store = new MemoryStore();
    const cold = await run(makeDoc(LABELS), store);
    const [a, b] = [store.puts[0]!, store.puts[2]!];
    const sa = unpackSegment(store.map.get(a)!)!;
    const sb = unpackSegment(store.map.get(b)!)!;
    store.map.set(a, packSegment({ ...sa, frames: 59, packets: sa.packets.slice(0, 59) }));
    store.map.set(b, packSegment({ ...sb, packets: sb.packets.map((p, i) => (i === 0 ? { ...p, key: false } : p)) }));
    const again = await run(makeDoc(LABELS), store);
    expect(again.segments.reused).toBe(3);
    expect(again.backend.drawn).toHaveLength(120);
    expect(hex(again.bytes)).toBe(hex(cold.bytes));
  });

  it('새로 구운 구간의 디코더 설정이 이번 렌더와 다르면 잇지 않고 알린다(버린 뒤 다시 굽는 것은 부르는 쪽)', async () => {
    const store = new MemoryStore();
    const writes: number[] = [];
    const sink: OutputSink = { write: async (data) => { writes.push(data.byteLength); } };
    const doc = makeDoc(LABELS);
    const timeline = resolveTimeline(doc);
    const backend = new FakeBackend(doc, timeline);
    const layer = fakeLayer(backend, { decoderAfter: { sessions: 2, decoder: 'switched' } });
    const attempt = renderDocSegmented({ doc, timeline, backend, store, engine: 'e', encoderLayer: layer, codecs: { video: 'avc', audio: null }, sink });
    await expect(attempt).rejects.toBeInstanceOf(SegmentJoinError);
    await expect(attempt).rejects.toMatchObject({ reason: 'decoder' });
    expect(backend.disposed).toBe(true);
    // 이을 수 없는 구간은 보관하지 않는다.
    expect(store.puts).toHaveLength(2);
  });

  it('새로 구운 구간의 첫 패킷이 키프레임이 아니어도 잇지 않는다', async () => {
    await expect(run(makeDoc(LABELS), new MemoryStore(), {}, { firstKey: false })).rejects.toMatchObject({ name: 'SegmentJoinError', reason: 'keyframe' });
  });

  it('보관하면 안 되는 구간(낮은 해상도로 찍힘)은 남기지 않는다 — 결과 파일은 같다', async () => {
    const store = new MemoryStore();
    const kept = await run(makeDoc(LABELS), new MemoryStore());
    const unkept = await run(makeDoc(LABELS), store, { canStore: () => false });
    expect(store.puts).toHaveLength(0);
    expect(hex(unkept.bytes)).toBe(hex(kept.bytes));
  });

  it('문서 밖 지문을 못 얻으면 캐시 없이 같은 구조로 굽는다(낡은 조각을 읽지도 남기지도 않는다)', async () => {
    const store = new MemoryStore();
    const cold = await run(makeDoc(LABELS), store);
    store.envFails = true;
    store.gets.length = 0;
    store.puts.length = 0;
    const blind = await run(makeDoc(LABELS), store);
    expect(blind.segments).toEqual({ total: 5, reused: 0 });
    expect(blind.backend.drawn).toHaveLength(300);
    expect(store.gets).toHaveLength(0);
    expect(store.puts).toHaveLength(0);
    expect(hex(blind.bytes)).toBe(hex(cold.bytes));
  });

  it('조각 쓰기가 실패해도 렌더는 끝난다', async () => {
    const store = new MemoryStore();
    store.put = async () => { throw new Error('disk full'); };
    const cold = await run(makeDoc(LABELS), store);
    expect(cold.segments).toEqual({ total: 5, reused: 0 });
  });

  it('중단 신호가 오면 멈추고 백엔드를 치운다', async () => {
    const controller = new AbortController();
    const doc = makeDoc(LABELS);
    const timeline = resolveTimeline(doc);
    const backend = new FakeBackend(doc, timeline);
    const attempt = renderDocSegmented({
      doc, timeline, backend, store: new MemoryStore(), engine: 'e',
      encoderLayer: fakeLayer(backend), codecs: { video: 'avc', audio: null }, signal: controller.signal,
      onProgress: (p) => { if (p.frame === 70) controller.abort(); },
    });
    await expect(attempt).rejects.toBeInstanceOf(RenderCanceledError);
    expect(backend.drawn).toHaveLength(70);
    expect(backend.disposed).toBe(true);
  });

  it('진행 보고는 다시 쓴 구간을 건너뛴 프레임으로 센다', async () => {
    const store = new MemoryStore();
    await run(makeDoc(LABELS), store);
    const seen: { frame: number; reused: number }[] = [];
    await run(makeDoc(['one', 'two', 'THREE', 'four', 'five']), store, { onProgress: (p) => { seen.push({ frame: p.frame, reused: p.reusedFrames }); } });
    expect(seen[0]).toEqual({ frame: 60, reused: 60 });
    expect(seen[1]).toEqual({ frame: 120, reused: 120 });
    expect(seen.at(-1)).toEqual({ frame: 300, reused: 240 });
    expect(seen.map((p) => p.frame)).toEqual([...seen.map((p) => p.frame)].sort((a, b) => a - b));
  });

  it('흘려 보내는 받는 곳으로도 같은 바이트가 나간다', async () => {
    const store = new MemoryStore();
    const memory = await run(makeDoc(LABELS), store);
    const out = new Uint8Array(memory.bytes.byteLength + 1024);
    let end = 0;
    const sink: OutputSink = { write: async (data, position) => { out.set(data, position); end = Math.max(end, position + data.byteLength); } };
    const doc = makeDoc(LABELS);
    const timeline = resolveTimeline(doc);
    const backend = new FakeBackend(doc, timeline);
    const streamed = await renderDocSegmented({ doc, timeline, backend, store, engine: 'test-engine', encoderLayer: fakeLayer(backend), codecs: { video: 'avc', audio: null }, sink });
    expect(streamed.bytes).toBeNull();
    expect(streamed.size).toBe(end);
    expect(streamed.segments.reused).toBe(5);
    // 흘려 보낼 때는 mp4 머리가 끝에 온다 — 메모리 결과와 배치는 다르지만 같은 패킷이 실린다.
    const mb = await import('mediabunny');
    const read = async (bytes: Uint8Array): Promise<string[]> => {
      const track = await new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BufferSource(bytes) }).getPrimaryVideoTrack();
      if (!track) throw new Error('no video track');
      const list: string[] = [];
      for await (const packet of new mb.EncodedPacketSink(track).packets()) list.push(`${packet.timestamp.toFixed(5)}:${packet.type}:${hex(packet.data)}`);
      return list;
    };
    expect(await read(out.subarray(0, end))).toEqual(await read(memory.bytes));
  });
});
