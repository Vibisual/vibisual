import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoAsset } from '../types.js';
import { MediabunnyMediaProvider, setFootageReaderLimit } from './media.js';

/**
 * Mediabunny 를 흉내 낸다 — 표본(프레임)은 `timestamp` 를 들고 `drawWithFit`·`close` 를 센다. 반복자(`samples`)는 그 시각을 담은
 * 프레임부터 30fps 로 낸다(진짜와 같은 뜻 — 첫 프레임 = 시작 시각을 담은 것).
 */
interface FakeSample { timestamp: number; duration: number; drawWithFit: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }

const mocks = vi.hoisted(() => ({
  input: vi.fn(), video: vi.fn(), audio: vi.fn(), duration: vi.fn(), image: vi.fn(), dispose: vi.fn(),
  samples: vi.fn(), getSample: vi.fn(), keyPacket: vi.fn(), returned: vi.fn(), made: [] as FakeSample[], failNext: null as Error | null,
  sinkOptions: vi.fn(), audioBuffers: vi.fn(),
}));

function sample(t: number): FakeSample {
  const s = { timestamp: t, duration: 1 / 30, drawWithFit: vi.fn(), close: vi.fn() };
  mocks.made.push(s);
  return s;
}

vi.mock('mediabunny', () => ({
  ALL_FORMATS: [],
  BlobSource: class {}, UrlSource: class {},
  VideoSampleSink: class {
    constructor(_track: unknown, options: unknown) { mocks.sinkOptions(options); }
    samples(start: number) {
      mocks.samples(start);
      let i = Math.max(0, Math.floor(start * 30 + 1e-6));
      return {
        async next() {
          if (mocks.failNext) { const e = mocks.failNext; mocks.failNext = null; throw e; }
          const s = sample(i / 30); i += 1; return { value: s, done: false };
        },
        async return() { mocks.returned(); return { value: undefined, done: true }; },
        [Symbol.asyncIterator]() { return this; },
      };
    }
    async getSample(t: number) { mocks.getSample(t); return sample(t); }
  },
  EncodedPacketSink: class { getKeyPacket = mocks.keyPacket; },
  AudioBufferSink: class { buffers(from: number, to: number) { return mocks.audioBuffers(from, to); } },
  Input: class {
    constructor() { mocks.input(); }
    getPrimaryVideoTrack = mocks.video;
    getPrimaryAudioTrack = mocks.audio;
    computeDuration = mocks.duration;
    dispose = mocks.dispose;
  },
}));

class FakeCanvas {
  constructor(public width: number, public height: number) {}
  getContext(): object { return { clearRect: vi.fn(), imageSmoothingQuality: 'low' }; }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.made.length = 0;
  mocks.failNext = null;
  mocks.video.mockResolvedValue({ displayWidth: 1920, displayHeight: 1080, rotation: 0, getDecoderConfig: async () => null });
  mocks.audio.mockResolvedValue({});
  mocks.duration.mockResolvedValue(8);
  mocks.keyPacket.mockImplementation(async (t: number) => ({ timestamp: Math.floor(t / 2) * 2 }));
  vi.stubGlobal('createImageBitmap', mocks.image);
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
  setFootageReaderLimit(4);
});
afterEach(() => { vi.unstubAllGlobals(); });

function provider(kind: VideoAsset['kind'], ids: readonly string[] = ['source']): MediabunnyMediaProvider {
  return new MediabunnyMediaProvider({
    assets: Object.fromEntries(ids.map((id) => [id, { id, kind, source: { kind: 'file' as const, path: `${id}.${kind}` } }])),
    loader: { open: async () => new Blob(['source bytes']) },
  });
}
const painted = (): FakeSample[] => mocks.made.filter((s) => s.drawWithFit.mock.calls.length > 0);

