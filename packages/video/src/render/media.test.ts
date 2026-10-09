import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoAsset } from '../types.js';
import { MediabunnyMediaProvider } from './media.js';

const mocks = vi.hoisted(() => ({
  input: vi.fn(), video: vi.fn(), audio: vi.fn(), duration: vi.fn(), image: vi.fn(),
}));
vi.mock('mediabunny', () => ({
  ALL_FORMATS: [],
  BlobSource: class {}, UrlSource: class {}, CanvasSink: class {},
  Input: class {
    constructor() { mocks.input(); }
    getPrimaryVideoTrack = mocks.video;
    getPrimaryAudioTrack = mocks.audio;
    computeDuration = mocks.duration;
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.video.mockResolvedValue({ displayWidth: 1920, displayHeight: 1080 });
  mocks.audio.mockResolvedValue({});
  mocks.duration.mockResolvedValue(8);
  vi.stubGlobal('createImageBitmap', mocks.image);
});
afterEach(() => { vi.unstubAllGlobals(); });
function provider(kind: VideoAsset['kind']): MediabunnyMediaProvider {
  return new MediabunnyMediaProvider({ assets: { source: { id: 'source', kind, source: { kind: 'file', path: `source.${kind}` } } },
    loader: { open: async () => new Blob(['source bytes']) },
  });
}

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
