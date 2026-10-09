import { describe, expect, it } from 'vitest';
import { applyPatch, buildDrawList, createEmptyDoc, resolveTimeline, type VideoDoc, type VideoDocOp, type VideoItem } from '@vibisual/video';
import { buildTimelineEditOps, clampTimelineSeek, lastTimelineFrame, snapTimelineDelta, timelineSnapPoints, timelineTicks, withCaptionTimingOps } from './videoTimelineEdit.js';

function document(items: readonly VideoItem[]): VideoDoc {
  return { ...createEmptyDoc('edit', 'Edit', 1), tracks: [{ id: 'visual', kind: 'visual', items }], assets: {
    video: { id: 'video', kind: 'video', source: { kind: 'file', path: 'clip.mp4' }, duration: 10 },
  } };
}
function changed(doc: VideoDoc, ops: readonly VideoDocOp[]): VideoDoc {
  const result = applyPatch(doc, { baseVersion: doc.version, ops: withCaptionTimingOps(doc, ops) }, 2);
  if (!result.ok) throw new Error('Expected valid patch');
  return result.doc;
}
const clip: VideoItem = { id: 'clip', kind: 'footage', assetId: 'video', at: 2, duration: 4, trimStart: 1 };

describe('timeline frame boundaries', () => {
  it('seeks on the frame grid without seeking to the exclusive end', () => {
    expect(clampTimelineSeek(0.12, 2, 30)).toBe(4 / 30);
    expect(clampTimelineSeek(2, 2, 30)).toBe(59 / 30);
    expect(clampTimelineSeek(-1, 2, 30)).toBe(0);
    expect(lastTimelineFrame(0, 30)).toBe(0);
    expect(lastTimelineFrame(2.01, 30)).toBe(60);
  });
  it('generates denser ticks when zoomed, with bounded work for long timelines', () => {
    expect(timelineTicks(10, 2000, 30).length).toBeGreaterThan(timelineTicks(10, 400, 30).length);
    expect(timelineTicks(100_000, 400, 30).length).toBeLessThan(10);
  });
});