describe('media measurement', () => {
  it('measures a decoded image without opening a video demuxer', async () => {
    const close = vi.fn();
    const bitmap = { width: 320, height: 180, close };
    mocks.image.mockResolvedValue(bitmap);
    const media = provider('image');
    expect(await media.measure('source')).toEqual({ duration: null, width: 320, height: 180, hasAudio: false });
    expect(await media.getImage('source')).toBe(bitmap);
    expect(mocks.image).toHaveBeenCalledTimes(1);
    expect(mocks.input).not.toHaveBeenCalled();
    media.dispose();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('returns null when the browser cannot decode an imported image', async () => {
    mocks.image.mockRejectedValue(new Error('Corrupt image'));
    const media = provider('image');
    expect(await media.measure('source')).toBeNull();
    expect(mocks.input).not.toHaveBeenCalled();
    media.dispose();
  });

  it.each([true, false])('records whether a video contains audio: %s', async (hasAudio) => {
    mocks.audio.mockResolvedValue(hasAudio ? {} : null);
    const media = provider('video');
    expect(await media.measure('source')).toEqual({ duration: 8, width: 1920, height: 1080, hasAudio });
    media.dispose();
  });

  it('keeps audio detection unknown if probing fails', async () => {
    mocks.audio.mockRejectedValue(new Error('Unavailable metadata'));
    const media = provider('video');
    expect(await media.measure('source')).toEqual({ duration: 8, width: 1920, height: 1080 });
    media.dispose();
  });

  it('measures an audio-only source without inventing video dimensions', async () => {
    mocks.video.mockResolvedValue(null);
    const media = provider('audio');
    expect(await media.measure('source')).toEqual({ duration: 8, width: null, height: null, hasAudio: true });
    media.dispose();
  });
});

describe('§5.13 (X) 39-8 media lifetime', () => {
  it('disposes opened inputs so decoders are released without waiting for GC', async () => {
    const media = provider('video');
    await media.measure('source');
    expect(mocks.dispose).not.toHaveBeenCalled();
    media.dispose();
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });

  it('shares one input when the same asset is opened twice at once', async () => {
    const media = provider('video');
    await Promise.all([media.measure('source'), media.getFrame('source', 0), media.measure('source')]);
    expect(mocks.input).toHaveBeenCalledTimes(1);
    media.dispose();
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });

  it('closes an input that finishes opening after the provider was disposed', async () => {
    let release: (() => void) | null = null;
    mocks.video.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ displayWidth: 1, displayHeight: 1, rotation: 0 }); }));
    const media = provider('video');
    const pending = media.getFrame('source', 0);
    await vi.waitFor(() => expect(release).not.toBeNull());
    media.dispose();
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
    release!();
    expect(await pending).toBeNull();
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });

  it('does not reopen media after disposal, including delayed loader results', async () => {
    let release!: (blob: Blob) => void;
    const open = vi.fn(() => new Promise<Blob>(resolve => { release = resolve; }));
    const media = new MediabunnyMediaProvider({
      assets: { source: { id: 'source', kind: 'video', source: { kind: 'file', path: 'source.mp4' } } }, loader: { open },
    });
    const pending = media.getFrame('source', 0);
    media.dispose();
    release(new Blob(['video']));
    expect(await pending).toBeNull();
    expect(await media.getFrame('source', 0)).toBeNull();
    expect(await media.getImage('source')).toBeNull();
    expect(await media.measure('source')).toBeNull();
    expect(await media.measureDuration('source')).toBeNull();
    expect(open).toHaveBeenCalledTimes(1);
    expect(mocks.input).not.toHaveBeenCalled();
    expect(mocks.image).not.toHaveBeenCalled();
  });

  it('aborts image URL reads and does not decode their late responses', async () => {
    let release!: (value: Response) => void;
    const fetchFn = vi.fn(() => new Promise<Response>(resolve => { release = resolve; }));
    const media = new MediabunnyMediaProvider({
      assets: { source: { id: 'source', kind: 'image', source: { kind: 'file', path: 'source.png' } } },
      loader: { open: async () => 'https://example.test/source.png' }, fetchFn,
    });
    const pending = media.getImage('source');
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
    const signal = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].signal!;
    media.dispose();
    expect(signal.aborted).toBe(true);
    release(new Response(new Blob(['image'])));
    expect(await pending).toBeNull();
    expect(mocks.image).not.toHaveBeenCalled();
  });

  it('closes bitmaps that finish decoding after disposal exactly once', async () => {
    let release!: (value: ImageBitmap) => void;
    mocks.image.mockImplementationOnce(() => new Promise<ImageBitmap>(resolve => { release = resolve; }));
    const media = provider('image');
    const pending = media.getImage('source');
    await vi.waitFor(() => expect(mocks.image).toHaveBeenCalledOnce());
    media.dispose();
    const close = vi.fn();
    release({ close } as unknown as ImageBitmap);
    expect(await pending).toBeNull();
    media.dispose();
    expect(close).toHaveBeenCalledOnce();
  });

  it('drops frames that finish decoding after disposal and closes their iterator', async () => {
    const media = provider('video');
    await media.getFrame('source', 0);
    media.dispose();
    await vi.waitFor(() => expect(mocks.returned).toHaveBeenCalled());
    expect(await media.getFrame('source', 0.1)).toBeNull();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
});

