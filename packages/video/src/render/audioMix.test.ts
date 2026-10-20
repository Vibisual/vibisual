import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDoc } from '../ops.js';
import { resolveTimeline } from '../resolveTimeline.js';
import type { VideoDoc } from '../types.js';
import { mixAudio } from './audioMix.js';

const decode = vi.fn(); const render = vi.fn(); const source = vi.fn(); const contexts = vi.fn(); const gain = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); decode.mockReset(); render.mockReset();
  vi.stubGlobal('OfflineAudioContext', class {
    destination = {};
    constructor() { contexts(); }
    decodeAudioData = decode;
    startRendering = render;
    createBufferSource = source;
    createGain = gain;
  });
});
afterEach(() => vi.unstubAllGlobals());
function options(signal: AbortSignal, fetchBytes: () => Promise<ArrayBuffer | null>) {
  const doc: VideoDoc = { ...createEmptyDoc('audio', 'Audio'), assets: {
    a: { id: 'a', kind: 'audio', source: { kind: 'file', path: 'a.wav' } },
    b: { id: 'b', kind: 'audio', source: { kind: 'file', path: 'b.wav' } },
  }, tracks: [{ id: 'voice', kind: 'audio', items: [
    { id: 'a', kind: 'audio', at: 0, duration: 2, assetId: 'a' },
    { id: 'b', kind: 'audio', at: 2, duration: 2, assetId: 'b' },
  ] }] };
  return { doc, timeline: resolveTimeline(doc), signal, loader: { fetchBytes }, onWarn: vi.fn() };
}

describe('mixAudio cancellation', () => {
  it('does not allocate an offline context for an already cancelled preview', async () => {
    const abort = new AbortController(); abort.abort();
    const opts = options(abort.signal, vi.fn());
    await expect(mixAudio(opts)).rejects.toMatchObject({ name: 'AbortError' });
    expect(contexts).not.toHaveBeenCalled();
    expect(opts.loader.fetchBytes).not.toHaveBeenCalled();
  });

  it('does not decode fetched bytes or advance to the next asset after close', async () => {
    const abort = new AbortController();
    const fetchBytes = vi.fn(async () => { abort.abort(); return new ArrayBuffer(2); });
    const opts = options(abort.signal, fetchBytes);
    await expect(mixAudio(opts)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchBytes).toHaveBeenCalledOnce();
    expect(decode).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(opts.onWarn).not.toHaveBeenCalled();
  });

  it('does not schedule a decoded buffer or render an obsolete mix', async () => {
    const abort = new AbortController();
    decode.mockImplementation(async () => { abort.abort(); return { duration: 2 }; });
    const fetchBytes = vi.fn(async () => new ArrayBuffer(2));
    const opts = options(abort.signal, fetchBytes);
    await expect(mixAudio(opts)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchBytes).toHaveBeenCalledOnce();
    expect(source).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(opts.onWarn).not.toHaveBeenCalled();
  });

  it('detaches already scheduled buffers immediately while a later decode is pending', async () => {
    const abort = new AbortController();
    const node = { buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    const gainNode = { connect: vi.fn(), disconnect: vi.fn(), gain: { setValueAtTime: vi.fn() } };
    source.mockReturnValue(node); gain.mockReturnValue(gainNode);
    let finish!: (value: { duration: number }) => void;
    decode.mockResolvedValueOnce({ duration: 2 }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const opts = options(abort.signal, async () => new ArrayBuffer(2));
    const pending = mixAudio(opts);
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(2));
    expect(node.buffer).not.toBeNull();
    abort.abort();
    expect(node.stop).toHaveBeenCalledOnce();
    expect(node.disconnect).toHaveBeenCalledOnce();
    expect(node.buffer).toBeNull();
    expect(gainNode.disconnect).toHaveBeenCalledOnce();
    finish({ duration: 2 });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(render).not.toHaveBeenCalled();
    expect(node.disconnect).toHaveBeenCalledOnce();
  });

  it('keeps the completed mix but releases offline source graphs after rendering', async () => {
    const abort = new AbortController();
    const nodes = [0, 1].map(() => ({ buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() }));
    source.mockReturnValueOnce(nodes[0]).mockReturnValueOnce(nodes[1]);
    gain.mockImplementation(() => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { setValueAtTime: vi.fn() } }));
    decode.mockResolvedValue({ duration: 2 });
    const mixed = { duration: 4 };
    render.mockResolvedValue(mixed);
    expect(await mixAudio(options(abort.signal, async () => new ArrayBuffer(2)))).toBe(mixed);
    for (const node of nodes) {
      expect(node.start).toHaveBeenCalledOnce();
      expect(node.disconnect).toHaveBeenCalledOnce();
      expect(node.buffer).toBeNull();
    }
  });
});
