import type { AudioAsset, AudioDoc, AudioDocOp, AudioTimelineClip } from '@vibisual/audio';
import type { SoundRange } from './soundConfig.js';

export function findSoundClip(doc: AudioDoc | null, id: string | null): AudioTimelineClip | undefined {
  return doc?.tracks.flatMap((track) => track.clips).find((clip) => clip.id === id);
}
export function clipLocalRange(clip: AudioTimelineClip, range: SoundRange | null): SoundRange | null {
  if (!range) return null;
  const start = Math.max(0, range.start - clip.at);
  const end = Math.min(clip.duration, range.end - clip.at);
  return end > start ? { start, end } : null;
}
export function assetClipOps(doc: AudioDoc, asset: AudioAsset, ids: { track: string; clip: string }, duration = asset.duration): AudioDocOp[] {
  const emptyTrack = doc.tracks.find(track => track.clips.length === 0);
  const trackId = emptyTrack?.id ?? ids.track;
  // Reuse an empty lane; subsequent sources get their own without replacing audio.
  return [
    { op: 'setAsset', asset },
    ...(emptyTrack ? [{ op: 'updateTrack' as const, trackId, patch: { label: asset.name } }] : [{ op: 'addTrack' as const, track: { id: trackId, label: asset.name, clips: [] } }]),
    { op: 'addClip', trackId, clip: { id: ids.clip, assetId: asset.id, at: 0, sourceStart: 0, duration, label: asset.name } },
  ];
}
export function safeSoundFileName(title: string): string {
  return (title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').slice(0, 70) || 'sound');
}
/** Keep project time/selection stable when comparing a short source with a longer mix. */
export function sourceAuditionDoc(doc: AudioDoc, clipId: string): AudioDoc {
  return { ...doc, tracks: doc.tracks.map(track => ({ ...track, muted: false, solo: false, gainDb: 0,
    clips: track.clips.map(clip => clip.id === clipId
      ? { ...clip, enabled: true, gainDb: 0, fadeIn: 0, fadeOut: 0, gainEnvelope: undefined }
      : { ...clip, enabled: false }),
  })) };
}
/** Ignore poll responses older than the edit we have already committed. */
export function shouldAcceptSoundDoc(current: AudioDoc | null, incoming: AudioDoc): boolean {
  return current === null || (current.id === incoming.id && incoming.version >= current.version);
}
