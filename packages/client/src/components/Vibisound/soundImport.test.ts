import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUDIO_LIMITS, type AudioAsset } from '@vibisual/audio';
import { measureSoundImport } from './soundImport.js';

const mocks = vi.hoisted(() => ({ decode: vi.fn(), close: vi.fn(), fetch: vi.fn() }));
vi.mock('./soundEngine.js', () => ({ SoundEngine: class { decode = mocks.decode; close = mocks.close; } }));
const asset: AudioAsset = { id: 'source', path: '.vibisual/audio/assets/source.mp3', name: 'source.mp3', duration: 1.05, sampleRate: 44100, channels: 1 };
beforeEach(() => { Object.values(mocks).forEach(mock => mock.mockReset()); vi.stubGlobal('fetch', mocks.fetch); });
afterEach(() => vi.unstubAllGlobals());
describe('measure audible sample bounds before creating a clip', () => {
  it('uses decoded duration when a container includes encoder padding and retains original metadata', async () => {
    mocks.fetch.mockResolvedValue(new Response(new Uint8Array([1])));
    mocks.decode.mockResolvedValue({ sampleRate: 48000, channels: [new Float32Array(48000)] });
    expect(await measureSoundImport('/project', asset)).toBe(1);
    expect(asset.duration).toBe(1.05);
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('does not let decoding extend beyond the registered source range', async () => {
    mocks.fetch.mockResolvedValue(new Response(new Uint8Array([1])));
    mocks.decode.mockResolvedValue({ sampleRate: 48000, channels: [new Float32Array(96000)] });
    expect(await measureSoundImport('/project', asset)).toBe(1.05);
  });
  it('closes a failed decoder and rejects oversized audio before downloading it', async () => {
    mocks.fetch.mockResolvedValue(new Response(new Uint8Array([1])));
    mocks.decode.mockRejectedValue(new Error('unsupported codec'));
    await expect(measureSoundImport('/project', asset)).rejects.toThrow('decodeError');
    expect(mocks.close).toHaveBeenCalledOnce();
    mocks.fetch.mockClear();
    await expect(measureSoundImport('/project', { ...asset, duration: AUDIO_LIMITS.maxDecodedSamples / 48000 + 1 })).rejects.toThrow('memoryLimit');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
