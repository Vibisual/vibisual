import { describe, expect, it } from 'vitest';
import { applyAudioPatch, createEmptyAudioDoc } from './ops.js';
import type { AudioDoc, AudioDocOp, AudioDocPatch } from './types.js';

function fixture(): AudioDoc {
  return {
    ...createEmptyAudioDoc('doc', 'Test', 1000),
    assets: { source: { id: 'source', name: 'source.wav', path: 'audio/source.wav', duration: 10, sampleRate: 8000, channels: 1 } },
    tracks: [{ id: 'audio', clips: [{ id: 'clip', assetId: 'source', at: 2, sourceStart: 1, duration: 8, fadeIn: 2, fadeOut: 2 }] }],
  };
}

function edit(doc: AudioDoc, ops: readonly AudioDocOp[]): AudioDoc {
  const result = applyAudioPatch(doc, { baseVersion: doc.version, ops }, 2000);
  if (!result.ok) throw new Error(result.message);
  return result.doc;
}

describe('audio transactions', () => {
  it('preserves human corrections when an agent edits another field', () => {
    const base = fixture();
    const ai = edit(base, [{ op: 'updateClip', clipId: 'clip', patch: { gainDb: -4 } }]);
    const human = edit(ai, [{ op: 'updateClip', clipId: 'clip', patch: { gainDb: -2, at: 3 } }]);
    const continued = edit(human, [{ op: 'updateClip', clipId: 'clip', patch: { fadeOut: 1 } }]);
    expect(continued.tracks[0]?.clips[0]).toMatchObject({ gainDb: -2, at: 3, fadeIn: 2, fadeOut: 1 });
    expect(continued.version).toBe(base.version + 3);
    expect(base.tracks[0]?.clips[0]?.gainDb).toBeUndefined();
    expect(continued.assets).toBe(base.assets);
  });

  it('rejects an outdated agent without changing the current document', () => {
    const base = fixture();
    const human = edit(base, [{ op: 'setDoc', patch: { title: 'Human title' } }]);
    const stale = applyAudioPatch(human, { baseVersion: base.version, ops: [{ op: 'setDoc', patch: { title: 'Old AI' } }] });
    expect(stale).toMatchObject({ ok: false, reason: 'version-conflict' });
    expect(human.title).toBe('Human title');
  });

  it('rejects an entire batch when a later source range is invalid', () => {
    const base = fixture();
    const before = JSON.stringify(base);
    const result = applyAudioPatch(base, { baseVersion: base.version, ops: [
      { op: 'setDoc', patch: { title: 'Must not remain' } },
      { op: 'updateClip', clipId: 'clip', patch: { sourceStart: 9 } },
    ] });
    expect(result).toMatchObject({ ok: false, reason: 'invalid-op', opIndex: 1 });
    expect(JSON.stringify(base)).toBe(before);
  });

  it.each([null, { baseVersion: 1, ops: [null] }, { baseVersion: 1, ops: [{ op: 'nope' }] },
    { baseVersion: 1, ops: [{ op: 'setDoc', patch: { version: 999 } }] },
    { baseVersion: 1, ops: [{ op: 'updateClip', clipId: 'clip', patch: { id: 'hijack' } }] },
  ])('fails closed on malformed runtime JSON: %j', (patch: unknown) => {
    expect(applyAudioPatch(fixture(), patch as AudioDocPatch)).toMatchObject({ ok: false, reason: 'invalid-op' });
  });

  it('protects locked clips and tracks and requires an explicit unlock', () => {
    const locked = edit(fixture(), [{ op: 'updateClip', clipId: 'clip', patch: { locked: true } }]);
    const operations: AudioDocOp[] = [
      { op: 'removeTrack', trackId: 'audio' }, { op: 'removeClip', clipId: 'clip' },
      { op: 'splitClip', clipId: 'clip', at: 2, newClipId: 'right' },
      { op: 'updateClip', clipId: 'clip', patch: { locked: false, gainDb: -2 } },
    ];
    for (const op of operations) expect(applyAudioPatch(locked, { baseVersion: locked.version, ops: [op] }).ok).toBe(false);
    const unlocked = edit(locked, [{ op: 'updateClip', clipId: 'clip', patch: { locked: false } }]);
    expect(edit(unlocked, [{ op: 'removeClip', clipId: 'clip' }]).tracks[0]?.clips).toEqual([]);
  });

  it('never replaces a source asset or removes a referenced asset', () => {
    const doc = fixture();
    const asset = doc.assets['source'];
    if (!asset) throw new Error('Missing fixture asset');
    expect(applyAudioPatch(doc, { baseVersion: 1, ops: [{ op: 'setAsset', asset: { ...asset, path: 'different.wav' } }] }).ok).toBe(false);
    expect(applyAudioPatch(doc, { baseVersion: 1, ops: [{ op: 'removeAsset', assetId: 'source' }] }).ok).toBe(false);
  });

  it('detaches incoming objects from committed state', () => {
    const base = fixture();
    const track = { id: 'second', label: 'Original', clips: [] };
    const next = edit(base, [{ op: 'addTrack', track }]);
    track.label = 'Mutated request';
    expect(next.tracks[1]?.label).toBe('Original');
  });
});