describe('§5.13 (Y) 40-3 실사 읽개 — 순서대로 받고, 늦으면 건너뛰고, 그린 즉시 닫는다', () => {
  it('재생 중 프레임마다 새 디코더를 열지 않는다 — 반복자 하나로 이어 받는다', async () => {
    const media = provider('video');
    media.setFrameMode('play');
    for (let f = 0; f < 30; f += 1) expect(await media.getFrame('source', f / 30, { itemId: 'clip' })).not.toBeNull();
    expect(mocks.samples).toHaveBeenCalledTimes(1);
    expect(mocks.getSample).not.toHaveBeenCalled();
    media.dispose();
  });

  it('시계보다 늦은 프레임은 그리지 않고 닫는다 — 지난 것 중 가장 가까운 한 장만 그린다', async () => {
    const media = provider('video');
    media.setFrameMode('play');
    await media.getFrame('source', 0, { itemId: 'clip' });
    mocks.made.forEach((s) => s.drawWithFit.mockClear());
    await media.getFrame('source', 0.5, { itemId: 'clip' });
    const drawn = painted();
    expect(drawn.map((s) => Math.round(s.timestamp * 30))).toEqual([15]);
    // 건너뛴 프레임(1~14)도 모두 닫혔다(디코더 출력이 쌓이지 않게).
    for (const s of mocks.made.filter((x) => x.timestamp > 0 && x.timestamp < 0.5)) expect(s.close).toHaveBeenCalledOnce();
    media.dispose();
  });

  it('그린 표본은 곧바로 닫는다', async () => {
    const media = provider('video');
    await media.getFrame('source', 1);
    const first = painted()[0]!;
    expect(first.close).toHaveBeenCalledOnce();
    media.dispose();
  });

  it('뒤로 가면 그 자리에서 다시 연다(키프레임부터)', async () => {
    const media = provider('video');
    media.setFrameMode('play');
    await media.getFrame('source', 2, { itemId: 'clip' });
    await media.getFrame('source', 1, { itemId: 'clip' });
    expect(mocks.samples).toHaveBeenCalledTimes(2);
    expect(mocks.returned).toHaveBeenCalledTimes(1);
    media.dispose();
  });

  it('디코더가 회수되면(QuotaExceededError) 반복자를 새로 만들어 그 프레임을 낸다', async () => {
    const media = provider('video');
    media.setFrameMode('play');
    await media.getFrame('source', 0, { itemId: 'clip' });
    mocks.failNext = Object.assign(new Error('Codec reclaimed due to inactivity.'), { name: 'QuotaExceededError' });
    expect(await media.getFrame('source', 0.1, { itemId: 'clip' })).not.toBeNull();
    expect(mocks.samples).toHaveBeenCalledTimes(2);
    media.dispose();
  });

  it('끄는 중(scrub)에는 가까운 키프레임 한 장만 먼저 — 같은 GOP 안에서는 다시 풀지 않는다', async () => {
    const media = provider('video');
    media.setFrameMode('scrub');
    await media.getFrame('source', 5.3);
    await media.getFrame('source', 5.6);
    expect(mocks.samples).not.toHaveBeenCalled();
    expect(mocks.getSample).toHaveBeenCalledTimes(1);
    expect(mocks.getSample).toHaveBeenCalledWith(4);
    media.setFrameMode('exact');
    await media.getFrame('source', 5.6);
    expect(mocks.samples).toHaveBeenCalledWith(5.6);
    media.dispose();
  });

  it('창마다 디코더 수를 묶는다 — 넘으면 가장 오래 안 쓴 읽개의 반복자를 닫는다', async () => {
    setFootageReaderLimit(1);
    const media = provider('video');
    await media.getFrame('source', 0, { itemId: 'a' });
    await media.getFrame('source', 0, { itemId: 'b' });
    await vi.waitFor(() => expect(mocks.returned).toHaveBeenCalledTimes(1));
    media.dispose();
  });

  it('미리보기 칸의 실제 픽셀만큼만 옮긴다(배율 × 상자 폭)', async () => {
    const media = provider('video');
    media.setDisplayScale(0.5);
    const canvas = await media.getFrame('source', 0, { boxWidth: 1080 }) as unknown as FakeCanvas;
    expect(canvas.width).toBe(540);
    expect(canvas.height).toBe(304);
    media.dispose();
  });

  it('미리 열기는 그 아이템의 첫 시각에 읽개를 세워 둔다', async () => {
    const media = provider('video');
    media.warmFootage([{ itemId: 'clip', assetId: 'source', sourceTime: 72.6 }]);
    await vi.waitFor(() => expect(mocks.samples).toHaveBeenCalledWith(72.6));
    media.setFrameMode('play');
    await media.getFrame('source', 72.62, { itemId: 'clip' });
    expect(mocks.samples).toHaveBeenCalledTimes(1);
    media.dispose();
  });
});

