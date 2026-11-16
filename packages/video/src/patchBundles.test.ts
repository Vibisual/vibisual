import { describe, expect, it } from 'vitest';
import { applyPatch, createEmptyDoc } from './ops.js';
import { expandPatchOps } from './patchBundles.js';
import { BASE_OP_NAMES, BUNDLE_OP_NAMES, checkOpShape } from './patchShape.js';
import { diagnosticFixes, isSafeFix, simulateOps, versionConflictFix } from './patchFix.js';
import { resolveTimeline } from './resolveTimeline.js';
import { ITEM_KINDS } from './validateDoc.js';
import type { ExpandedPatch } from './patchBundles.js';
import { VIDEO_ASSET_KINDS } from './types.js';
import type { VideoAsset, VideoChapter, VideoDoc, VideoDocOp } from './types.js';

const NOW = 1_700_000_000_000;
const chapter = (id: string, extra: Partial<VideoChapter> = {}): VideoChapter => ({ id, title: id, duration: 4, status: 'plan', ...extra });
const base = (): VideoDoc => createEmptyDoc('d', 'Doc', NOW);
const withChapter = (): VideoDoc => {
  const r = applyPatch(base(), { baseVersion: 1, ops: [{ op: 'addChapter', chapter: chapter('intro') }] }, NOW);
  if (!r.ok) throw new Error('setup');
  return r.doc;
};
const plain = (ops: readonly VideoDocOp[]): ExpandedPatch => {
  const r = expandPatchOps(ops);
  if (!r.ok) throw new Error('expand');
  return r.value;
};

