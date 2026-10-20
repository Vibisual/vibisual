import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDoc, type VideoDoc } from '@vibisual/video';
import type { MixAudioOptions } from '@vibisual/video/render';

const mocks = vi.hoisted(() => ({ mix: vi.fn(), loader: vi.fn() }));
vi.mock('@vibisual/video/render', () => ({ mixAudio: mocks.mix }));
vi.mock('./studioMedia.js', () => ({ studioAudioLoader: mocks.loader }));

import { AUDIO_ATTACH_FADE_S, AUDIO_CROSSFADE_S, AUDIO_PREVIEW_WINDOW_S, heardContextTime, useVideoAudio } from './useVideoAudio.js';

/**
 * §5.13 (Y) 40-2 · 40-9 — 미리보기 소리: 렌더와 같은 믹서를 **1초 창**으로 재생 머리 앞까지만 섞어 잇는다. 재생은 소리를 기다리지
 * 않고(첫 창이 준비되면 그 시각에 짧게 붙는다), 판이 바뀌면 울리는 창은 두고 다음 창부터 교차 페이드로 잇는다. 어긋났다고 다시
 * 틀지 않는다.
 */

/** 시작 앞당김(useVideoAudio 의 AUDIO_START_LEAD_S 와 같은 값 — 첫 창을 지금보다 조금 뒤에 건다). */
const LEAD = 0.06;

class FakeParam {
  events: string[] = [];
  setValueAtTime = vi.fn((v: number, t: number) => { this.events.push(`set ${v}@${t.toFixed(3)}`); });
  linearRampToValueAtTime = vi.fn((v: number, t: number) => { this.events.push(`ramp ${v}@${t.toFixed(3)}`); });
}
class FakeGain { gain = new FakeParam(); connect = vi.fn(); disconnect = vi.fn(); }
class FakeSource {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  connect = vi.fn(); disconnect = vi.fn(); start = vi.fn(); stop = vi.fn();
}
class FakeContext {
  static instances: FakeContext[] = [];
  currentTime = 0;
  baseLatency = 0;
  outputLatency = 0;
  sampleRate = 48_000;
  state = 'running';
  destination = {};
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  resume = vi.fn(async (): Promise<void> => { this.state = 'running'; });
  suspend = vi.fn(async (): Promise<void> => { this.state = 'suspended'; });
  close = vi.fn(async (): Promise<void> => { this.state = 'closed'; });
  constructor() { FakeContext.instances.push(this); }
  createBufferSource(): FakeSource { const source = new FakeSource(); this.sources.push(source); return source; }
  createGain(): FakeGain { const gain = new FakeGain(); this.gains.push(gain); return gain; }
}

interface AudioProps { project: string; doc: VideoDoc | null; onError: (message: string) => void; media?: object }
let handle: ReturnType<typeof useVideoAudio>;
let view: ReactTestRenderer | undefined;
function Harness(props: AudioProps): null { handle = useVideoAudio(props.project, props.doc, { media: (props.media ?? null) as never, onError: props.onError }); return null; }
function document(version = 1): VideoDoc {
  return { ...createEmptyDoc('audio', 'Audio', version), tracks: [{ id: 'voice', kind: 'audio', items: [
    { id: 'clip', kind: 'audio', at: 0, duration: 10, assetId: 'voice', props: { volume: 0.4 } },
  ] }], assets: { voice: { id: 'voice', kind: 'audio', source: { kind: 'file', path: 'voice.wav' }, duration: 10 } } };
}
function props(overrides: Partial<AudioProps> = {}): AudioProps { return { project: 'project', doc: document(), onError: vi.fn(), ...overrides }; }
function context(): FakeContext { return FakeContext.instances[FakeContext.instances.length - 1]!; }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function windowBuffer(seconds = AUDIO_PREVIEW_WINDOW_S): AudioBuffer { return { duration: seconds } as AudioBuffer; }
function mixRange(call: number): { start: number; end: number } {
  const options = mocks.mix.mock.calls[call]![0] as MixAudioOptions;
  return options.range!;
}
async function flush(): Promise<void> { await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); }); }

