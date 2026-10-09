import type { AudioDoc, AudioGainEnvelope, AudioTimelineClip } from './types.js';

export function audioDocDuration(doc: AudioDoc): number {
  let duration = 0;
  for (const track of doc.tracks) {
    for (const clip of track.clips) duration = Math.max(duration, clip.at + clip.duration);
  }
  return duration;
}

export function clipEnvelope(clip: AudioTimelineClip): AudioGainEnvelope {
  return clip.gainEnvelope ?? {
    offset: 0, duration: clip.duration, fadeIn: clip.fadeIn ?? 0, fadeOut: clip.fadeOut ?? 0,
  };
}

/** Equal-time evaluations stay equal after split/crop, even inside overlapping fades. */
export function clipFadeGain(clip: AudioTimelineClip, localTime: number): number {
  const envelope = clipEnvelope(clip);
  const time = localTime + envelope.offset;
  const fadeIn = envelope.fadeIn > 0 ? Math.min(1, Math.max(0, time / envelope.fadeIn)) : 1;
  const fadeOut = envelope.fadeOut > 0
    ? Math.min(1, Math.max(0, (envelope.duration - time) / envelope.fadeOut)) : 1;
  return fadeIn * fadeOut;
}

/** A metadata-only slice: the immutable source and gain envelope are retained. */
export function sliceAudioClip(clip: AudioTimelineClip, start: number, end: number, id: string, at: number): AudioTimelineClip {
  const duration = end - start;
  const envelope = clipEnvelope(clip);
  const offset = envelope.offset + start;
  const hasFades = envelope.fadeIn > 0 || envelope.fadeOut > 0;
  return {
    ...clip, id, at, sourceStart: clip.sourceStart + start, duration,
    fadeIn: Math.max(0, Math.min(duration, envelope.fadeIn - offset)),
    fadeOut: Math.max(0, Math.min(duration, offset + duration - (envelope.duration - envelope.fadeOut))),
    gainEnvelope: hasFades ? { ...envelope, offset } : undefined,
  };
}
