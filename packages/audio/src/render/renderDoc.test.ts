import { describe, expect, it } from 'vitest';
import { encodeWav, type AudioClip } from '../audioEdit.js';
import { applyAudioPatch, createEmptyAudioDoc } from '../ops.js';
import type { AudioDoc, AudioDocOp } from '../types.js';
import { renderAudioDoc } from './renderDoc.js';

function source(values: readonly number[], sampleRate = 8000): AudioClip {
  return { sampleRate, channels: [Float32Array.from(values)] };
}

function document(pcm: AudioClip): AudioDoc {
  const duration = (pcm.channels[0]?.length ?? 0) / pcm.sampleRate;
  return {
    ...createEmptyAudioDoc('doc', 'Mix', 1000), sampleRate: 8000, channels: 1,
    assets: { source: { id: 'source', name: 'source.wav', path: 'source.wav', duration, sampleRate: pcm.sampleRate, channels: pcm.channels.length === 1 ? 1 : 2 } },
    tracks: [{ id: 'audio', clips: [{ id: 'clip', assetId: 'source', at: 0, sourceStart: 0, duration }] }],
  };
}

function edit(doc: AudioDoc, ops: readonly AudioDocOp[]): AudioDoc {
  const result = applyAudioPatch(doc, { baseVersion: doc.version, ops }, 2000);
  if (!result.ok) throw new Error(result.message);
  return result.doc;
}

function mono(doc: AudioDoc, pcm: AudioClip): Float32Array {
  return renderAudioDoc(doc, { source: pcm }).channels[0] ?? new Float32Array();
}

function sameSamples(actual: Float32Array, expected: Float32Array): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i += 1) expect(actual[i]).toBeCloseTo(expected[i] ?? 0, 6);
}

describe('sample-accurate non-destructive rendering', () => {
  const pcm = source(Array.from({ length: 80 }, (_, i) => Math.sin(i / 8) / 2));

  it('splits without an audible change inside overlapping fades, including off-grid cuts', () => {
    const doc = edit(document(pcm), [{ op: 'updateClip', clipId: 'clip', patch: { fadeIn: 0.008, fadeOut: 0.008 } }]);
    const cut = edit(doc, [{ op: 'splitClip', clipId: 'clip', at: 0.00431, newClipId: 'right' }]);
    sameSamples(mono(cut, pcm), mono(doc, pcm));
  });

  it('crops the original samples and their original fade amplitudes', () => {
    const doc = edit(document(pcm), [{ op: 'updateClip', clipId: 'clip', patch: { fadeIn: 0.008, fadeOut: 0.007 } }]);
    const crop = edit(doc, [{ op: 'cropClip', clipId: 'clip', start: 0.002, end: 0.007 }]);
    sameSamples(mono(crop, pcm), mono(doc, pcm).slice(16, 56));
  });

  it('deletes a middle range by joining original samples with their fades', () => {
    const doc = edit(document(pcm), [{ op: 'updateClip', clipId: 'clip', patch: { fadeIn: 0.008, fadeOut: 0.007 } }]);
    const cut = edit(doc, [{ op: 'deleteClipRange', clipId: 'clip', start: 0.002, end: 0.005, newClipId: 'right' }]);
    const original = mono(doc, pcm);
    sameSamples(mono(cut, pcm), Float32Array.from([...original.slice(0, 16), ...original.slice(40)]));
  });

  it('renders selected ranges from the same project sample grid', () => {
    const doc = document(pcm);
    const full = mono(doc, pcm);
    const range = renderAudioDoc(doc, { source: pcm }, { start: 0.00203, end: 0.00507 });
    sameSamples(range.channels[0] ?? new Float32Array(), full.slice(Math.ceil(0.00203 * 8000), Math.ceil(0.00507 * 8000)));
  });
});

