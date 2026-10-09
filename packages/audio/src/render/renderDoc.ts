import type { AudioClip } from '../audioEdit.js';
import { AUDIO_LIMITS } from '../constants.js';
import { audioDocDuration, clipFadeGain } from '../timeline.js';
import type { AudioDoc, AudioTimelineClip, AudioTrack } from '../types.js';
import { validateAudioDoc } from '../validateDoc.js';
import { assertRenderSize, checkedSample, clipSample, validatePcm } from './pcm.js';

export type AudioDecodedAssets = Readonly<Record<string, AudioClip>> | ReadonlyMap<string, AudioClip>;
export interface AudioRenderOptions {
  /** Project timeline range; aligned to the output sample grid for preview/export parity. */
  readonly start?: number;
  readonly end?: number;
  readonly sampleRate?: number;
}

function sourceFor(assets: AudioDecodedAssets, id: string): AudioClip | undefined {
  if ('get' in assets && typeof assets.get === 'function') return assets.get(id);
  // A record may contain only audio clips, never an executable resolver.
  return Object.hasOwn(assets, id) ? (assets as Readonly<Record<string, AudioClip>>)[id] : undefined;
}

function interpolate(channel: Float32Array, position: number): number {
  const bounded = Math.max(0, Math.min(channel.length - 1, position));
  const index = Math.floor(bounded);
  const fraction = bounded - index;
  const first = checkedSample(channel[index] ?? 0);
  const second = checkedSample(channel[Math.min(index + 1, channel.length - 1)] ?? 0);
  return first + (second - first) * fraction;
}

function channelSample(source: AudioClip, outputChannel: number, outputChannels: number, position: number): number {
  const first = source.channels[0];
  if (!first) return 0;
  const second = source.channels[1];
  if (outputChannels === 1 && second) return (interpolate(first, position) + interpolate(second, position)) / 2;
  return interpolate(outputChannel === 1 && second ? second : first, position);
}

interface MixItem { readonly clip: AudioTimelineClip; readonly track: AudioTrack; readonly source: AudioClip }

function prepareItems(doc: AudioDoc, assets: AudioDecodedAssets, start: number, end: number): readonly MixItem[] {
  const solo = doc.tracks.some((track) => track.solo);
  const sources = new Map<string, AudioClip>();
  const items: MixItem[] = [];
  let decodedSamples = 0;
  for (const track of doc.tracks) {
    if (track.muted || (solo && !track.solo)) continue;
    for (const clip of track.clips) {
      if (clip.enabled === false || clip.at >= end || clip.at + clip.duration <= start) continue;
      let source = sources.get(clip.assetId);
      if (!source) {
        source = sourceFor(assets, clip.assetId);
        if (!source) throw new Error(`Decoded asset '${clip.assetId}' is unavailable.`);
        decodedSamples += validatePcm(source) * source.channels.length;
        if (decodedSamples > AUDIO_LIMITS.maxDecodedSamples) throw new Error('Decoded audio sources exceed the memory limit.');
        sources.set(clip.assetId, source);
      }
      const sourceDuration = (source.channels[0]?.length ?? 0) / source.sampleRate;
      if (clip.sourceStart + clip.duration > sourceDuration + 1 / source.sampleRate + AUDIO_LIMITS.timeEpsilon) {
        throw new Error(`Decoded asset '${clip.assetId}' is shorter than the requested source range.`);
      }
      items.push({ clip, track, source });
    }
  }
  return items;
}

function mixItem(item: MixItem, channels: readonly Float32Array[], sampleRate: number, firstFrame: number, finalFrame: number): void {
  const { clip, track, source } = item;
  // ceil puts each sample in exactly one half-open clip, including after a split.
  const first = Math.max(firstFrame, Math.ceil(clip.at * sampleRate - AUDIO_LIMITS.timeEpsilon));
  const final = Math.min(finalFrame, Math.ceil((clip.at + clip.duration) * sampleRate - AUDIO_LIMITS.timeEpsilon));
  const gain = 10 ** (((clip.gainDb ?? 0) + (track.gainDb ?? 0)) / 20);
  for (let frame = first; frame < final; frame += 1) {
    const localTime = frame / sampleRate - clip.at;
    const sourcePosition = (clip.sourceStart + localTime) * source.sampleRate;
    const amplitude = gain * clipFadeGain(clip, localTime);
    for (let channel = 0; channel < channels.length; channel += 1) {
      const output = channels[channel];
      if (output) output[frame - firstFrame] = (output[frame - firstFrame] ?? 0)
        + channelSample(source, channel, channels.length, sourcePosition) * amplitude;
    }
  }
}

/** Pure offline mixer. Both preview playback and WAV export consume this exact PCM. */
export function renderAudioDoc(doc: AudioDoc, assets: AudioDecodedAssets, options: AudioRenderOptions = {}): AudioClip {
  const valid = validateAudioDoc(doc);
  if (!valid.ok) throw new Error(`Invalid audio document: ${valid.errors[0]?.message ?? 'unknown error'}`);
  const sampleRate = options.sampleRate ?? doc.sampleRate;
  if (!Number.isInteger(sampleRate) || sampleRate < AUDIO_LIMITS.minSampleRate || sampleRate > AUDIO_LIMITS.maxSampleRate) {
    throw new Error('Invalid output sample rate.');
  }
  const duration = audioDocDuration(doc);
  const start = options.start ?? 0;
  const end = options.end ?? duration;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end > duration + AUDIO_LIMITS.timeEpsilon) {
    throw new Error('Invalid audio render range.');
  }
  const firstFrame = Math.ceil(start * sampleRate - AUDIO_LIMITS.timeEpsilon);
  const finalFrame = Math.ceil(end * sampleRate - AUDIO_LIMITS.timeEpsilon);
  assertRenderSize(finalFrame - firstFrame, doc.channels);
  const items = prepareItems(doc, assets, start, end);
  const channels = Array.from({ length: doc.channels }, () => new Float32Array(finalFrame - firstFrame));
  for (const item of items) mixItem(item, channels, sampleRate, firstFrame, finalFrame);
  // Clip after summation, never per source: cancellation and preview/export remain identical.
  for (const channel of channels) for (let i = 0; i < channel.length; i += 1) channel[i] = clipSample(channel[i] ?? 0);
  return { sampleRate, channels };
}
