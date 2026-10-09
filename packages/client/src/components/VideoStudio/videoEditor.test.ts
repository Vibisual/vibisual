import { describe, expect, it } from 'vitest';
import { applyPatch, buildDrawList, createEmptyDoc, resolveTimeline, validateDoc, type VideoDoc, type VideoDocOp, type VideoItem } from '@vibisual/video';
import { buildAddSceneOps, buildAddShapeOps, buildAddTextOps, buildAssetItemOps, buildDuplicateOps, buildRemoveOps, buildRestoreOps, buildSplitOps, EDITOR_SCENE_IDS } from './videoEditor.js';

function apply(doc: VideoDoc, ops: VideoDocOp[]): VideoDoc {
  // Exercise the actual REST JSON transport too: undefined properties do not survive it.
  const patch = JSON.parse(JSON.stringify({ baseVersion: doc.version, ops })) as { baseVersion: number; ops: VideoDocOp[] };
  const result = applyPatch(doc, patch, 200);
  if (!result.ok) throw new Error(JSON.stringify(result));
  expect(validateDoc(result.doc).ok).toBe(true);
  expect(resolveTimeline(result.doc).diagnostics).toEqual([]);
  return result.doc;
}
function documentWith(items: VideoItem[]): VideoDoc {
  return { ...createEmptyDoc('editing', 'Timeline', 100), tracks: [{ id: 'visual', kind: 'visual', items }] };
}

describe('editor insertion', () => {
  it.each(EDITOR_SCENE_IDS)('creates renderable %s props on a valid visual track', sceneId => {
    const empty = { ...createEmptyDoc('editing', 'Empty', 100), tracks: [] };
    const next = apply(empty, buildAddSceneOps(empty, sceneId, 2.013, 'Example'));
    const resolved = resolveTimeline(next).items[0]!;
    expect(resolved).toMatchObject({ start: 2, duration: 5, kind: 'scene', trackKind: 'visual' });
    expect(resolved.item.sceneId).toBe(sceneId);
    expect(Object.keys(resolved.item.props ?? {}).length).toBeGreaterThan(0);
    expect(buildAddSceneOps(empty, '__proto__', 0, 'Bad')).toEqual([]);
  });

  it('creates a visible visual layer before captions when existing visual tracks are hidden', () => {
    const empty = createEmptyDoc('editing', 'Empty', 100);
    const doc = { ...empty, tracks: empty.tracks.map(t => t.kind === 'visual' ? { ...t, hidden: true } : t) };
    const withText = apply(doc, buildAddTextOps(doc, -1, 'Hello'));
    const withShape = apply(withText, buildAddShapeOps(withText, 1.016, 'Box'));
    const text = resolveTimeline(withShape).items.find(i => i.kind === 'text')!;
    const shape = resolveTimeline(withShape).items.find(i => i.kind === 'shape')!;
    expect(text.start).toBe(0);
    expect(shape.item.transform).toMatchObject({ width: 378, height: 378 });
    expect(shape.trackId).toBe(text.trackId);
    expect(withShape.tracks.findIndex(t => t.id === text.trackId)).toBeLessThan(withShape.tracks.findIndex(t => t.kind === 'caption'));
    expect(buildDrawList(withShape, resolveTimeline(withShape), 2)).toHaveLength(2);
  });

  it('creates measured media with the correct track kind and rejects unmeasured media/fonts', () => {
    const empty = documentWith([]);
    const asset = { id: 'sound', kind: 'audio', source: { kind: 'file', path: 'voice.wav' }, duration: 2.65 } as const;
    const next = apply(empty, buildAssetItemOps(empty, asset, 1.04, 'Voice'));
    expect(resolveTimeline(next).items[0]).toMatchObject({ trackKind: 'audio', kind: 'audio', duration: 2.65, start: 31 / 30 });
    expect(buildAssetItemOps(empty, { ...asset, duration: undefined }, 0, '')).toEqual([]);
    expect(buildAssetItemOps(empty, { ...asset, kind: 'font' }, 0, '')).toEqual([]);
    expect(resolveTimeline(apply(empty, buildAssetItemOps(empty, { ...asset, kind: 'image' }, 0, 'Picture'))).items[0]?.duration).toBe(5);
  });
});

