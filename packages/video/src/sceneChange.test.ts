import { describe, expect, it } from 'vitest';

import { applyPatch, createEmptyDoc } from './ops.js';
import { passTouchesScene, sceneChanges, sceneDecisionOf, sceneRestoreOps, sceneSignature } from './sceneChange.js';
import type { PassRecord } from './history.js';
import type { VideoDoc, VideoDocOp } from './types.js';

/** §5.13 (V) 37-23 — 장면 단위로 가르기 · 내용 지문 · 장면 하나만 되돌리는 연산. */

function patch(doc: VideoDoc, ops: VideoDocOp[]): VideoDoc {
  const r = applyPatch(doc, { baseVersion: doc.version, ops });
  if (!r.ok) throw new Error(`patch failed: ${r.reason}`);
  return r.doc;
}

function start(): VideoDoc {
  return patch(createEmptyDoc('d1', 'Doc', 1), [
    { op: 'addChapter', chapter: { id: 'a', title: 'Alpha', duration: 3, status: 'done' } },
    { op: 'addChapter', chapter: { id: 'b', title: 'Beta', duration: 3, status: 'done' } },
    { op: 'addItem', trackId: 'visual', item: { id: 'ta', kind: 'text', at: { chapter: 'a' }, duration: 2, chapterId: 'a', props: { text: 'one' } } },
    { op: 'addItem', trackId: 'visual', item: { id: 'tb', kind: 'text', at: { chapter: 'b' }, duration: 2, chapterId: 'b', props: { text: 'two' } } },
  ]);
}

describe('§5.13 (V) 37-23 sceneChanges', () => {
  it('groups one diff by scene and leaves scene-less changes in rest', () => {
    const before = start();
    const after = patch(before, [
      { op: 'updateItem', itemId: 'ta', patch: { props: { text: 'ONE' } } },
      { op: 'updateChapter', chapterId: 'b', patch: { title: 'Beta 2' } },
      { op: 'addChapter', chapter: { id: 'c', title: 'Gamma', duration: 2, status: 'plan' } },
      { op: 'setDoc', patch: { title: 'Renamed' } },
    ]);
    const set = sceneChanges(before, after);
    expect(set.scenes.map((s) => [s.chapterId, s.state, s.n])).toEqual([['a', 'changed', 1], ['b', 'changed', 2], ['c', 'added', 3]]);
    expect(set.scenes.every((s) => s.lines.length > 0)).toBe(true);
    expect(set.rest.length).toBeGreaterThan(0);
  });

  it('lists a removed scene after the remaining ones, numbered by its old place', () => {
    const before = start();
    const after = patch(before, [{ op: 'removeItem', itemId: 'ta' }, { op: 'removeChapter', chapterId: 'a' }]);
    const set = sceneChanges(before, after);
    expect(set.scenes.map((s) => [s.chapterId, s.state, s.n])).toEqual([['a', 'removed', 1]]);
  });

  it('says nothing when nothing changed', () => {
    const doc = start();
    expect(sceneChanges(doc, doc)).toEqual({ scenes: [], rest: [] });
  });
});

describe('§5.13 (V) 37-23 sceneSignature · sceneDecisionOf', () => {
  it('changes only when that scene changes, so a kept decision reopens when the AI edits it again', () => {
    const doc = start();
    const sigA = sceneSignature(doc, 'a');
    const otherEdited = patch(doc, [{ op: 'updateItem', itemId: 'tb', patch: { props: { text: 'x' } } }]);
    expect(sceneSignature(otherEdited, 'a')).toBe(sigA);
    const sameEdited = patch(doc, [{ op: 'updateItem', itemId: 'ta', patch: { props: { text: 'x' } } }]);
    expect(sceneSignature(sameEdited, 'a')).not.toBe(sigA);

    const pass: PassRecord = { id: 'p', startedAt: 0, startVersion: 1, status: 'done', versions: [], decided: { a: { how: 'kept', signature: sigA, at: 1 } } };
    expect(sceneDecisionOf(pass, otherEdited, 'a')?.how).toBe('kept');
    expect(sceneDecisionOf(pass, sameEdited, 'a')).toBeNull();
  });

  it('passTouchesScene reads chapterId, focus and focuses', () => {
    const pass: PassRecord = { id: 'p', startedAt: 0, startVersion: 1, status: 'open', versions: [], focus: 'b', focuses: ['a', 'b'] };
    expect(['a', 'b', 'c'].map((id) => passTouchesScene(pass, id))).toEqual([true, true, false]);
  });
});

describe('§5.13 (V) 37-23 sceneRestoreOps', () => {
  it('restores one scene and keeps the other scene’s edits', () => {
    const before = start();
    const after = patch(before, [
      { op: 'updateItem', itemId: 'ta', patch: { props: { text: 'bad' } } },
      { op: 'updateItem', itemId: 'tb', patch: { props: { text: 'good' } } },
    ]);
    const restored = patch(after, sceneRestoreOps(after, before, 'a'));
    expect(sceneSignature(restored, 'a')).toBe(sceneSignature(before, 'a'));
    expect(sceneSignature(restored, 'b')).toBe(sceneSignature(after, 'b'));
  });

  it('drops a scene the pass added and brings back one it removed', () => {
    const before = start();
    const added = patch(before, [
      { op: 'addChapter', chapter: { id: 'c', title: 'Gamma', duration: 2, status: 'done' } },
      { op: 'addItem', trackId: 'visual', item: { id: 'tc', kind: 'text', at: { chapter: 'c' }, duration: 1, chapterId: 'c' } },
    ]);
    const dropped = patch(added, sceneRestoreOps(added, before, 'c'));
    expect(dropped.chapters?.map((c) => c.id)).toEqual(['a', 'b']);
    expect(dropped.tracks.flatMap((t) => t.items.map((i) => i.id))).not.toContain('tc');

    const removed = patch(before, [{ op: 'removeItem', itemId: 'ta' }, { op: 'removeChapter', chapterId: 'a' }]);
    const back = patch(removed, sceneRestoreOps(removed, before, 'a'));
    expect(back.chapters?.map((c) => c.id)).toEqual(['a', 'b']);
    expect(sceneSignature(back, 'a')).toBe(sceneSignature(before, 'a'));
  });

  it('is empty when the scene is the same as at the start', () => {
    const doc = start();
    expect(sceneRestoreOps(doc, doc, 'a')).toEqual([]);
  });
});
