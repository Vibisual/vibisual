import { describe, expect, it } from 'vitest';
import { applyPatch, createEmptyDoc, resolveTimeline, type VideoAsset, type VideoDoc } from '@vibisual/video';
import { applySourceRevisionOps } from './videoSourceLinks.js';

const asset: VideoAsset = { id: 'old', kind: 'model', source: { kind: 'file', path: 'old.vibi3d' }, creationSource: { id: 'product', revision: 1, appId: 'vibi3d' } };
describe('selective source revisions', () => {
  it('changes only the chosen source reference, preserving timings, human props, captions and audio', () => {
    const doc: VideoDoc = { ...createEmptyDoc('doc', 'Product'), assets: { old: asset, voice: { id: 'voice', kind: 'audio', source: { kind: 'file', path: 'voice.wav' }, duration: 10 } }, tracks: [
      { id: 'visual', kind: 'visual', items: [{ id: 'first', kind: 'model', assetId: 'old', at: 0, duration: 5, props: { cameraOrbit: 40 }, trimStart: 1 }, { id: 'second', kind: 'model', assetId: 'old', at: 5, duration: 5, props: { cameraYaw: 1 } }] },
      { id: 'audio', kind: 'audio', items: [{ id: 'voice', kind: 'audio', assetId: 'voice', at: 0, duration: 'auto' }] },
      { id: 'captions', kind: 'caption', items: [{ id: 'price', kind: 'caption', at: 7, duration: 3, cues: [{ start: 7, end: 10, text: '$29' }] }] },
    ] };
    const next = { ...asset, id: 'new', creationSource: { ...asset.creationSource!, revision: 2 } };
    const result = applyPatch(doc, { baseVersion: doc.version, ops: applySourceRevisionOps(doc, 'old', next, ['first', 'missing']) });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.doc.tracks[0]?.items[0]).toEqual({ ...doc.tracks[0]?.items[0], assetId: 'new' });
    expect(result.doc.tracks[0]?.items[1]).toEqual(doc.tracks[0]?.items[1]);
    expect(result.doc.tracks.slice(1)).toEqual(doc.tracks.slice(1));
    expect(result.doc.assets['old']).toEqual(asset);
    expect(resolveTimeline(result.doc).duration).toBe(10);
    expect(JSON.parse(JSON.stringify(result.doc)).assets.new.creationSource.revision).toBe(2);
    expect(applyPatch(result.doc, { baseVersion: doc.version, ops: [{ op: 'updateItem', itemId: 'first', patch: { props: { cameraOrbit: 0 } } }] }).ok).toBe(false);
  });
  it('does not publish or apply an unselected revision', () => {
    expect(applySourceRevisionOps(createEmptyDoc('doc', ''), 'old', asset, [])).toEqual([]);
  });
});
