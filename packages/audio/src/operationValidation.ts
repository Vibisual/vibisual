import { hasOnlyKeys, isFiniteNumber, isId, isRecord } from './validationFields.js';

const OP_KEYS: Readonly<Record<string, readonly string[]>> = {
  addTrack: ['op', 'track', 'beforeTrackId'], removeTrack: ['op', 'trackId'], updateTrack: ['op', 'trackId', 'patch'],
  addClip: ['op', 'trackId', 'clip'], removeClip: ['op', 'clipId'], updateClip: ['op', 'clipId', 'patch'],
  moveClip: ['op', 'clipId', 'toTrackId', 'at'], splitClip: ['op', 'clipId', 'at', 'newClipId'],
  cropClip: ['op', 'clipId', 'start', 'end'], deleteClipRange: ['op', 'clipId', 'start', 'end', 'newClipId'],
  setAsset: ['op', 'asset'], removeAsset: ['op', 'assetId'], setDoc: ['op', 'patch'],
};
const PATCH_KEYS: Readonly<Record<string, readonly string[]>> = {
  updateTrack: ['label', 'muted', 'solo', 'gainDb'],
  updateClip: ['assetId', 'at', 'sourceStart', 'duration', 'gainDb', 'fadeIn', 'fadeOut', 'gainEnvelope', 'label', 'enabled', 'locked'],
  setDoc: ['title', 'sampleRate', 'channels'],
};

export function validateAudioOperation(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value['op'] !== 'string') return 'Expected an operation object.';
  const name = value['op'];
  const keys = Object.hasOwn(OP_KEYS, name) ? OP_KEYS[name] : undefined;
  if (!keys || !hasOnlyKeys(value, keys)) return 'Unknown operation or unexpected operation fields.';
  for (const key of keys) {
    if (key === 'op' || (key === 'beforeTrackId' && value[key] === undefined)) continue;
    if (key.endsWith('Id') && !isId(value[key])) return `${key} must be a safe stable id.`;
    if (['at', 'start', 'end'].includes(key) && !isFiniteNumber(value[key])) return `${key} must be finite seconds.`;
    if (['track', 'clip', 'asset', 'patch'].includes(key) && !isRecord(value[key])) return `${key} must be an object.`;
  }
  const patchKeys = PATCH_KEYS[name];
  const patch = value['patch'];
  if (patchKeys && isRecord(patch) && (!hasOnlyKeys(patch, patchKeys) || Object.keys(patch).length === 0)) {
    return 'Patch must contain supported editable fields.';
  }
  return undefined;
}