describe('§5.13 (Y) 40-6 소재 목록 갈아 끼우기', () => {
  it('그대로인 소재의 입력은 남기고, 바뀐 소재의 입력만 닫는다', async () => {
    const media = provider('video', ['a', 'b']);
    await media.getFrame('a', 0);
    await media.getFrame('b', 0);
    expect(mocks.input).toHaveBeenCalledTimes(2);
    const changed = media.setAssets({
      a: { id: 'a', kind: 'video', source: { kind: 'file', path: 'a.video' } },
      b: { id: 'b', kind: 'video', source: { kind: 'file', path: 'b-new.mp4' } },
    });
    expect(changed).toEqual(['b']);
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
    await media.getFrame('a', 0.1);
    expect(mocks.input).toHaveBeenCalledTimes(2);
    await media.getFrame('b', 0);
    expect(mocks.input).toHaveBeenCalledTimes(3);
    media.dispose();
  });
});

describe('§5.13 (Y) 40-2 소리 조각', () => {
  it('쓰는 구간의 조각만 풀어 하나의 버퍼로 잇는다', async () => {
    class FakeAudioBuffer {
      readonly length: number; readonly numberOfChannels: number; readonly sampleRate: number; readonly data: Float32Array[];
      constructor(o: { length: number; numberOfChannels: number; sampleRate: number }) {
        this.length = o.length; this.numberOfChannels = o.numberOfChannels; this.sampleRate = o.sampleRate;
        this.data = Array.from({ length: o.numberOfChannels }, () => new Float32Array(o.length));
      }
      get duration(): number { return this.length / this.sampleRate; }
      getChannelData(c: number): Float32Array { return this.data[c]!; }
      copyToChannel(src: Float32Array, c: number, offset: number): void { this.data[c]!.set(src, offset); }
    }
    vi.stubGlobal('AudioBuffer', FakeAudioBuffer);
    const part = (t: number, fill: number) => {
      const b = new FakeAudioBuffer({ length: 4, numberOfChannels: 1, sampleRate: 4 });
      b.data[0]!.fill(fill);
      return { buffer: b, timestamp: t, duration: 1 };
    };
    mocks.audio.mockResolvedValue({ canDecode: async () => true, sampleRate: 4 });
    mocks.audioBuffers.mockImplementation(async function* () { yield part(8, 0.25); yield part(9, 0.5); });
    const media = provider('video');
    const chunk = await media.getAudioChunk('source', 1, 8);
    expect(mocks.audioBuffers).toHaveBeenCalledWith(8, 16);
    expect(chunk?.start).toBe(8);
    expect(Array.from((chunk!.buffer as unknown as FakeAudioBuffer).data[0]!)).toEqual([0.25, 0.25, 0.25, 0.25, 0.5, 0.5, 0.5, 0.5]);
    media.dispose();
  });

  it('소리 트랙이 없거나 풀 수 없으면 null(믹서가 통째 디코딩으로 물러선다)', async () => {
    mocks.audio.mockResolvedValue({ canDecode: async () => false });
    const media = provider('video');
    expect(await media.getAudioChunk('source', 0, 8)).toBeNull();
    media.dispose();
  });
});