let nowMs = 0;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  nowMs = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  FakeContext.instances = [];
  mocks.mix.mockReset(); mocks.mix.mockImplementation(async () => windowBuffer());
  mocks.loader.mockReset(); mocks.loader.mockReturnValue({ fetchBytes: vi.fn() });
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('OfflineAudioContext', class {});
});
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('§5.13 (Y) 40-2 · 40-9 — 1초 창으로 앞서 섞는 미리보기 소리', () => {
  it('opens the context only in the play gesture and mixes nothing before play', async () => {
    await act(async () => { view = create(createElement(Harness, props())); });
    expect(FakeContext.instances).toHaveLength(0);
    act(() => handle.resume());
    expect(context().resume).toHaveBeenCalledOnce();
    expect(mocks.mix).not.toHaveBeenCalled();
  });

  it('schedules the first window just ahead of now with a short attach fade, and reports the heard time only once it sounds', async () => {
    await act(async () => { view = create(createElement(Harness, props())); });
    act(() => { handle.resume(); handle.play(1.5, false, 10); });
    expect(mixRange(0).start).toBeCloseTo(1.5 + LEAD, 6);
    expect(mixRange(0).end).toBeCloseTo(1.5 + LEAD + AUDIO_PREVIEW_WINDOW_S, 6);
    expect((mocks.mix.mock.calls[0]![0] as MixAudioOptions).sampleRate).toBe(48_000);
    expect(handle.now()).toBeNull(); // 아직 울리지 않는다 — 재생 시계는 벽시계가 몬다.
    await flush();
    const ctx = context();
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0]!.start).toHaveBeenCalledWith(LEAD, 0);
    expect(ctx.gains[0]!.gain.events).toEqual([`set 0@${LEAD.toFixed(3)}`, `ramp 1@${(LEAD + AUDIO_ATTACH_FADE_S).toFixed(3)}`]);
    expect(handle.now()).toBeNull(); // 붙는 시각(지금 + 앞당김) 전.
    ctx.currentTime = 0.5;
    expect(handle.now()).toBeCloseTo(1.5 + 0.5, 6);
  });

  it('keeps about one second scheduled ahead and stops at the end without looping', async () => {
    await act(async () => { view = create(createElement(Harness, props())); });
    act(() => { handle.resume(); handle.play(8.5, false, 10); });
    await flush();
    expect(mocks.mix).toHaveBeenCalledOnce(); // 앞 1초가 이미 걸렸다.
    context().currentTime = 0.3;
    await act(async () => { vi.advanceTimersByTime(120); });
    await flush();
    expect(mocks.mix).toHaveBeenCalledTimes(2);
    expect(mixRange(1).start).toBeCloseTo(8.5 + LEAD + 1, 6);
    // 끝까지 0.44초 — 그 창으로 끝나고 더 섞지 않는다.
    expect(mixRange(1).end).toBeCloseTo(10, 6);
    context().currentTime = 1.5;
    await act(async () => { vi.advanceTimersByTime(600); });
    await flush();
    expect(mocks.mix).toHaveBeenCalledTimes(2);
  });

  it('folds positions when looping and splits the window at the end', async () => {
    await act(async () => { view = create(createElement(Harness, props())); });
    act(() => { handle.resume(); handle.play(9.5, true, 10); });
    await flush();
    expect(mixRange(0).start).toBeCloseTo(9.5 + LEAD, 6);
    expect(mixRange(0).end).toBeCloseTo(10, 6);
    mocks.mix.mockImplementation(async () => windowBuffer());
    await act(async () => { vi.advanceTimersByTime(120); });
    await flush();
    expect(mixRange(1).start).toBeCloseTo(0, 6);
    expect(mixRange(1).end).toBeCloseTo(1, 6);
    context().currentTime = 0.8;
    expect(handle.now()).toBeCloseTo(((9.5 + 0.8) % 10), 6);
  });

  it('keeps the sounding window on a document change and re-mixes the rest with a short crossfade', async () => {
    const value = props();
    await act(async () => { view = create(createElement(Harness, value)); });
    act(() => { handle.resume(); handle.play(0, false, 10); });
    await flush();
    const ctx = context();
    ctx.currentTime = 0.2;
    await act(async () => { vi.advanceTimersByTime(120); });
    await flush();
    expect(ctx.sources).toHaveLength(2); // 첫 창(0.06~) + 다음 창(1.06~)
    ctx.currentTime = 0.5;
    const next = { ...value, doc: document(2) };
    await act(async () => { view!.update(createElement(Harness, next)); });
    await flush();
    // 아직 시작 안 한 창(1.06~)은 걷고, 울리는 창은 끝을 짧게 내린다.
    expect(ctx.sources[1]!.stop).toHaveBeenCalledOnce();
    expect(ctx.sources[0]!.stop).not.toHaveBeenCalled();
    expect(ctx.gains[0]!.gain.events.slice(-2)).toEqual([`set 1@${(LEAD + 1 - AUDIO_CROSSFADE_S).toFixed(3)}`, `ramp 0@${(LEAD + 1).toFixed(3)}`]);
    // 새 판으로 그 자리부터 다시 섞는다.
    const last = mocks.mix.mock.calls[mocks.mix.mock.calls.length - 1]![0] as MixAudioOptions;
    expect(last.doc).toBe(next.doc);
    expect(last.range!.start).toBeCloseTo(LEAD + 1, 6);
  });

  it('suspends while the picture catches up (no heard time) and resumes after', async () => {
    await act(async () => { view = create(createElement(Harness, props())); });
    act(() => { handle.resume(); handle.play(0, false, 10); });
    await flush();
    const ctx = context();
    ctx.currentTime = 0.5;
    expect(handle.now()).not.toBeNull();
    act(() => handle.hold(true));
    expect(ctx.suspend).toHaveBeenCalledOnce();
    expect(handle.now()).toBeNull();
    act(() => handle.hold(false));
    expect(ctx.resume).toHaveBeenCalledTimes(2);
  });

  it('stop drops scheduled sources and a pending mix never schedules late', async () => {
    const pending = deferred<AudioBuffer | null>();
    mocks.mix.mockReturnValueOnce(pending.promise);
    const value = props();
    await act(async () => { view = create(createElement(Harness, value)); });
    act(() => { handle.resume(); handle.play(0, false, 10); });
    const options = mocks.mix.mock.calls[0]![0] as MixAudioOptions;
    act(() => handle.stop());
    expect(options.signal?.aborted).toBe(true);
    await act(async () => { pending.resolve(windowBuffer()); });
    await flush();
    expect(context().sources).toHaveLength(0);
    expect(value.onError).not.toHaveBeenCalled();
  });

  it('reports a mix failure once and keeps the clock running silently', async () => {
    mocks.mix.mockRejectedValue(new Error('cannot decode'));
    const value = props();
    await act(async () => { view = create(createElement(Harness, value)); });
    act(() => { handle.resume(); handle.play(0, false, 10); });
    await flush();
    context().currentTime = 0.5;
    await act(async () => { vi.advanceTimersByTime(240); });
    await flush();
    expect(value.onError).toHaveBeenCalledExactlyOnceWith('Error: cannot decode');
    expect(context().sources).toHaveLength(0);
    expect(handle.now()).toBeNull();
  });

  it('warm decodes the chunks ahead through the same mixer without scheduling any source', async () => {
    await act(async () => { view = create(createElement(Harness, props())); });
    // 공급자가 없으면 데우지 않는다(풀 조각이 없다).
    await act(async () => { await handle.warm(2); });
    expect(mocks.mix).not.toHaveBeenCalled();
    const media = {};
    await act(async () => { view!.update(createElement(Harness, props({ media }))); });
    await act(async () => { await handle.warm(2); });
    const options = mocks.mix.mock.calls[0]![0] as MixAudioOptions;
    expect(options.range).toEqual({ start: 2, end: 2 + AUDIO_PREVIEW_WINDOW_S * 2 });
    expect(options).toMatchObject({ sampleRate: 8_000, channels: 1 });
    expect(mocks.loader).toHaveBeenCalledWith('project', media);
    expect(FakeContext.instances).toHaveLength(0);
  });

  it('closes the context on unmount and is inert without Web Audio', async () => {
    await act(async () => { view = create(createElement(Harness, props())); });
    act(() => { handle.resume(); handle.play(0, false, 10); });
    await flush();
    const ctx = context();
    await act(async () => { view!.unmount(); view = undefined; });
    expect(ctx.sources[0]!.stop).toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalledOnce();
    vi.stubGlobal('AudioContext', undefined);
    await act(async () => { view = create(createElement(Harness, props())); });
    act(() => { handle.resume(); handle.play(0, false, 10); });
    expect(mocks.mix).toHaveBeenCalledTimes(1);
  });
});

describe('heardContextTime', () => {
  it('uses the output timestamp when the browser gives one, else subtracts the output latency', () => {
    expect(heardContextTime({ currentTime: 2, baseLatency: 0.01, getOutputTimestamp: () => ({ contextTime: 1.9, performanceTime: 1_000 }) }, 1_050)).toBeCloseTo(1.95, 6);
    expect(heardContextTime({ currentTime: 2, baseLatency: 0.01, outputLatency: 0.04 }, 0)).toBeCloseTo(1.96, 6);
    expect(heardContextTime({ currentTime: 2, baseLatency: 0.01, outputLatency: 0 }, 0)).toBeCloseTo(1.99, 6);
  });
});
