import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDoc, type VideoDoc } from '@vibisual/video';
import type { MixAudioOptions } from '@vibisual/video/render';
import { useVideoAudio } from './useVideoAudio.js';

const mocks = vi.hoisted(() => ({ mix: vi.fn(), fetch: vi.fn() }));
vi.mock('@vibisual/video/render', () => ({ mixAudio: mocks.mix }));
vi.mock('./videoApi.js', () => ({ assetUrl: (project: string, path: string) => `${project}/${path}` }));

class FakeSource {
  buffer: AudioBuffer | null = null;
  loop = false; loopStart = 0; loopEnd = 0;
  onended: (() => void) | null = null;
  connect = vi.fn(); disconnect = vi.fn(); start = vi.fn(); stop = vi.fn();
}
class FakeContext {
  static instances: FakeContext[] = [];
  currentTime = 0;
  state = 'running';
  destination = {};
  sources: FakeSource[] = [];
  resume = vi.fn(async (): Promise<void> => undefined);
  close = vi.fn(async (): Promise<void> => { this.state = 'closed'; });
  constructor() { FakeContext.instances.push(this); }
  createBufferSource(): FakeSource { const source = new FakeSource(); this.sources.push(source); return source; }
}
interface AudioProps { project: string; doc: VideoDoc | null; playing: boolean; playhead: number; loop: boolean; onError: (message: string) => void }
let handle: ReturnType<typeof useVideoAudio>;
let view: ReactTestRenderer | undefined;
function Harness(props: AudioProps): null { handle = useVideoAudio(props.project, props.doc, props.playing, props.playhead, props.loop, props.onError); return null; }
function document(): VideoDoc {
  return { ...createEmptyDoc('audio', 'Audio', 1), tracks: [{ id: 'voice', kind: 'audio', items: [
    { id: 'clip', kind: 'audio', at: 1, duration: 3, trimStart: 2, assetId: 'voice', props: { volume: 0.4, fadeIn: 0.2, fadeOut: 0.3 } },
  ] }], assets: { voice: { id: 'voice', kind: 'audio', source: { kind: 'file', path: 'voice.wav' }, duration: 10 } } };
}
function props(overrides: Partial<AudioProps> = {}): AudioProps { return { project: 'project', doc: document(), playing: false, playhead: 0, loop: false, onError: vi.fn(), ...overrides }; }
function mount(value: AudioProps): void { view = create(createElement(Harness, value)); }
function update(value: AudioProps): void { view!.update(createElement(Harness, value)); }
function context(): FakeContext { return FakeContext.instances[FakeContext.instances.length - 1]!; }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
// Only duration is read by the scheduling hook; decoding is owned by mixAudio.
const buffer = { duration: 4 } as AudioBuffer;
beforeEach(() => {
  vi.clearAllMocks(); FakeContext.instances = []; mocks.mix.mockReset(); mocks.mix.mockResolvedValue(buffer);
  vi.stubGlobal('AudioContext', FakeContext); vi.stubGlobal('OfflineAudioContext', class {}); vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.unstubAllGlobals(); });

