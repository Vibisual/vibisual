import { describe, expect, it } from 'vitest';
import { audioDocDuration, renderAudioDoc, type AudioClip, type AudioDoc } from '@vibisual/audio';
import { sourceAuditionDoc } from './soundModel.js';

const RATE = 8000;
function document(): AudioDoc {
  return {
    schemaVersion: 1, id: 'audition', title: 'Mix', version: 7, sampleRate: RATE, channels: 1,
    createdAt: 1, updatedAt: 7,
    assets: {
      voice: { id: 'voice', path: '.vibisual/audio/assets/voice.wav', name: 'voice.wav', duration: 8, sampleRate: RATE, channels: 1 },
      music: { id: 'music', path: '.vibisual/audio/assets/music.wav', name: 'music.wav', duration: 8, sampleRate: RATE, channels: 1 },
    },
    tracks: [
      { id: 'voice-track', muted: true, gainDb: -12, clips: [
        { id: 'chosen', assetId: 'voice', at: 2, sourceStart: 1, duration: 3, enabled: false,
          gainDb: -12, fadeIn: 1, fadeOut: 1, gainEnvelope: { offset: 0.5, duration: 4, fadeIn: 2, fadeOut: 2 } },
        { id: 'same-track', assetId: 'music', at: 3, sourceStart: 0, duration: 5 },
      ] },
      { id: 'music-track', solo: true, gainDb: 12, clips: [
        { id: 'later', assetId: 'music', at: 10, sourceStart: 0, duration: 5 },
      ] },
    ],
  };
}
const decoded: Record<string, AudioClip> = {
  voice: { sampleRate: RATE, channels: [new Float32Array(RATE * 8).fill(0.25)] },
  music: { sampleRate: RATE, channels: [new Float32Array(RATE * 8).fill(0.75)] },
};

describe('source comparison preserves project coordinates', () => {
  it('keeps the complete timeline so a later project selection remains playable', () => {
    const doc = document();
    const audition = sourceAuditionDoc(doc, 'chosen');
    expect(audioDocDuration(audition)).toBe(audioDocDuration(doc));
    const pcm = renderAudioDoc(audition, decoded);
    expect(pcm.channels[0]?.length).toBe(15 * RATE);
    const later = renderAudioDoc(audition, decoded, { start: 10, end: 12 });
    expect(later.channels[0]?.length).toBe(2 * RATE);
    expect(later.channels[0]?.every(sample => sample === 0)).toBe(true);
  });

  it('auditions only the chosen source, ignoring clip and track mix controls', () => {
    const pcm = renderAudioDoc(sourceAuditionDoc(document(), 'chosen'), decoded);
    const channel = pcm.channels[0]!;
    expect(channel[Math.round(2.1 * RATE)]).toBeCloseTo(0.25);
    expect(channel[Math.round(3.5 * RATE)]).toBeCloseTo(0.25);
    expect(channel[Math.round(4.9 * RATE)]).toBeCloseTo(0.25);
    expect(channel.subarray(0, 2 * RATE).every(sample => sample === 0)).toBe(true);
    expect(channel.subarray(5 * RATE).every(sample => sample === 0)).toBe(true);
  });

  it('leaves the saved document and original audio unchanged', () => {
    const doc = document(); const before = JSON.stringify(doc);
    renderAudioDoc(sourceAuditionDoc(doc, 'chosen'), decoded);
    expect(JSON.stringify(doc)).toBe(before);
    expect(doc.version).toBe(7);
    expect(decoded.voice?.channels[0]?.every(sample => sample === 0.25)).toBe(true);
    expect(decoded.music?.channels[0]?.every(sample => sample === 0.75)).toBe(true);
  });
});