describe('§5.13 (Y) 40-10 ① 실사 포스터(키프레임 한 장)', () => {
  const ITEM = { assetId: 'source', itemId: 'clip', sourceTime: 5 };

  it('prepares one small keyframe poster per item, and during playback a fresh reader shows it first while the first frame decodes behind', async () => {
    const media = provider('video');
    expect(await media.preparePosters([ITEM])).toBe(1);
    expect(mocks.keyPacket).toHaveBeenCalledWith(5, { metadataOnly: true });
    expect(mocks.getSample).toHaveBeenCalledWith(4); // 5초를 담은 GOP 의 키프레임(가짜: 2초 간격)
    expect(mocks.made[mocks.made.length - 1]!.close).toHaveBeenCalled();
    expect(media.posterStats().count).toBe(1);
    expect(await media.preparePosters([ITEM])).toBe(0); // 이미 있다 — 다시 풀지 않는다
    media.setFrameMode('play');
    const first = await media.getFrame('source', 5, { itemId: 'clip' });
    expect(first).toBeInstanceOf(FakeCanvas);
    expect((first as unknown as FakeCanvas).width).toBe(480);
    // 읽개는 뒤에서 첫 프레임을 푼다 — 다 풀리면 다음 요청은 진짜 프레임이다.
    await vi.waitFor(() => expect(painted().length).toBeGreaterThanOrEqual(2));
    const next = await media.getFrame('source', 5 + 1 / 30, { itemId: 'clip' });
    expect(next).not.toBe(first);
    expect((next as unknown as FakeCanvas).width).toBe(1920);
    media.dispose();
  });

  it('paused (exact) never takes the poster, and a changed asset drops its posters', async () => {
    const media = provider('video');
    await media.preparePosters([ITEM]);
    media.setFrameMode('exact');
    const exact = await media.getFrame('source', 5, { itemId: 'clip' });
    expect((exact as unknown as FakeCanvas).width).toBe(1920);
    media.setAssets({ source: { id: 'source', kind: 'video', source: { kind: 'file', path: 'other.mp4' } } });
    expect(media.posterStats().count).toBe(0);
    media.dispose();
  });

  it('stays within the byte budget (oldest out) and keeps none when the budget is 0', async () => {
    const assets = { source: { id: 'source', kind: 'video' as const, source: { kind: 'file' as const, path: 'source.video' } } };
    const loader = { open: async () => new Blob(['source bytes']) };
    const one = new MediabunnyMediaProvider({ assets, loader, posterCacheBytes: 480 * 270 * 4 + 64 });
    await one.preparePosters([ITEM, { ...ITEM, itemId: 'clip-2', sourceTime: 1 }]);
    expect(one.posterStats().count).toBe(1);
    one.dispose();
    const none = new MediabunnyMediaProvider({ assets, loader, posterCacheBytes: 0 });
    expect(await none.preparePosters([ITEM])).toBe(0);
    expect(none.posterStats().count).toBe(0);
    none.dispose();
  });
});