describe('§5.13 (G) bundle ops expand to the existing ops', () => {
  it('a request without bundles passes through untouched (same array, same path as before)', () => {
    const ops: VideoDocOp[] = [{ op: 'removeItem', itemId: 'x' }];
    const r = expandPatchOps(ops);
    expect(r.ok && r.value.ops).toBe(ops);
    expect(r.ok && r.value.bundled).toBe(false);
  });

  it('addScene = addChapter, setAsset each, addItem each with chapterId and a chapter anchor; a given at is kept', () => {
    const r = expandPatchOps([{
      op: 'addScene',
      chapter: chapter('s1'),
      assets: [{ id: 'logo', kind: 'image', source: { kind: 'file', path: 'logo.png' } }],
      items: [
        { trackId: 'visual', item: { id: 'logo-1', kind: 'image', duration: 2, assetId: 'logo' }, offset: 0.5 },
        { trackId: 'visual', item: { id: 'title', kind: 'text', duration: 2, at: 1 } },
      ],
    }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.ops).toEqual([
      { op: 'addChapter', chapter: chapter('s1') },
      { op: 'setAsset', asset: { id: 'logo', kind: 'image', source: { kind: 'file', path: 'logo.png' } } },
      { op: 'addItem', trackId: 'visual', item: { id: 'logo-1', kind: 'image', duration: 2, assetId: 'logo', chapterId: 's1', at: { chapter: 's1', offset: 0.5 } } },
      { op: 'addItem', trackId: 'visual', item: { id: 'title', kind: 'text', duration: 2, at: 1, chapterId: 's1' } },
    ]);
    expect(r.value.origin.map((o) => [o.opIndex, o.part])).toEqual([[0, 0], [0, 1], [0, 2], [0, 3]]);
    // 풀린 열과 손으로 쓴 같은 열이 같은 문서를 낸다.
    const viaBundle = applyPatch(base(), { baseVersion: 1, ops: r.value.ops }, NOW);
    const byHand = applyPatch(base(), { baseVersion: 1, ops: r.value.ops.map((op) => JSON.parse(JSON.stringify(op)) as VideoDocOp) }, NOW);
    expect(viaBundle).toEqual(byHand);
  });

  it('fillChapter puts updateChapter first (empty patch without status), then assets and items', () => {
    const r = expandPatchOps([{ op: 'fillChapter', chapterId: 'intro', items: [{ trackId: 'visual', item: { id: 'a', kind: 'shape', duration: 1 } }] }]);
    expect(r.ok && r.value.ops).toEqual([
      { op: 'updateChapter', chapterId: 'intro', patch: {} },
      { op: 'addItem', trackId: 'visual', item: { id: 'a', kind: 'shape', duration: 1, chapterId: 'intro', at: { chapter: 'intro' } } },
    ]);
    const withStatus = expandPatchOps([{ op: 'fillChapter', chapterId: 'intro', status: 'building' }]);
    expect(withStatus.ok && withStatus.value.ops).toEqual([{ op: 'updateChapter', chapterId: 'intro', patch: { status: 'building' } }]);
  });

  it('placeAsset = setAsset + addItem with the asset id; with chapterId it checks the chapter first and anchors to it', () => {
    const asset = { id: 'clip', kind: 'video' as const, source: { kind: 'file' as const, path: 'clip.mp4' } };
    const free = expandPatchOps([{ op: 'placeAsset', asset, trackId: 'visual', item: { id: 'c1', kind: 'footage', duration: 'auto', at: 2 } }]);
    expect(free.ok && free.value.ops).toEqual([
      { op: 'setAsset', asset },
      { op: 'addItem', trackId: 'visual', item: { id: 'c1', kind: 'footage', duration: 'auto', at: 2, assetId: 'clip' } },
    ]);
    const inChapter = expandPatchOps([{ op: 'placeAsset', asset, trackId: 'visual', chapterId: 'intro', offset: 1, item: { id: 'c1', kind: 'footage', duration: 'auto' } }]);
    expect(inChapter.ok && inChapter.value.ops.map((o) => o.op)).toEqual(['updateChapter', 'setAsset', 'addItem']);
    expect(inChapter.ok && inChapter.value.ops[2]).toMatchObject({ item: { chapterId: 'intro', at: { chapter: 'intro', offset: 1 }, assetId: 'clip' } });
  });

  it('a bad bundle expands nothing and reports every wrong field with its path and the allowed values', () => {
    const r = expandPatchOps([
      { op: 'removeItem', itemId: 'x' },
      { op: 'addScene', chapter: { id: 's', title: 'S', duration: 3 }, items: [{ trackId: 'visual', item: { id: 'i', kind: 'video', duration: 1 } }] },
      { op: 'placeAsset', asset: { id: 'a', kind: 'image', source: { kind: 'file', path: 'a.png' } }, trackId: 'visual', item: { id: 'p', kind: 'image', duration: 1 } },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.opIndex).toBe(1);
    const status = r.fix.find((f) => f.field === 'chapter.status');
    expect(status).toMatchObject({ opIndex: 1, op: 'addScene', code: 'missing-field', allowed: ['plan', 'approved', 'building', 'done'] });
    expect(r.fix.find((f) => f.field === 'items[0].item.kind')).toMatchObject({ opIndex: 1, code: 'bad-value', got: 'video', allowed: ITEM_KINDS });
    expect(r.fix.find((f) => f.opIndex === 2)).toMatchObject({ field: 'item.at', code: 'missing-field' });
  });
});

describe('§5.13 (G) op shape and fix hints', () => {
  it('an unknown op lists every op name, a wrong enum lists the allowed values', () => {
    expect(checkOpShape({ op: 'addClip' })).toEqual([expect.objectContaining({ code: 'unknown-op', field: 'op', allowed: [...BASE_OP_NAMES, ...BUNDLE_OP_NAMES] })]);
    expect(BASE_OP_NAMES).toHaveLength(15);
    expect(checkOpShape({ op: 'addItem', trackId: 'visual', item: { id: 'i', kind: 'clip', at: 0, duration: 1 } }))
      .toEqual([expect.objectContaining({ field: 'item.kind', got: 'clip', allowed: ITEM_KINDS })]);
    expect(checkOpShape({ op: 'updateChapter', chapterId: 'c', patch: { status: 'ready' } })).toEqual([expect.objectContaining({ field: 'patch.status', code: 'bad-value' })]);
    expect(checkOpShape({ op: 'setAsset', asset: { id: 'x', kind: 'composition', source: { kind: 'file', path: 'c/index.html' } } })).toEqual([]);
  });

  it('an unknown asset kind is a warning listing VIDEO_ASSET_KINDS — setAsset applies it, so bundles accept it too', () => {
    const svg = { id: 'logo', kind: 'svg', source: { kind: 'file', path: 'logo.svg' } } as unknown as VideoAsset;
    expect(checkOpShape({ op: 'setAsset', asset: svg })).toEqual([
      expect.objectContaining({ code: 'unknown-value', level: 'warn', field: 'asset.kind', got: 'svg', allowed: VIDEO_ASSET_KINDS }),
    ]);
    expect(applyPatch(base(), { baseVersion: 1, ops: [{ op: 'setAsset', asset: svg }] }, NOW).ok).toBe(true);
    const placed = expandPatchOps([{ op: 'placeAsset', asset: svg, trackId: 'visual', item: { id: 'p', kind: 'image', duration: 1, at: 0 } }]);
    expect(placed.ok).toBe(true);
    const sim = simulateOps(base(), plain(placed.ok ? placed.value.ops : []));
    expect(sim.failed).toBe(0);
    const scene = expandPatchOps([{ op: 'addScene', chapter: chapter('s'), assets: [svg] }]);
    if (!scene.ok) throw new Error('expand');
    const sceneSim = simulateOps(base(), scene.value);
    expect(sceneSim.fixes).toEqual([expect.objectContaining({ opIndex: 0, op: 'addScene', part: 1, level: 'warn', field: 'assets[0].kind', got: 'svg' })]);
    expect(isSafeFix(sceneSim.fixes)).toBe(true);
  });

  it('a bundle asset that replaces an existing asset id with other content warns; the same content again does not', () => {
    const img = { id: 'img', kind: 'image' as const, source: { kind: 'file' as const, path: 'a.png' } };
    const r = applyPatch(withChapter(), { baseVersion: 2, ops: [{ op: 'setAsset', asset: img }] }, NOW);
    if (!r.ok) throw new Error('setup');
    const other = { ...img, source: { kind: 'file' as const, path: 'OTHER.png' } };
    const run = (ops: unknown[]) => {
      const e = expandPatchOps(ops);
      if (!e.ok) throw new Error('expand');
      return simulateOps(r.doc, e.value).fixes;
    };
    const item = { id: 'p', kind: 'image' as const, duration: 1, at: 0 };
    const placed = run([{ op: 'placeAsset', asset: other, trackId: 'visual', item }]);
    expect(placed).toEqual([expect.objectContaining({ code: 'asset-overwrite', level: 'warn', opIndex: 0, part: 0, field: 'asset.id', got: 'img' })]);
    expect(placed[0]!.hint).toContain('source: file a.png -> file OTHER.png');
    expect(placed[0]!.hint).toContain('new id');
    expect(isSafeFix(placed)).toBe(true);
    expect(run([{ op: 'fillChapter', chapterId: 'intro', assets: [other] }])).toEqual([expect.objectContaining({ code: 'asset-overwrite', part: 1, field: 'assets[0].id' })]);
    expect(run([{ op: 'addScene', chapter: chapter('s2'), assets: [{ ...img, duration: 3 }] }])).toEqual([expect.objectContaining({ code: 'asset-overwrite', field: 'assets[0].id' })]);
    // 같은 내용 재전송(키 순서만 다름)·손으로 쓴 setAsset 은 조용하다.
    expect(run([{ op: 'placeAsset', asset: { source: { path: 'a.png', kind: 'file' }, kind: 'image', id: 'img' }, trackId: 'visual', item }])).toEqual([]);
    expect(run([{ op: 'setAsset', asset: other }])).toEqual([]);
  });

  it('a malformed op no longer throws out of applyPatch — it is an invalid-op like any other', () => {
    const r = applyPatch(base(), { baseVersion: 1, ops: [{ op: 'addItem', trackId: 'visual' } as unknown as VideoDocOp] }, NOW);
    expect(r).toMatchObject({ ok: false, reason: 'invalid-op', opIndex: 0 });
  });

  it('simulation skips a failing op and keeps going, so every broken op is reported at once', () => {
    const fixes = simulateOps(withChapter(), plain([
      { op: 'addItem', trackId: 'video', item: { id: 'a', kind: 'shape', at: 0, duration: 1 } },
      { op: 'addItem', trackId: 'visual', item: { id: 'b', kind: 'shape', at: 0, duration: 1 } },
      { op: 'updateChapter', chapterId: 'outro', patch: { status: 'done' } },
      { op: 'addItem', trackId: 'visual', item: { id: 'b', kind: 'shape', at: 0, duration: 1 } },
    ]));
    expect(fixes.failed).toBe(3);
    expect(fixes.fixes).toEqual([
      expect.objectContaining({ opIndex: 0, op: 'addItem', code: 'unknown-id', field: 'trackId', got: 'video', allowed: ['visual', 'audio', 'caption'] }),
      expect.objectContaining({ opIndex: 2, code: 'unknown-id', field: 'chapterId', allowed: ['intro'] }),
      expect.objectContaining({ opIndex: 3, code: 'duplicate-id', field: 'item.id', got: 'b' }),
    ]);
  });

  it('a bundle failure points at the request op and the field inside the bundle', () => {
    const fixes = simulateOps(withChapter(), plain([
      { op: 'removeChapter', chapterId: 'intro' },
      { op: 'fillChapter', chapterId: 'intro', items: [{ trackId: 'nope', item: { id: 'x', kind: 'shape', duration: 1 } }] },
    ]));
    expect(fixes.fixes[0]).toMatchObject({ opIndex: 1, op: 'fillChapter', part: 0, field: 'chapterId', allowed: [] });
    expect(fixes.fixes[1]).toMatchObject({ opIndex: 1, part: 1, field: 'items[0].trackId', allowed: ['visual', 'audio', 'caption'] });
  });

  it('an unknown beforeItemId is a warning with the ids on that track (the item still goes to the end)', () => {
    const fixes = simulateOps(base(), plain([{ op: 'addItem', trackId: 'visual', item: { id: 'a', kind: 'shape', at: 0, duration: 1 }, beforeItemId: 'zz' }]));
    expect(fixes).toEqual({ failed: 0, fixes: [expect.objectContaining({ level: 'warn', field: 'beforeItemId', allowed: [] })] });
  });

  it('409 says the current version first, then how the same ops fare against it', () => {
    const doc = withChapter();
    const clean = versionConflictFix(1, doc, plain([{ op: 'updateChapter', chapterId: 'intro', patch: { status: 'approved' } }]));
    expect(clean).toEqual([expect.objectContaining({ code: 'version-conflict', field: 'baseVersion', got: 1, currentVersion: 2 })]);
    expect(clean[0]!.hint).toContain('apply cleanly');
    const stale = versionConflictFix(1, doc, plain([{ op: 'removeChapter', chapterId: 'gone' }]));
    expect(stale.map((f) => f.code)).toEqual(['version-conflict', 'unknown-id']);
  });

  it('diagnostics get a fix line each: field, allowed ids, the chapter they are about, and whether this patch caused them', () => {
    const before = withChapter();
    const r = applyPatch(before, { baseVersion: 2, ops: [
      { op: 'addItem', trackId: 'visual', item: { id: 'x', kind: 'shape', at: { chapter: 'outro' }, duration: 1 } },
      { op: 'addChapter', chapter: chapter('bad', { duration: -1 }) },
    ] }, NOW);
    if (!r.ok) throw new Error('apply');
    const diags = resolveTimeline(r.doc).diagnostics;
    const fixes = diagnosticFixes(r.doc, diags, resolveTimeline(before).diagnostics);
    expect(fixes).toHaveLength(diags.length);
    expect(fixes.find((f) => f.code === 'unknown-chapter')).toMatchObject({ itemId: 'x', field: 'item.at.chapter', got: 'outro', allowed: ['intro', 'bad'], introduced: true });
    expect(fixes.find((f) => f.code === 'chapter-bad-duration')).toMatchObject({ chapterId: 'bad', field: 'chapter.duration', got: -1 });
    expect(isSafeFix(fixes)).toBe(false);
    // 이미 있던 진단만 남으면 안전하다.
    expect(isSafeFix(diagnosticFixes(r.doc, diags, diags))).toBe(true);
  });
});