describe('timeline document edits', () => {
  it('moves a relative clip without detaching its anchor and leaves the input untouched', () => {
    const doc = document([clip, { ...clip, id: 'next', at: { after: 'clip', offset: 0.5 } }]);
    const next = changed(doc, buildTimelineEditOps(doc, 'next', 'move', 0.21));
    const anchor = next.tracks[0]?.items[1]?.at;
    expect(anchor).toMatchObject({ after: 'clip' });
    expect(typeof anchor === 'object' ? anchor.offset : undefined).toBeCloseTo(0.7);
    expect(doc.tracks[0]?.items[1]?.at).toEqual({ after: 'clip', offset: 0.5 });
  });
  it('moves direct and indirectly anchored absolute captions, including word timing', () => {
    const doc = document([clip,
      { id: 'cap', kind: 'caption', at: { start: 'clip' }, duration: 2, cues: [{ start: 2, end: 4, text: 'Hi', words: [{ t: 2.5, text: 'Hi' }] }] },
      { id: 'next-cap', kind: 'caption', at: { after: 'cap' }, duration: 2, cues: [{ start: 4, end: 6, text: 'Next' }] },
    ]);
    const next = changed(doc, buildTimelineEditOps(doc, 'clip', 'move', 1));
    expect(next.tracks[0]?.items[1]?.cues?.[0]).toEqual({ start: 3, end: 5, text: 'Hi', words: [{ t: 3.5, text: 'Hi' }] });
    expect(next.tracks[0]?.items[2]?.cues?.[0]?.start).toBe(5);
    expect(buildDrawList(next, resolveTimeline(next), 3.5).find(op => op.itemId === 'cap')?.cues[0]?.text).toBe('Hi');
  });
  it('does not shift explicit caption edits or restoration snapshots twice', () => {
    const doc = document([{ id: 'cap', kind: 'caption', at: 0, duration: 2, cues: [{ start: 0, end: 2, text: 'Hi' }] }]);
    const ops: VideoDocOp[] = [{ op: 'updateItem', itemId: 'cap', patch: { at: 1, cues: [{ start: 1, end: 3, text: 'Hi' }] } }];
    expect(withCaptionTimingOps(doc, ops)).toEqual(ops);
  });
  it('keeps the original media frame when trimming the start and caps extension to the source', () => {
    const doc = document([clip]);
    const next = changed(doc, buildTimelineEditOps(doc, 'clip', 'trimStart', 1));
    const resolved = resolveTimeline(next);
    expect(resolved.items[0]).toMatchObject({ start: 3, duration: 3, end: 6, item: { trimStart: 2 } });
    expect(buildDrawList(next, resolved, 3)[0]?.sourceTime).toBe(2);
    const extended = changed(doc, buildTimelineEditOps(doc, 'clip', 'trimStart', -20));
    expect(resolveTimeline(extended).items[0]).toMatchObject({ start: 1, end: 6, item: { trimStart: 0 } });
    const end = changed(doc, buildTimelineEditOps(doc, 'clip', 'trimEnd', 20));
    expect(resolveTimeline(end).items[0]?.duration).toBe(9);
  });
  it('preserves at least one frame when a handle crosses the other edge', () => {
    const doc = document([clip]);
    const start = changed(doc, buildTimelineEditOps(doc, 'clip', 'trimStart', 20));
    const end = changed(doc, buildTimelineEditOps(doc, 'clip', 'trimEnd', -20));
    expect(resolveTimeline(start).items[0]?.duration).toBeCloseTo(1 / 30);
    expect(resolveTimeline(end).items[0]?.duration).toBeCloseTo(1 / 30);
  });
  it('keeps caption cue positions when cropping and prevents animated scene start trimming', () => {
    const doc = document([{ id: 'cap', kind: 'caption', at: 0, duration: 4, cues: [{ start: 0, end: 4, text: 'Hi' }] },
      { id: 'scene', kind: 'scene', sceneId: 'title', at: 0, duration: 4 }]);
    const next = changed(doc, buildTimelineEditOps(doc, 'cap', 'trimStart', 1));
    expect(next.tracks[0]?.items[0]?.cues).toEqual(doc.tracks[0]?.items[0]?.cues);
    expect(buildTimelineEditOps(doc, 'scene', 'trimStart', 1)).toEqual([]);
    expect(buildTimelineEditOps(doc, 'scene', 'trimEnd', -1)).not.toEqual([]);
  });
  it('shifts captions anchored after a trimmed clip', () => {
    const doc = document([clip, { id: 'cap', kind: 'caption', at: { after: 'clip' }, duration: 2, cues: [{ start: 6, end: 8, text: 'Hi' }] }]);
    const next = changed(doc, buildTimelineEditOps(doc, 'clip', 'trimEnd', -1));
    expect(next.tracks[0]?.items[1]?.cues?.[0]?.start).toBe(5);
  });
  it('does not emit edits for unsupported, missing, invalid, or unchanged input', () => {
    const doc = document([clip]);
    expect(buildTimelineEditOps(doc, 'absent', 'move', 1)).toEqual([]);
    expect(buildTimelineEditOps(doc, 'clip', 'move', NaN)).toEqual([]);
    expect(buildTimelineEditOps(doc, 'clip', 'move', 0.001)).toEqual([]);
    expect(buildTimelineEditOps(doc, 'clip', 'move', 0)).toEqual([]);
  });
});

describe('timeline snapping', () => {
  it('snaps either edge during a move and only the active edge while trimming', () => {
    const snapped = snapTimelineDelta(2, 6, 1.9, 'move', [8], 0.2);
    expect(snapped.delta).toBeCloseTo(2);
    expect(snapped.snap).toBe(8);
    expect(snapTimelineDelta(2, 6, 1.9, 'trimStart', [8], 0.2)).toEqual({ delta: 1.9, snap: null });
  });
  it('excludes anchor descendants from stationary snap targets', () => {
    const doc = document([clip, { ...clip, id: 'child', at: { after: 'clip' }, duration: 2 }, { ...clip, id: 'stable', at: 12, duration: 3 }]);
    expect(timelineSnapPoints(doc, 'clip', 1)).toEqual([0, 1, 12, 15]);
  });
});
