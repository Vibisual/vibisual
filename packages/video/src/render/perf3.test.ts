import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDoc } from '../ops.js';
import { resolveTimeline } from '../resolveTimeline.js';
import type { ResolvedItem, VideoDoc, VideoItem } from '../types.js';
import { audioItemsAt } from './drawList.js';
import { envelopeForWindow, envelopeValueAt, gainEnvelope, itemWindowSpan, mixAudio, type EnvelopePoint } from './audioMix.js';
import { FOOTAGE_SEQUENTIAL_JUMP_S, effectiveFootageReaderLimit, footageDecoderLimit, footageDrawWidth, isDecoderReclaimError, readerStep, upcomingFootage } from './footagePlan.js';
import { STAGE_WARM_LONG_FRAMES, STAGE_WARM_PRIME_FRAMES, adaptWarm, warmSlotState } from './stageWarm.js';

/** §5.13 (Y) 40 — 3차 성능 수리의 판단들(순수)과 믹서의 약속을 고정한다. */

describe('§5.13 (Y) 40-2 ① 실효 이득 0 은 받기 전에 빠진다', () => {
  function doc(volume: number | undefined, muted = false): VideoDoc {
    return {
      ...createEmptyDoc('t', 'T'),
      tracks: [{ id: 'v', kind: 'visual', ...(muted ? { muted: true } : {}), items: [{ id: 'clip', kind: 'footage', assetId: 'ft', at: 0, duration: 3, trimStart: 72.6, ...(volume === undefined ? {} : { props: { volume } }) }] }],
      assets: { ft: { id: 'ft', kind: 'video', source: { kind: 'file', path: 'ft.mp4' }, hasAudio: true } },
    };
  }
  it.each([[0, 0], [-1, 0], [0.3, 1], [undefined, 1]])('volume %s → 소리 아이템 %s개', (volume, count) => {
    const d = doc(volume as number | undefined);
    expect(audioItemsAt(d, resolveTimeline(d))).toHaveLength(count as number);
  });

  it('볼륨 0 실사는 파일을 받지도 디코딩하지도 않는다(미리보기·렌더 같은 함수)', async () => {
    const fetchBytes = vi.fn(async () => new ArrayBuffer(8));
    const loadRange = vi.fn(async () => null);
    vi.stubGlobal('OfflineAudioContext', class { constructor() { throw new Error('should not mix'); } });
    try {
      const d = doc(0);
      expect(await mixAudio({ doc: d, timeline: resolveTimeline(d), loader: { fetchBytes, loadRange } })).toBeNull();
      expect(fetchBytes).not.toHaveBeenCalled();
      expect(loadRange).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('§5.13 (Y) 40-2 ③ 창을 이어 붙인 곡선 = 한 번에 건 곡선', () => {
  const item = (props: Record<string, unknown>, at = 1, duration = 6): ResolvedItem => ({
    id: 'a', trackId: 'au', trackKind: 'audio', kind: 'audio', start: at, end: at + duration, duration,
    item: { id: 'a', kind: 'audio', at, duration, assetId: 'x', props } as VideoItem,
  });
  /** 창 하나의 곡선을 그 창 기준 시각에서 읽는다(Web Audio 의 set + linear ramp 와 같은 뜻). */
  function windowValue(win: { initial: number; ramps: EnvelopePoint[] }, local: number): number {
    return envelopeValueAt([{ t: 0, v: win.initial }, ...win.ramps], local);
  }
  it.each([
    [{ volume: 0.8 }],
    [{ volume: 0.5, fadeIn: 1.2 }],
    [{ volume: 1, fadeOut: 2.5 }],
    [{ volume: 0.7, fadeIn: 0.4, fadeOut: 0.9 }],
  ])('%j', (props) => {
    const it0 = item(props);
    const full = gainEnvelope(it0, it0.duration);
    for (const [ws, we] of [[0, 1], [1, 2], [1.3, 2.3], [2, 3], [5, 6], [6.5, 7.5]] as const) {
      const win = envelopeForWindow(full, ws, we);
      for (let k = 0; k <= 20; k += 1) {
        const t = ws + ((we - ws) * k) / 20;
        expect(windowValue(win, t - ws)).toBeCloseTo(envelopeValueAt(full, t), 9);
      }
    }
  });
  it('창 안 몫 — 창 기준 시작 · 소재 안 시각 · 길이', () => {
    const it0 = { ...item({}), item: { ...item({}).item, trimStart: 10 } };
    expect(itemWindowSpan(it0, 6, 0, 2)).toEqual({ when: 1, from: 10, duration: 1 });
    expect(itemWindowSpan(it0, 6, 3, 4)).toEqual({ when: 0, from: 12, duration: 1 });
    expect(itemWindowSpan(it0, 6, 8, 9)).toBeNull();
  });
});

describe('§5.13 (Y) 40-2 ② 쓰는 구간만 — 조각 받개를 부르고 통째로 받지 않는다', () => {
  const calls: { method: string; args: unknown[] }[] = [];
  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal('OfflineAudioContext', class {
      destination = {};
      constructor(...args: unknown[]) { calls.push({ method: 'ctx', args }); }
      decodeAudioData = vi.fn(async () => { throw new Error('should not decode whole'); });
      createBufferSource() { return { buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: (...a: unknown[]) => calls.push({ method: 'start', args: a }), stop: vi.fn() }; }
      createGain() { return { connect: vi.fn(), disconnect: vi.fn(), gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() } }; }
      startRendering = async () => ({ duration: 1 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('창 [4,6) 에 걸린 효과음은 그 소재 안 [1,3) 만 청하고, 조각 시작을 기준으로 건다', async () => {
    const d: VideoDoc = { ...createEmptyDoc('t', 'T'), tracks: [{ id: 'au', kind: 'audio', items: [{ id: 's', kind: 'audio', assetId: 'm', at: 3, duration: 10 }] }],
      assets: { m: { id: 'm', kind: 'audio', source: { kind: 'file', path: 'm.mp3' }, duration: 200 } } };
    const chunkBuffer = { duration: 8, length: 8 * 48000, numberOfChannels: 2, sampleRate: 48000 } as unknown as AudioBuffer;
    const loadRange = vi.fn(async () => [{ buffer: chunkBuffer, start: 0 }]);
    const fetchBytes = vi.fn(async () => new ArrayBuffer(1));
    expect(await mixAudio({ doc: d, timeline: resolveTimeline(d), loader: { fetchBytes, loadRange }, range: { start: 4, end: 6 } })).not.toBeNull();
    expect(loadRange).toHaveBeenCalledWith(d.assets['m'], 1, 3, undefined);
    expect(fetchBytes).not.toHaveBeenCalled();
    expect(calls.find((c) => c.method === 'ctx')?.args).toEqual([2, 96000, 48000]);
    expect(calls.find((c) => c.method === 'start')?.args).toEqual([0, 1, 2]);
  });
});

describe('§5.13 (Y) 40-3 실사 판단', () => {
  it('이어 받기 · 다시 열기 · 키프레임', () => {
    expect(readerStep({ currentTs: 1, hasIterator: true }, 1.5, 'play')).toBe('advance');
    expect(readerStep({ currentTs: 1, hasIterator: true }, 1, 'exact')).toBe('advance');
    expect(readerStep({ currentTs: 1, hasIterator: true }, 1 + FOOTAGE_SEQUENTIAL_JUMP_S + 0.1, 'play')).toBe('restart');
    expect(readerStep({ currentTs: 2, hasIterator: true }, 1, 'play')).toBe('restart');
    expect(readerStep({ currentTs: null, hasIterator: false }, 1, 'exact')).toBe('restart');
    expect(readerStep({ currentTs: 2, hasIterator: true }, 9, 'scrub')).toBe('keyframe');
  });
  it('그리기 폭 — 칸의 실제 픽셀 · 원본보다 넓지 않게 · 상한 · 짝수', () => {
    expect(footageDrawWidth(1920, 1080, 0.5)).toBe(540);
    expect(footageDrawWidth(1920, 1080, 3)).toBe(1920);
    expect(footageDrawWidth(3840, 3840, 1, 1920)).toBe(1920);
    expect(footageDrawWidth(1920, 1081, 0.5)).toBe(542);
    expect(footageDrawWidth(1920, 1080, undefined)).toBe(1920);
  });
  it.each([['win32', 4], ['Windows', 4], ['darwin', 6], ['macOS', 6], ['linux', 4], ['Linux x86_64', 4], ['CrOS', 3], ['Chrome OS', 3]])('디코더 상한 %s → %i', (platform, limit) => {
    expect(footageDecoderLimit(platform as string)).toBe(limit);
  });
  it('기기 예산은 OS 의 디코더 상한을 넘지 못한다(작은 쪽 · 1 이상)', () => {
    expect(effectiveFootageReaderLimit(4, 'win32')).toBe(4);
    expect(effectiveFootageReaderLimit(4, 'darwin')).toBe(4);
    expect(effectiveFootageReaderLimit(4, 'CrOS')).toBe(3);
    expect(effectiveFootageReaderLimit(2, 'linux')).toBe(2);
    expect(effectiveFootageReaderLimit(0, 'linux')).toBe(1);
  });
  it('회수 오류 판정', () => {
    expect(isDecoderReclaimError(Object.assign(new Error('x'), { name: 'QuotaExceededError' }))).toBe(true);
    expect(isDecoderReclaimError(new Error('Codec reclaimed due to inactivity.'))).toBe(true);
    expect(isDecoderReclaimError(new Error('Decoding error.'))).toBe(false);
  });
  it('곧 시작할 실사 아이템(가까운 것부터)', () => {
    const d: VideoDoc = { ...createEmptyDoc('t', 'T'), tracks: [{ id: 'v', kind: 'visual', items: [
      { id: 'a', kind: 'footage', assetId: 'x', at: 2, duration: 2, trimStart: 72.6 },
      { id: 'b', kind: 'footage', assetId: 'y', at: 5, duration: 2 },
      { id: 'c', kind: 'footage', assetId: 'x', at: 9, duration: 2 },
    ] }], assets: {} };
    expect(upcomingFootage(resolveTimeline(d), 1, new Set(), 3)).toEqual([{ itemId: 'a', assetId: 'x', sourceTime: 72.6 }]);
    expect(upcomingFootage(resolveTimeline(d), 2.5, new Set(['a']), 3)).toEqual([{ itemId: 'b', assetId: 'y', sourceTime: 0 }]);
  });
});

describe('§5.13 (Y) 40-8 ① 데운 뒤 쉬기 · ⑤ 긴 프레임이면 줄이기', () => {
  it('첫 그림 전에는 깨운 채 — 그린 뒤 쉬고 — 컷 두 프레임 전에 다시 깨운다', () => {
    expect(warmSlotState({ start: 10, t: 0, fps: 30, painted: false })).toBe('prime');
    expect(warmSlotState({ start: 10, t: 0, fps: 30, painted: true })).toBe('rest');
    expect(warmSlotState({ start: 10, t: 10 - STAGE_WARM_PRIME_FRAMES / 30, fps: 30, painted: true })).toBe('prime');
    expect(warmSlotState({ start: 10, t: 9.5, fps: 30, painted: true })).toBe('rest');
    expect(warmSlotState({ start: null, t: 5, fps: 30, painted: true })).toBe('rest');
    // fps 가 높아도 50ms 앞당김 하한
    expect(warmSlotState({ start: 10, t: 9.96, fps: 120, painted: true })).toBe('prime');
  });
  it('긴 프레임이 이어지면 데우기를 하나씩 줄인다', () => {
    const base = { aheadSeconds: 5, aheadMax: 2, keepParked: 2, parkedTtlMs: 30_000 };
    expect(adaptWarm(base, STAGE_WARM_LONG_FRAMES - 1)).toBe(base);
    expect(adaptWarm(base, STAGE_WARM_LONG_FRAMES)).toEqual({ ...base, aheadMax: 1, keepParked: 1 });
    expect(adaptWarm({ ...base, aheadMax: 0, keepParked: 0 }, 9)).toEqual({ ...base, aheadMax: 0, keepParked: 0 });
  });
});
