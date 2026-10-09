import { AUDIO_LIMITS } from './constants.js';
import { applyClipOperation, hasClipId, opFailure, replaceTrack, type OpOutcome } from './clipOps.js';
import { validateAudioOperation } from './operationValidation.js';
import type { AudioDoc, AudioDocOp, AudioDocPatch, AudioDocPatchResult } from './types.js';
import { validateAudioDoc } from './validateDoc.js';
import { isRecord } from './validationFields.js';

function applyOperation(doc: AudioDoc, op: AudioDocOp): OpOutcome {
  switch (op.op) {
    case 'addTrack': {
      if (doc.tracks.some((track) => track.id === op.track.id)) return opFailure('Track id already exists.');
      const index = op.beforeTrackId === undefined ? doc.tracks.length : doc.tracks.findIndex((track) => track.id === op.beforeTrackId);
      if (index < 0) return opFailure('beforeTrackId does not exist.');
      const tracks = doc.tracks.slice();
      tracks.splice(index, 0, op.track);
      return { ok: true, doc: { ...doc, tracks } };
    }
    case 'removeTrack':
    case 'updateTrack':
    case 'addClip': {
      const index = doc.tracks.findIndex((track) => track.id === op.trackId);
      const track = doc.tracks[index];
      if (!track) return opFailure(`Unknown track '${op.trackId}'.`);
      if (op.op === 'removeTrack') {
        if (track.clips.some((clip) => clip.locked)) return opFailure('Track contains locked clips.');
        return { ok: true, doc: { ...doc, tracks: doc.tracks.filter((candidate) => candidate.id !== track.id) } };
      }
      if (op.op === 'updateTrack') return { ok: true, doc: replaceTrack(doc, index, { ...track, ...op.patch }) };
      if (hasClipId(doc, op.clip.id)) return opFailure('Clip id already exists.');
      return { ok: true, doc: replaceTrack(doc, index, { ...track, clips: [...track.clips, op.clip] }) };
    }
    case 'removeClip': case 'updateClip': case 'moveClip': case 'splitClip': case 'cropClip': case 'deleteClipRange':
      return applyClipOperation(doc, op);
    case 'setAsset': {
      const previous = Object.hasOwn(doc.assets, op.asset.id) ? doc.assets[op.asset.id] : undefined;
      if (previous && ['id', 'path', 'name', 'duration', 'sampleRate', 'channels'].some((key) => {
        const field = key as keyof typeof previous;
        return previous[field] !== op.asset[field];
      })) return opFailure('Source assets are immutable; register a new asset id.');
      return { ok: true, doc: { ...doc, assets: { ...doc.assets, [op.asset.id]: op.asset } } };
    }
    case 'removeAsset': {
      if (!Object.hasOwn(doc.assets, op.assetId)) return opFailure('Unknown asset.');
      if (doc.tracks.some((track) => track.clips.some((clip) => clip.assetId === op.assetId))) return opFailure('Asset is still referenced by a clip.');
      const assets = { ...doc.assets };
      delete assets[op.assetId];
      return { ok: true, doc: { ...doc, assets } };
    }
    case 'setDoc': return { ok: true, doc: { ...doc, ...op.patch } };
  }
}

/** Immutable, atomic transaction. Invalid input never partly changes the document. */
export function applyAudioPatch(doc: AudioDoc, patch: AudioDocPatch, now = Date.now()): AudioDocPatchResult {
  const current = validateAudioDoc(doc);
  if (!current.ok) return { ok: false, reason: 'invalid-doc', message: 'Current audio document is invalid.', errors: current.errors };
  if (!isRecord(patch) || !Number.isSafeInteger(patch.baseVersion) || !Array.isArray(patch.ops)) {
    return { ok: false, reason: 'invalid-op', message: 'Expected baseVersion and an operations array.' };
  }
  if (patch.baseVersion !== doc.version) return { ok: false, reason: 'version-conflict', message: `Expected version ${doc.version}; received ${patch.baseVersion}.` };
  if (patch.ops.length === 0 || patch.ops.length > AUDIO_LIMITS.maxOps) {
    return { ok: false, reason: 'invalid-op', message: `A patch must contain 1–${AUDIO_LIMITS.maxOps} operations.` };
  }
  let next = doc;
  for (let index = 0; index < patch.ops.length; index += 1) {
    const op = patch.ops[index];
    const invalid = validateAudioOperation(op);
    if (!op || invalid) return { ok: false, reason: 'invalid-op', message: invalid ?? 'Missing operation.', opIndex: index };
    // Copy only metadata, so callers cannot mutate committed state via request objects.
    const result = applyOperation(next, structuredClone(op));
    if (!result.ok) return { ...result, reason: 'invalid-op', opIndex: index };
    const checked = validateAudioDoc(result.doc);
    if (!checked.ok) return { ok: false, reason: 'invalid-op', message: checked.errors[0]?.message ?? 'Invalid edit.', opIndex: index, errors: checked.errors };
    next = checked.doc;
  }
  const checked = validateAudioDoc({ ...next, version: doc.version + 1, updatedAt: now });
  return checked.ok ? checked : { ok: false, reason: 'invalid-doc', message: 'Invalid document version or timestamp.', errors: checked.errors };
}

export function createEmptyAudioDoc(id: string, title = 'Untitled', now = Date.now()): AudioDoc {
  return {
    schemaVersion: 1, id, title, version: 1,
    sampleRate: AUDIO_LIMITS.defaultSampleRate, channels: AUDIO_LIMITS.defaultChannels,
    tracks: [{ id: 'audio', label: 'Audio', clips: [] }], assets: {}, createdAt: now, updatedAt: now,
  };
}