describe('useVideoAudio', () => {
  it('unlocks audio in the play gesture and reuses the export mix semantics at the current playhead', async () => {
    const value = props({ playhead: 1.5 });
    await act(async () => mount(value));
    expect(FakeContext.instances).toHaveLength(0);
    await act(async () => { handle.resume(); update({ ...value, playing: true }); });
    expect(context().resume).toHaveBeenCalledOnce();
    const options = mocks.mix.mock.calls[0]![0] as MixAudioOptions;
    expect(options.doc).toBe(value.doc);
    expect(options.timeline.items[0]).toMatchObject({ start: 1, duration: 3, item: { trimStart: 2, props: { volume: 0.4, fadeIn: 0.2, fadeOut: 0.3 } } });
    expect(context().sources[0]?.start).toHaveBeenCalledWith(0, 1.5);
  });
  it('loads asset bytes through the current project and rejects failed HTTP responses', async () => {
    const value = props();
    await act(async () => mount(value));
    await act(async () => { handle.resume(); update({ ...value, playing: true }); });
    const options = mocks.mix.mock.calls[0]![0] as MixAudioOptions;
    const bytes = new ArrayBuffer(8);
    mocks.fetch.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => bytes });
    expect(await options.loader.fetchBytes(value.doc!.assets.voice!)).toBe(bytes);
    expect(mocks.fetch).toHaveBeenCalledWith('project/voice.wav', { signal: expect.any(AbortSignal) });
    mocks.fetch.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(options.loader.fetchBytes(value.doc!.assets.voice!)).rejects.toThrow('HTTP 404');
  });
  it('pauses immediately and resumes from a new offset without remixing the unchanged document', async () => {
    const value = props();
    await act(async () => mount(value));
    await act(async () => { handle.resume(); update({ ...value, playing: true }); });
    const first = context().sources[0]!;
    await act(async () => update({ ...value, playhead: 2 }));
    expect(first.stop).toHaveBeenCalledOnce(); expect(first.disconnect).toHaveBeenCalledOnce();
    await act(async () => update({ ...value, playhead: 2, playing: true }));
    expect(mocks.mix).toHaveBeenCalledOnce();
    expect(context().sources[1]?.start).toHaveBeenCalledWith(0, 2);
  });
  it('does not start late decoding after pause and uses the latest playhead when decoding completes', async () => {
    const pending = deferred<AudioBuffer | null>(); mocks.mix.mockReturnValue(pending.promise);
    const value = props();
    await act(async () => mount(value));
    await act(async () => { handle.resume(); update({ ...value, playing: true }); });
    await act(async () => update({ ...value, playing: false, playhead: 2 }));
    await act(async () => pending.resolve(buffer));
    expect(context().sources).toHaveLength(0);
    await act(async () => update({ ...value, playing: true, playhead: 2.5 }));
    expect(context().sources[0]?.start).toHaveBeenCalledWith(0, 2.5);
    expect(mocks.mix).toHaveBeenCalledOnce();
  });
  it('isolates document and project changes from stale decoded buffers and errors', async () => {
    const old = deferred<AudioBuffer | null>(); mocks.mix.mockReturnValueOnce(old.promise).mockResolvedValue(buffer);
    const value = props();
    await act(async () => mount(value));
    await act(async () => { handle.resume(); update({ ...value, playing: true }); });
    const firstOptions = mocks.mix.mock.calls[0]![0] as MixAudioOptions;
    const next = { ...value, project: 'other-project', playing: true, doc: { ...value.doc!, version: 2 } };
    await act(async () => update(next));
    await act(async () => { firstOptions.onWarn?.('old warning'); old.reject(new Error('old decode failed')); });
    expect(value.onError).not.toHaveBeenCalled();
    expect(mocks.mix).toHaveBeenCalledTimes(2);
    expect(context().sources).toHaveLength(1);
    await act(async () => update({ ...next, doc: null }));
    expect(context().sources[0]?.stop).toHaveBeenCalledOnce();
  });
  it('keeps normal playback continuous, seeks on discontinuity, and configures looping', async () => {
    const value = props({ loop: true });
    await act(async () => mount(value));
    await act(async () => { handle.resume(); update({ ...value, playing: true }); });
    expect(context().sources[0]).toMatchObject({ loop: true, loopStart: 0, loopEnd: 4 });
    context().currentTime = 0.5;
    await act(async () => update({ ...value, playing: true, playhead: 0.5 }));
    expect(context().sources).toHaveLength(1);
    await act(async () => update({ ...value, playing: true, playhead: 2 }));
    expect(context().sources).toHaveLength(2);
    expect(context().sources[1]?.start).toHaveBeenCalledWith(0, 2);
  });
  it('reports current mix warnings and failures without creating a silent source', async () => {
    mocks.mix.mockImplementationOnce(async (options: MixAudioOptions) => { options.onWarn?.('cannot decode'); return null; });
    const value = props();
    await act(async () => mount(value));
    await act(async () => { handle.resume(); update({ ...value, playing: true }); });
    expect(value.onError).toHaveBeenCalledWith('cannot decode');
    expect(context().sources).toHaveLength(0);
    mocks.mix.mockRejectedValueOnce(new Error('render failed'));
    await act(async () => update({ ...value, playing: true, doc: { ...value.doc!, version: 2 } }));
    expect(value.onError).toHaveBeenCalledWith('Error: render failed');
  });
  it('stops an existing source when seeking to the exclusive end without looping', async () => {
    const value = props();
    await act(async () => mount(value));
    await act(async () => { handle.resume(); update({ ...value, playing: true }); });
    await act(async () => update({ ...value, playing: true, playhead: 4 }));
    expect(context().sources[0]?.stop).toHaveBeenCalledOnce();
    expect(context().sources).toHaveLength(1);
  });
  it('stops, disconnects, aborts loading and closes the context on unmount', async () => {
    const value = props();
    await act(async () => mount(value));
    await act(async () => { handle.resume(); update({ ...value, playing: true }); });
    const ctx = context();
    await act(async () => { view!.unmount(); view = undefined; });
    expect(ctx.sources[0]?.stop).toHaveBeenCalledOnce();
    expect(ctx.sources[0]?.disconnect).toHaveBeenCalledOnce();
    expect(ctx.close).toHaveBeenCalledOnce();
  });
  it('is inert when browser audio APIs are unavailable', async () => {
    vi.stubGlobal('AudioContext', undefined); vi.stubGlobal('OfflineAudioContext', undefined);
    const value = props({ playing: true });
    await act(async () => mount(value));
    await act(async () => handle.resume());
    expect(mocks.mix).not.toHaveBeenCalled();
    expect(value.onError).not.toHaveBeenCalled();
  });
});
