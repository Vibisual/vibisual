import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDoc, type VideoDoc } from '@vibisual/video';
import { useBeatAnalysis } from './useBeatAnalysis.js';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(), load: vi.fn(), created: vi.fn(), track: vi.fn(),
  canDecode: vi.fn(), buffers: vi.fn(), dispose: vi.fn(), write: vi.fn(), onDoc: vi.fn(),
}));
vi.mock('@vibisual/video/render', () => ({ loadMediabunny: mocks.load }));
vi.mock('./assetUrl.js', () => ({ assetUrl: (_project: string, path: string) => `/media/${path}` }));
vi.mock('./studioMedia.js', () => ({
  assetPath: (asset: { source: { path: string } }) => asset.source.path,
  studioMediaFetch: () => mocks.fetch,
  assetFingerprint: async (url: string, send: typeof fetch): Promise<string> => {
    // The real helper falls back to the URL when HEAD fails, including cancellation.
    await send(url, { method: 'HEAD' }).catch(() => undefined);
    return url;
  },
}));
vi.mock('./studioIdle.js', () => ({
  runWhenIdle: async (task: () => Promise<unknown>, options: { signal: AbortSignal }) => {
    options.signal.throwIfAborted();
    return task();
  },
  waitStudioIdle: async (signal: AbortSignal) => { signal.throwIfAborted(); },
}));
vi.mock('./videoApi.js', () => ({ writeBeatFacts: mocks.write }));

const media = {
  ALL_FORMATS: [],
  UrlSource: class {},
  Input: class {
    constructor() { mocks.created(); }
    getPrimaryAudioTrack = mocks.track;
    getMetadataTags = async () => ({});
    dispose = mocks.dispose;
  },
  AudioBufferSink: class { buffers = mocks.buffers; },
};
const sample = {
  timestamp: 0,
  buffer: { numberOfChannels: 1, sampleRate: 11_025, getChannelData: () => new Float32Array(11_025) },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
let view: ReactTestRenderer | undefined;
let doc: VideoDoc;
let sequence = 0;
function Harness(): null {
  useBeatAnalysis('project', doc, mocks.onDoc);
  return null;
}
async function mount(): Promise<void> {
  await act(async () => { view = create(createElement(Harness)); });
}
async function unmount(): Promise<void> {
  await act(async () => { view?.unmount(); view = undefined; });
}
beforeEach(() => {
  vi.resetAllMocks();
  const id = `audio-${++sequence}`;
  doc = { ...createEmptyDoc(id, 'Beat analysis'), assets: {
    [id]: { id, kind: 'audio', source: { kind: 'file', path: `${id}.wav` } },
  } };
  mocks.fetch.mockResolvedValue(new Response(null));
  mocks.load.mockResolvedValue(media);
  mocks.canDecode.mockResolvedValue(true);
  mocks.track.mockResolvedValue({ canDecode: mocks.canDecode, computeDuration: async () => 1 });
  mocks.buffers.mockImplementation(async function* () { yield sample; });
  mocks.write.mockResolvedValue(doc);
});
afterEach(unmount);

describe('beat analysis lifetime', () => {
  it('aborts the fingerprint request when unmounted before loading the decoder', async () => {
    let requestSignal: AbortSignal | null | undefined;
    mocks.fetch.mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      requestSignal = init?.signal;
      requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true });
    }));
    await mount();
    expect(requestSignal?.aborted).toBe(false);
    await unmount();
    expect(requestSignal?.aborted).toBe(true);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('does not open media when the decoder module loads after unmounting', async () => {
    const loading = deferred<typeof media>();
    mocks.load.mockReturnValue(loading.promise);
    await mount();
    expect(mocks.load).toHaveBeenCalledOnce();
    await unmount();
    await act(async () => { loading.resolve(media); });
    expect(mocks.created).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('disposes the input to cancel a pending track read on unmount', async () => {
    const track = deferred<never>();
    mocks.track.mockReturnValue(track.promise);
    mocks.dispose.mockImplementation(() => track.reject(new Error('Input disposed')));
    await mount();
    expect(mocks.track).toHaveBeenCalledOnce();
    await unmount();
    expect(mocks.dispose).toHaveBeenCalled();
    expect(mocks.canDecode).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('disposes the input during decoding and never writes cancelled analysis', async () => {
    const decoding = deferred<typeof sample>();
    mocks.buffers.mockImplementation(async function* () { yield await decoding.promise; });
    mocks.dispose.mockImplementation(() => decoding.reject(new Error('Input disposed')));
    await mount();
    expect(mocks.buffers).toHaveBeenCalledOnce();
    await unmount();
    expect(mocks.dispose).toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.onDoc).not.toHaveBeenCalled();
  });

  it('writes completed analysis and releases the decoder on the normal path', async () => {
    await mount();
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith('project', doc.id, doc.id, {
      beats: [], beatsStrong: [], bpm: 0, beatsHash: expect.any(String),
    });
    expect(mocks.onDoc).toHaveBeenCalledExactlyOnceWith(doc);
    expect(mocks.dispose).toHaveBeenCalledOnce();
    await unmount();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
});