describe('non-destructive clip cuts', () => {
  it('splits source offsets and keeps exact inherited fade coordinates', () => {
    const doc = edit(fixture(), [{ op: 'splitClip', clipId: 'clip', at: 1, newClipId: 'right' }]);
    expect(doc.tracks[0]?.clips[0]).toMatchObject({ id: 'clip', sourceStart: 1, at: 2, duration: 1 });
    expect(doc.tracks[0]?.clips[1]).toMatchObject({ id: 'right', sourceStart: 2, at: 3, duration: 7, gainEnvelope: { offset: 1, duration: 8 } });
  });

  it('crops in local seconds without moving the clip or copying the source', () => {
    const base = fixture();
    const doc = edit(base, [{ op: 'cropClip', clipId: 'clip', start: 1, end: 3 }]);
    expect(doc.tracks[0]?.clips[0]).toMatchObject({ id: 'clip', sourceStart: 2, at: 2, duration: 2 });
    expect(doc.assets).toBe(base.assets);
  });

  it('closes a deleted middle range inside the target clip only', () => {
    const base = edit(fixture(), [{ op: 'addClip', trackId: 'audio', clip: { id: 'other', assetId: 'source', at: 20, sourceStart: 0, duration: 1 } }]);
    const doc = edit(base, [{ op: 'deleteClipRange', clipId: 'clip', start: 2, end: 5, newClipId: 'right' }]);
    expect(doc.tracks[0]?.clips).toMatchObject([
      { id: 'clip', at: 2, sourceStart: 1, duration: 2 },
      { id: 'right', at: 4, sourceStart: 6, duration: 3 },
      { id: 'other', at: 20 },
    ]);
  });

  it('handles deleting the beginning, end, and full clip', () => {
    const start = edit(fixture(), [{ op: 'deleteClipRange', clipId: 'clip', start: 0, end: 3, newClipId: 'unused' }]);
    expect(start.tracks[0]?.clips[0]).toMatchObject({ id: 'clip', at: 2, sourceStart: 4, duration: 5 });
    const end = edit(fixture(), [{ op: 'deleteClipRange', clipId: 'clip', start: 3, end: 8, newClipId: 'unused' }]);
    expect(end.tracks[0]?.clips[0]).toMatchObject({ duration: 3, sourceStart: 1 });
    const all = edit(fixture(), [{ op: 'deleteClipRange', clipId: 'clip', start: 0, end: 8, newClipId: 'unused' }]);
    expect(all.tracks[0]?.clips).toEqual([]);
  });

  it('rejects duplicate ids, reversed ranges, and splitting at an edge', () => {
    const operations: AudioDocOp[] = [
      { op: 'splitClip', clipId: 'clip', at: 1, newClipId: 'clip' },
      { op: 'splitClip', clipId: 'clip', at: 0, newClipId: 'right' },
      { op: 'cropClip', clipId: 'clip', start: 3, end: 2 },
    ];
    for (const op of operations) expect(applyAudioPatch(fixture(), { baseVersion: 1, ops: [op] }).ok).toBe(false);
  });

  it('clears inherited fades when the user explicitly adjusts fades', () => {
    const cut = edit(fixture(), [{ op: 'cropClip', clipId: 'clip', start: 1, end: 3 }]);
    const adjusted = edit(cut, [{ op: 'updateClip', clipId: 'clip', patch: { fadeIn: 0.2 } }]);
    expect(adjusted.tracks[0]?.clips[0]?.gainEnvelope).toBeUndefined();
    expect(adjusted.tracks[0]?.clips[0]?.fadeIn).toBe(0.2);
  });
});