describe('duplicate and split', () => {
  it('duplicates absolute caption cues and words at the new clip time without mutating the original', () => {
    const original: VideoItem = { id: 'captions', kind: 'caption', at: 2, duration: 3,
      cues: [{ start: 2.2, end: 4.5, text: 'Hello world', words: [{ t: 2.2, text: 'Hello' }, { t: 3, text: 'world' }] }] };
    const doc = documentWith([original]);
    const next = apply(doc, buildDuplicateOps(doc, 'captions', 'copy'));
    expect(next.tracks[0]?.items[1]).toMatchObject({ id: 'copy', at: 5, cues: [{ start: 5.2, end: 7.5, words: [{ t: 5.2 }, { t: 6 }] }] });
    expect(doc.tracks[0]?.items[0]).toBe(original);
    expect(original.cues?.[0]?.start).toBe(2.2);
    expect(buildDuplicateOps(doc, 'captions', 'captions')).toEqual([]);
    expect(buildDuplicateOps(doc, 'missing')).toEqual([]);
  });

  it.each(['footage', 'audio'] as const)('preserves %s source time, end anchors, start anchors, and transitive followers', kind => {
    const doc = { ...documentWith([
      { id: 'clip', kind, assetId: 'source', at: 1.2, duration: 'auto', trimStart: 2.5 },
      { id: 'after', kind: 'text', at: { after: 'clip', offset: 0.2 }, duration: 1 },
      { id: 'start', kind: 'text', at: { start: 'clip', offset: 0.1 }, duration: 1 },
      { id: 'transitive', kind: 'text', at: { after: 'after' }, duration: 1 },
    ]), assets: { source: { id: 'source', kind: 'video' as const, source: { kind: 'file' as const, path: 'clip.mp4' }, duration: 8.5 } } };
    const before = resolveTimeline(doc);
    const next = apply(doc, buildSplitOps(doc, 'clip', 3.31, 'right'));
    const after = resolveTimeline(next);
    expect(after.items.find(i => i.id === 'right')).toMatchObject({ start: 3.3, end: 7.2 });
    expect(after.items.find(i => i.id === 'right')?.item.trimStart).toBeCloseTo(4.6);
    for (const id of ['after', 'start', 'transitive']) {
      expect(after.items.find(i => i.id === id)?.start).toBe(before.items.find(i => i.id === id)?.start);
    }
    expect(after.items.find(i => i.id === 'after')?.item.at).toEqual({ after: 'right', offset: 0.2 });
    expect(after.items.find(i => i.id === 'start')?.item.at).toEqual({ start: 'clip', offset: 0.1 });
    expect(next.tracks[0]?.items.map(i => i.id)).toEqual(['clip', 'right', 'after', 'start', 'transitive']);
    if (kind === 'footage') expect(buildDrawList(next, after, 3.5)[0]?.sourceTime).toBeCloseTo(buildDrawList(doc, before, 3.5)[0]?.sourceTime ?? 0);
  });

  it('clips crossing caption cues while keeping their timestamps and word timing absolute', () => {
    const words = [{ t: 2, text: 'One' }, { t: 3, text: 'two' }];
    const doc = documentWith([{ id: 'captions', kind: 'caption', at: 2, duration: 4,
      cues: [{ start: 2, end: 4, text: 'One two', words }, { start: 5, end: 6, text: 'Three' }] }]);
    const next = apply(doc, buildSplitOps(doc, 'captions', 3, 'right'));
    expect(next.tracks[0]?.items[0]?.cues).toEqual([{ start: 2, end: 3, text: 'One two', words }]);
    expect(next.tracks[0]?.items[1]?.cues).toEqual([{ start: 3, end: 4, text: 'One two', words }, { start: 5, end: 6, text: 'Three' }]);
    for (const at of [2.5, 3, 3.5, 4.5, 5.5]) {
      const textAt = (d: VideoDoc): string[] => buildDrawList(d, resolveTimeline(d), at).flatMap(op => op.cues.map(c => c.text));
      expect(textAt(next)).toEqual(textAt(doc));
    }
  });

  it('rejects boundary, subframe, nonfinite, colliding, and unresolved splits', () => {
    const doc = documentWith([{ id: 'clip', kind: 'text', at: 0, duration: 2 }]);
    for (const at of [0, 0.001, 1.999, 2, 5, NaN]) expect(buildSplitOps(doc, 'clip', at)).toEqual([]);
    expect(buildSplitOps(doc, 'clip', 1, 'clip')).toEqual([]);
    expect(buildSplitOps(documentWith([{ id: 'scene', kind: 'scene', sceneId: 'title', at: 0, duration: 5 }]), 'scene', 2)).toEqual([]);
    expect(buildSplitOps(documentWith([{ id: 'clip', kind: 'footage', at: 0, duration: 'auto' }]), 'clip', 1)).toEqual([]);
    expect(resolveTimeline(apply(doc, buildSplitOps(doc, 'clip', 1 / 30, 'right'))).items).toHaveLength(2);
  });
});

describe('removal and restoration', () => {
  it('keeps both direct and transitive followers in place when their anchor is removed', () => {
    const doc = documentWith([
      { id: 'clip', kind: 'text', at: 1, duration: 3 },
      { id: 'after', kind: 'text', at: { after: 'clip', offset: 0.2 }, duration: 1 },
      { id: 'start', kind: 'text', at: { start: 'clip', offset: 0.3 }, duration: 1 },
      { id: 'last', kind: 'text', at: { after: 'after' }, duration: 1 },
    ]);
    const before = resolveTimeline(doc);
    const next = apply(doc, buildRemoveOps(doc, 'clip'));
    for (const resolved of resolveTimeline(next).items) expect(resolved.start).toBe(before.items.find(i => i.id === resolved.id)?.start);
    expect(next.tracks[0]?.items[2]?.at).toEqual({ after: 'after' });
    expect(buildRemoveOps(doc, 'missing')).toEqual([]);
  });

  it('restores exact content including removed optional fields and track order while preserving server identity', () => {
    const target: VideoDoc = { ...documentWith([{ id: 'clip', kind: 'text', at: 0, duration: 3 }]), seed: 19,
      assets: { old: { id: 'old', kind: 'image', source: { kind: 'file', path: 'old.png' } } } };
    const current = { ...apply(target, buildAddShapeOps(target, 2, 'Box')), id: 'server-id', title: 'Changed', fps: 60, seed: 1,
      tracks: target.tracks.map(t => ({ ...t, hidden: true, items: t.items.map(i => ({ ...i, trimStart: 2, enabled: false })) })),
      assets: { replacement: { id: 'replacement', kind: 'image' as const, source: { kind: 'file' as const, path: 'new.png' } } } };
    const restored = apply(current, buildRestoreOps(current, target));
    expect(restored).toEqual({ ...target, id: current.id, version: current.version + 1, updatedAt: 200 });
    expect(current.tracks[0]?.hidden).toBe(true);
  });
});
