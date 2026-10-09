import { describe, expect, it } from 'vitest';
import { applyAudioPatch, createEmptyAudioDoc, type AudioAsset, type AudioDoc } from '@vibisual/audio';
import { assetClipOps, clipLocalRange, findSoundClip, safeSoundFileName, shouldAcceptSoundDoc } from './soundModel.js';

const asset: AudioAsset = { id: 'source', path: '.vibisual/audio/assets/source.wav', name: 'source.wav', duration: 3, sampleRate: 8000, channels: 1 };
function add(doc: AudioDoc, source: AudioAsset, suffix: string): AudioDoc {
  const result = applyAudioPatch(doc, { baseVersion: doc.version, ops: assetClipOps(doc, source, { track: `track-${suffix}`, clip: `clip-${suffix}` }) });
  if (!result.ok) throw new Error(result.message);
  return result.doc;
}

describe('source import produces valid non-destructive domain operations', () => {
  it('reuses an empty track and references the full immutable source', () => {
    const original = createEmptyAudioDoc('doc');
    const before = JSON.stringify(original);
    const updated = add(original, asset, 'one');
    expect(updated.tracks).toHaveLength(1);
    expect(updated.tracks[0]).toMatchObject({ id: 'audio', label: asset.name, clips: [{ id: 'clip-one', assetId: 'source', at: 0, sourceStart: 0, duration: 3 }] });
    expect(updated.assets['source']).toEqual(asset);
    expect(JSON.stringify(original)).toBe(before);
  });

  it('preserves occupied tracks and previous originals on the next import', () => {
    const first = add(createEmptyAudioDoc('doc'), asset, 'one');
    const secondAsset: AudioAsset = { ...asset, id: 'second', path: '.vibisual/audio/assets/second.wav', name: 'second.wav' };
    const second = add(first, secondAsset, 'two');
    expect(second.tracks).toHaveLength(2);
    expect(second.tracks[0]).toEqual(first.tracks[0]);
    expect(second.tracks[1]?.id).toBe('track-two');
    expect(second.assets['source']).toEqual(first.assets['source']);
    expect(Object.keys(second.assets)).toEqual(['source', 'second']);
  });

  it('finds an empty lane after occupied lanes and safely reuses an already imported source', () => {
    const first = add(createEmptyAudioDoc('doc'), asset, 'one');
    const withEmpty: AudioDoc = { ...first, tracks: [...first.tracks, { id: 'spare', muted: true, clips: [] }] };
    const second = add(withEmpty, asset, 'two');
    expect(second.tracks).toHaveLength(2);
    expect(second.tracks[1]).toMatchObject({ id: 'spare', muted: true, clips: [{ id: 'clip-two', assetId: 'source' }] });
    expect(Object.keys(second.assets)).toEqual(['source']);
  });
});

describe('selection coordinates and stale document guards', () => {
  const clip = { id: 'clip', assetId: 'source', at: 10, sourceStart: 20, duration: 5 };
  it('converts timeline selection to clip-local seconds without adding source offsets', () => {
    expect(clipLocalRange(clip, { start: 11, end: 14 })).toEqual({ start: 1, end: 4 });
    expect(clipLocalRange(clip, { start: 9, end: 20 })).toEqual({ start: 0, end: 5 });
    expect(clipLocalRange(clip, { start: 15, end: 20 })).toBeNull();
    expect(clipLocalRange(clip, null)).toBeNull();
  });
  it('uses stable clip ids and rejects responses for another document or older version', () => {
    const doc = add(createEmptyAudioDoc('doc'), asset, 'one');
    expect(findSoundClip(doc, 'clip-one')?.assetId).toBe('source');
    expect(findSoundClip(doc, 'missing')).toBeUndefined();
    expect(shouldAcceptSoundDoc(doc, { ...doc, version: doc.version - 1 })).toBe(false);
    expect(shouldAcceptSoundDoc(doc, { ...doc, id: 'other', version: 100 })).toBe(false);
    expect(shouldAcceptSoundDoc(doc, { ...doc, version: doc.version + 1 })).toBe(true);
  });
  it('removes path separators and invalid filename characters from export titles', () => {
    expect(safeSoundFileName('../mix:one?. ')).toBe('..-mix-one-');
    expect(safeSoundFileName('...')).toBe('sound');
  });
});
