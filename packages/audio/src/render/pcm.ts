import type { AudioClip } from '../audioEdit.js';
import { AUDIO_LIMITS } from '../constants.js';

/** Checks structural PCM invariants before allocating output. Source samples are checked when read. */
export function validatePcm(clip: AudioClip): number {
  if (!Number.isInteger(clip.sampleRate) || clip.sampleRate <= 0 || clip.sampleRate > AUDIO_LIMITS.maxSampleRate) {
    throw new Error('Invalid PCM sample rate.');
  }
  if (clip.channels.length !== 1 && clip.channels.length !== 2) throw new Error('Only mono and stereo PCM are supported.');
  const frames = clip.channels[0]?.length ?? 0;
  if (clip.channels.some((channel) => !(channel instanceof Float32Array) || channel.length !== frames)) {
    throw new Error('PCM channels must be equally sized Float32Array buffers.');
  }
  if (frames * clip.channels.length > AUDIO_LIMITS.maxDecodedSamples) throw new Error('Decoded audio exceeds the memory limit.');
  return frames;
}

export function checkedSample(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Audio source contains a non-finite sample.');
  return value;
}

export function clipSample(value: number): number {
  return Math.max(-1, Math.min(1, checkedSample(value)));
}

export function assertRenderSize(frames: number, channels: number): void {
  if (!Number.isSafeInteger(frames) || frames < 0 || frames * channels > AUDIO_LIMITS.maxRenderSamples) {
    throw new Error(`Audio render exceeds the memory limit (${AUDIO_LIMITS.maxRenderSamples} samples). Select a shorter range.`);
  }
}