describe('mixing, channels, and export parity', () => {
  it('linearly resamples and preserves duration', () => {
    const pcm = source([0, 0.25, 0.5, 0.75]);
    const result = renderAudioDoc({ ...document(pcm), sampleRate: 16000 }, { source: pcm });
    expect(result.sampleRate).toBe(16000);
    expect([...result.channels[0] ?? []]).toEqual([0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.75]);
  });

  it('duplicates mono into stereo and averages stereo into mono', () => {
    const pcm = source([0.25, 0.5]);
    const stereo = renderAudioDoc({ ...document(pcm), channels: 2 }, new Map([['source', pcm]]));
    expect(stereo.channels[1]).toEqual(pcm.channels[0]);
    const two: AudioClip = { sampleRate: 8000, channels: [Float32Array.from([1, 0]), Float32Array.from([-1, 0.5])] };
    expect([...mono(document(two), two)]).toEqual([0, 0.25]);
  });

  it('combines track and clip gain and obeys mute/solo without shrinking the timeline', () => {
    const pcm = source([0.5, 0.5]);
    const doc = edit(document(pcm), [
      { op: 'updateTrack', trackId: 'audio', patch: { gainDb: -6 } },
      { op: 'updateClip', clipId: 'clip', patch: { gainDb: -6 } },
      { op: 'addTrack', track: { id: 'solo', solo: true, clips: [{ id: 'other', assetId: 'source', at: 0.001, sourceStart: 0, duration: 0.00025 }] } },
    ]);
    expect([...mono(doc, pcm)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5]);
    const unsolo = edit(doc, [{ op: 'updateTrack', trackId: 'solo', patch: { solo: false, muted: true } }]);
    expect(mono(unsolo, pcm)[0]).toBeCloseTo(0.5 * 10 ** (-12 / 20), 6);
    expect(mono(unsolo, pcm).length).toBe(10);
  });

  it('clips after summation, preserving cancellation between loud clips', () => {
    const pcm = source([1.5, 1.5, -1.25, -1.25]);
    const doc = edit(document(pcm), [
      { op: 'updateClip', clipId: 'clip', patch: { duration: 0.00025 } },
      { op: 'addClip', trackId: 'audio', clip: { id: 'negative', assetId: 'source', at: 0, sourceStart: 0.00025, duration: 0.00025 } },
    ]);
    expect([...mono(doc, pcm)]).toEqual([0.25, 0.25]);
  });

  it('WAV stores the same preview PCM within 16-bit quantization and correct header length', () => {
    const pcm = source([-2, -0.25, 0, 0.25, 2]);
    const preview = renderAudioDoc(document(pcm), { source: pcm });
    const bytes = encodeWav(preview);
    const wav = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(bytes.length).toBe(44 + 5 * 2);
    expect(wav.getUint32(24, true)).toBe(8000);
    expect(wav.getUint16(22, true)).toBe(1);
    expect(wav.getUint32(40, true)).toBe(10);
    for (let i = 0; i < 5; i += 1) {
      const sample = preview.channels[0]?.[i] ?? 0;
      expect(wav.getInt16(44 + i * 2, true) / (sample < 0 ? 32768 : 32767)).toBeCloseTo(sample, 4);
    }
  });
});

describe('fail-closed rendering', () => {
  it('checks output memory limits before allocation or loading sources', () => {
    const doc = edit(document(source([0])), [{ op: 'updateClip', clipId: 'clip', patch: { at: 10000 } }]);
    expect(() => renderAudioDoc(doc, {})).toThrow(/memory limit/);
  });

  it('rejects absent, shortened, malformed, or non-finite PCM', () => {
    const pcm = source([0, 0, 0, 0]);
    const doc = document(pcm);
    expect(() => renderAudioDoc(doc, {})).toThrow(/unavailable/);
    expect(() => renderAudioDoc(doc, { source: source([0]) })).toThrow(/shorter/);
    expect(() => renderAudioDoc(doc, { source: { sampleRate: 8000, channels: [new Float32Array(4), new Float32Array(3)] } })).toThrow(/equally sized/);
    expect(() => renderAudioDoc(doc, { source: source([0, NaN, 0, 0]) })).toThrow(/non-finite/);
  });

  it('does not require decoding muted or disabled sources', () => {
    const doc = edit(document(source([0.5])), [{ op: 'updateTrack', trackId: 'audio', patch: { muted: true } }]);
    expect([...renderAudioDoc(doc, {}).channels[0] ?? []]).toEqual([0]);
  });

  it('rejects invalid WAV channel layout and samples', () => {
    expect(() => encodeWav({ sampleRate: 8000, channels: [new Float32Array(2), new Float32Array(1)] })).toThrow(/equally sized/);
    expect(() => encodeWav(source([NaN]))).toThrow(/non-finite/);
  });
});
