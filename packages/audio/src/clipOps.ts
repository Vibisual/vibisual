import { sliceAudioClip } from './timeline.js';
import type { AudioDoc, AudioDocOp, AudioTimelineClip, AudioTrack } from './types.js';

export type OpOutcome = { readonly ok: true; readonly doc: AudioDoc } | { readonly ok: false; readonly message: string };
export const opFailure = (message: string): OpOutcome => ({ ok: false, message });

export function replaceTrack(doc: AudioDoc, index: number, track: AudioTrack): AudioDoc {
  return { ...doc, tracks: doc.tracks.map((previous, i) => i === index ? track : previous) };
}

export function hasClipId(doc: AudioDoc, id: string): boolean {
  return doc.tracks.some((track) => track.clips.some((clip) => clip.id === id));
}

type ClipOp = Extract<AudioDocOp, { readonly clipId: string }>;

function cutClips(clip: AudioTimelineClip, op: Extract<ClipOp, { op: 'splitClip' | 'cropClip' | 'deleteClipRange' }>): readonly AudioTimelineClip[] | string {
  if (op.op === 'splitClip') {
    if (op.at <= 0 || op.at >= clip.duration) return 'Split must be inside the clip.';
    return [sliceAudioClip(clip, 0, op.at, clip.id, clip.at),
      sliceAudioClip(clip, op.at, clip.duration, op.newClipId, clip.at + op.at)];
  }
  if (op.start < 0 || op.end > clip.duration || op.start >= op.end) return 'Range must satisfy 0 <= start < end <= clip duration.';
  if (op.op === 'cropClip') return [sliceAudioClip(clip, op.start, op.end, clip.id, clip.at)];
  const result: AudioTimelineClip[] = [];
  if (op.start > 0) result.push(sliceAudioClip(clip, 0, op.start, clip.id, clip.at));
  if (op.end < clip.duration) {
    result.push(sliceAudioClip(clip, op.end, clip.duration, result.length > 0 ? op.newClipId : clip.id, clip.at + op.start));
  }
  return result;
}

function updateClip(clip: AudioTimelineClip, op: Extract<ClipOp, { op: 'updateClip' }>): AudioTimelineClip {
  const next = { ...clip, ...op.patch };
  const resetsFade = Object.hasOwn(op.patch, 'fadeIn') || Object.hasOwn(op.patch, 'fadeOut');
  // Explicit fade editing starts a new envelope at the current clip boundaries.
  if (resetsFade) return { ...next, gainEnvelope: undefined };
  return next;
}

export function applyClipOperation(doc: AudioDoc, op: ClipOp): OpOutcome {
  const trackIndex = doc.tracks.findIndex((track) => track.clips.some((clip) => clip.id === op.clipId));
  const track = doc.tracks[trackIndex];
  const clip = track?.clips.find((candidate) => candidate.id === op.clipId);
  if (!track || !clip) return opFailure(`Unknown clip '${op.clipId}'.`);
  if (clip.locked && !(op.op === 'updateClip' && op.patch.locked === false && Object.keys(op.patch).length === 1)) {
    return opFailure(`Clip '${clip.id}' is locked; unlock it in a separate operation first.`);
  }
  if (op.op === 'moveClip') {
    const target = doc.tracks.findIndex((candidate) => candidate.id === op.toTrackId);
    if (target < 0) return opFailure(`Unknown track '${op.toTrackId}'.`);
    const removed = replaceTrack(doc, trackIndex, { ...track, clips: track.clips.filter((candidate) => candidate.id !== clip.id) });
    const destination = removed.tracks[target];
    if (!destination) return opFailure('Destination track is unavailable.');
    return { ok: true, doc: replaceTrack(removed, target, { ...destination, clips: [...destination.clips, { ...clip, at: op.at }] }) };
  }
  if ((op.op === 'splitClip' || op.op === 'deleteClipRange') && hasClipId(doc, op.newClipId)) {
    return opFailure(`Clip id '${op.newClipId}' already exists.`);
  }
  const replacement = op.op === 'removeClip' ? [] : op.op === 'updateClip' ? [updateClip(clip, op)] : cutClips(clip, op);
  if (typeof replacement === 'string') return opFailure(replacement);
  const clips = track.clips.flatMap((candidate) => candidate.id === clip.id ? replacement : [candidate]);
  return { ok: true, doc: replaceTrack(doc, trackIndex, { ...track, clips }) };
}
