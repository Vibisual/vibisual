import { AUDIO_LIMITS as LIMITS } from './constants.js';
import type { AudioDoc, AudioValidateResult } from './types.js';
import { FieldValidator, isFiniteNumber, isId, isRecord } from './validationFields.js';

function validateAsset(value: unknown, id: string, v: FieldValidator): void {
  const p = `assets.${id}`;
  if (!isRecord(value)) { v.check(false, p, 'Expected an asset object.'); return; }
  v.check(isId(id) && value['id'] === id, `${p}.id`, 'Asset id must match its safe map key.');
  v.text(value['path'], `${p}.path`, true);
  v.text(value['name'], `${p}.name`, true);
  v.number(value['duration'], `${p}.duration`, Number.MIN_VALUE, LIMITS.maxTimelineSeconds);
  v.number(value['sampleRate'], `${p}.sampleRate`, LIMITS.minSampleRate, LIMITS.maxSampleRate, true);
  v.check(value['channels'] === 1 || value['channels'] === 2, `${p}.channels`, 'Only mono and stereo are supported.');
}

function validateEnvelope(value: unknown, duration: unknown, p: string, v: FieldValidator): void {
  if (value === undefined) return;
  if (!isRecord(value)) { v.check(false, p, 'Expected a gain envelope.'); return; }
  v.number(value['offset'], `${p}.offset`, 0, LIMITS.maxTimelineSeconds);
  v.number(value['duration'], `${p}.duration`, Number.MIN_VALUE, LIMITS.maxTimelineSeconds);
  const length = isFiniteNumber(value['duration']) ? value['duration'] : 0;
  v.number(value['fadeIn'], `${p}.fadeIn`, 0, length);
  v.number(value['fadeOut'], `${p}.fadeOut`, 0, length);
  if (isFiniteNumber(value['offset']) && isFiniteNumber(duration)) {
    v.check(value['offset'] + duration <= length + LIMITS.timeEpsilon, p, 'Envelope does not cover this clip.');
  }
}

function validateClip(value: unknown, p: string, assets: Record<string, unknown>, ids: Set<string>, v: FieldValidator): void {
  if (!isRecord(value)) { v.check(false, p, 'Expected a clip object.'); return; }
  const id = value['id'];
  v.check(isId(id), `${p}.id`, 'Expected a safe stable clip id.');
  if (typeof id === 'string') {
    v.check(!ids.has(id), `${p}.id`, 'Duplicate clip id.');
    ids.add(id);
  }
  const assetId = value['assetId'];
  const asset = typeof assetId === 'string' && Object.hasOwn(assets, assetId) ? assets[assetId] : undefined;
  v.check(isId(assetId) && isRecord(asset), `${p}.assetId`, 'Unknown asset.');
  v.number(value['at'], `${p}.at`, 0, LIMITS.maxTimelineSeconds);
  v.number(value['sourceStart'], `${p}.sourceStart`, 0, LIMITS.maxTimelineSeconds);
  v.number(value['duration'], `${p}.duration`, Number.MIN_VALUE, LIMITS.maxTimelineSeconds);
  const duration = isFiniteNumber(value['duration']) ? value['duration'] : 0;
  if (isFiniteNumber(value['at'])) {
    v.check(value['at'] + duration <= LIMITS.maxTimelineSeconds, p, 'Clip exceeds the timeline limit.');
  }
  if (isRecord(asset) && isFiniteNumber(asset['duration']) && isFiniteNumber(value['sourceStart'])) {
    v.check(value['sourceStart'] + duration <= asset['duration'] + LIMITS.timeEpsilon, p, 'Clip exceeds its source asset.');
  }
  v.gain(value['gainDb'], `${p}.gainDb`);
  for (const key of ['fadeIn', 'fadeOut'] as const) {
    if (value[key] !== undefined) v.number(value[key], `${p}.${key}`, 0, duration);
  }
  validateEnvelope(value['gainEnvelope'], duration, `${p}.gainEnvelope`, v);
  v.optionalText(value['label'], `${p}.label`);
  v.optionalBoolean(value['enabled'], `${p}.enabled`);
  v.optionalBoolean(value['locked'], `${p}.locked`);
}

function validateTracks(value: unknown, assets: Record<string, unknown>, v: FieldValidator): void {
  if (!Array.isArray(value)) { v.check(false, 'tracks', 'Expected track array.'); return; }
  v.check(value.length <= LIMITS.maxTracks, 'tracks', 'Too many tracks.');
  const trackIds = new Set<string>();
  const clipIds = new Set<string>();
  value.forEach((track: unknown, i: number) => {
    const p = `tracks[${i}]`;
    if (!isRecord(track)) { v.check(false, p, 'Expected a track object.'); return; }
    const id = track['id'];
    v.check(isId(id), `${p}.id`, 'Expected a safe stable track id.');
    if (typeof id === 'string') {
      v.check(!trackIds.has(id), `${p}.id`, 'Duplicate track id.');
      trackIds.add(id);
    }
    v.optionalText(track['label'], `${p}.label`);
    v.optionalBoolean(track['muted'], `${p}.muted`);
    v.optionalBoolean(track['solo'], `${p}.solo`);
    v.gain(track['gainDb'], `${p}.gainDb`);
    if (!Array.isArray(track['clips'])) { v.check(false, `${p}.clips`, 'Expected clip array.'); return; }
    track['clips'].forEach((clip: unknown, j: number) => validateClip(clip, `${p}.clips[${j}]`, assets, clipIds, v));
  });
  v.check(clipIds.size <= LIMITS.maxClips, 'tracks', 'Too many clips.');
}

/** Validates persisted/untrusted JSON and references before the renderer can use it. */
export function validateAudioDoc(value: unknown): AudioValidateResult {
  const v = new FieldValidator();
  if (!isRecord(value)) return { ok: false, errors: [{ path: '', message: 'Expected an audio document.' }] };
  v.check(value['schemaVersion'] === 1, 'schemaVersion', 'Unsupported audio schema version.');
  v.check(isId(value['id']), 'id', 'Expected a safe stable document id.');
  v.text(value['title'], 'title');
  v.number(value['version'], 'version', 1, Number.MAX_SAFE_INTEGER, true);
  v.number(value['sampleRate'], 'sampleRate', LIMITS.minSampleRate, LIMITS.maxSampleRate, true);
  v.check(value['channels'] === 1 || value['channels'] === 2, 'channels', 'Only mono and stereo are supported.');
  v.number(value['createdAt'], 'createdAt', 0, Number.MAX_SAFE_INTEGER, true);
  v.number(value['updatedAt'], 'updatedAt', 0, Number.MAX_SAFE_INTEGER, true);
  const assets = isRecord(value['assets']) ? value['assets'] : {};
  v.check(isRecord(value['assets']), 'assets', 'Expected an asset map.');
  v.check(Object.keys(assets).length <= LIMITS.maxAssets, 'assets', 'Too many assets.');
  for (const [id, asset] of Object.entries(assets)) validateAsset(asset, id, v);
  validateTracks(value['tracks'], assets, v);
  if (v.errors.length > 0) return { ok: false, errors: v.errors };
  // Every required scalar, collection member and reference has been checked above.
  return { ok: true, doc: value as unknown as AudioDoc };
}
