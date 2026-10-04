import { describe, expect, it } from 'vitest';

import {
  FILE_DOC_ASSET_ID,
  FILE_DOC_ITEM_ID,
  assetsNeedingMeasurement,
  buildFileDocOps,
  buildMeasurementOps,
  evenSide,
  isUntouchedDoc,
  type MediaMeasurement,
} from './fileDoc.js';
import { applyPatch, createEmptyDoc } from './ops.js';
import { resolveTimeline } from './resolveTimeline.js';
import type { VideoDoc, VideoDocOp } from './types.js';

const base = (): VideoDoc => createEmptyDoc('file-abc', 'clip.mp4', 1000);

function apply(d: VideoDoc, ops: VideoDocOp[]): VideoDoc {
  const r = applyPatch(d, { baseVersion: d.version, ops }, 2000);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.doc;
}

const portrait: MediaMeasurement = { duration: 6.5, width: 390, height: 650 };
const file = { path: 'test-output/clip.mp4', label: 'clip.mp4' };

describe('§5.13 (R-3) 눌러 연 영상 → 문서', () => {
  it('새 문서는 빈 트랙 셋을 달고 있어도 "손대지 않은 문서"다', () => {
    // 회귀: 트랙 수(=3)로 판정해 영상이 영영 실리지 않던 결함.
    const d = base();
    expect(d.tracks.length).toBeGreaterThan(0);
    expect(isUntouchedDoc(d)).toBe(true);
  });

  it('담은 뒤에는 해소된 타임라인에 그 클립이 실제 길이로 남는다', () => {
    const d = apply(base(), buildFileDocOps(base(), file, portrait));
    const timeline = resolveTimeline(d);

    expect(timeline.diagnostics).toEqual([]);
    expect(timeline.items).toHaveLength(1);
    expect(timeline.items[0]).toMatchObject({ id: FILE_DOC_ITEM_ID, kind: 'footage', start: 0, end: 6.5 });
    expect(timeline.duration).toBe(6.5);
    expect(d.assets[FILE_DOC_ASSET_ID]).toMatchObject({ duration: 6.5, width: 390, height: 650 });
    expect(isUntouchedDoc(d)).toBe(false);
  });

  it('새 문서가 가진 visual 트랙에 얹는다(트랙을 하나 더 만들지 않는다)', () => {
    const d = apply(base(), buildFileDocOps(base(), file, portrait));
    expect(d.tracks.map((t) => t.id)).toEqual(['visual', 'audio', 'caption']);
    expect(d.tracks[0]?.items.map((i) => i.id)).toEqual([FILE_DOC_ITEM_ID]);
  });

  it('visual 트랙이 없으면 만든다', () => {
    const bare: VideoDoc = { ...base(), tracks: [] };
    const d = apply(bare, buildFileDocOps(bare, file, portrait));
    expect(resolveTimeline(d).items).toHaveLength(1);
  });

  it('판형은 그 영상 크기로, 홀수 변은 짝수로 내린다', () => {
    expect(apply(base(), buildFileDocOps(base(), file, portrait)).size).toEqual({ width: 390, height: 650 });
    const odd = apply(base(), buildFileDocOps(base(), file, { duration: 2, width: 641, height: 361 }));
    expect(odd.size).toEqual({ width: 640, height: 360 });
    expect(evenSide(1)).toBe(2);
  });

  it('크기를 못 쟀으면 판형은 그대로 두고 클립만 선다', () => {
    const d = apply(base(), buildFileDocOps(base(), file, { duration: 3, width: null, height: null }));
    expect(d.size).toEqual(base().size);
    expect(resolveTimeline(d).items).toHaveLength(1);
  });

  it('길이를 못 쟀으면 아무것도 담지 않는다 — 풀리지 않을 auto 클립으로 문서를 굳히지 않는다', () => {
    expect(buildFileDocOps(base(), file, { duration: null, width: 390, height: 650 })).toEqual([]);
    expect(buildFileDocOps(base(), file, { duration: 0, width: 390, height: 650 })).toEqual([]);
    expect(buildFileDocOps(base(), file, { duration: Number.NaN, width: 390, height: 650 })).toEqual([]);
  });
});

describe('§5.13 (R-3) 빠진 실측값 채우기', () => {
  const withAutoClip = (): VideoDoc =>
    apply(base(), [
      { op: 'setAsset', asset: { id: 'v', kind: 'video', source: { kind: 'file', path: 'a.mp4' } } },
      { op: 'setAsset', asset: { id: 'img', kind: 'image', source: { kind: 'file', path: 'a.png' } } },
      { op: 'addItem', trackId: 'visual', item: { id: 'c', kind: 'footage', at: 0, duration: 'auto', assetId: 'v' } },
    ]);

  it('길이 없는 영상·소리만 잴 대상이다', () => {
    expect(assetsNeedingMeasurement(withAutoClip()).map((a) => a.id)).toEqual(['v']);
  });

  it('잰 값을 적으면 빠져 있던 auto 클립이 풀린다', () => {
    const d = withAutoClip();
    expect(resolveTimeline(d).items).toHaveLength(0);
    const filled = apply(d, buildMeasurementOps(d, { v: { duration: 4, width: 100, height: 50 } }));
    expect(resolveTimeline(filled).items).toHaveLength(1);
    expect(filled.assets['v']).toMatchObject({ duration: 4, width: 100, height: 50 });
  });

  it('새로 알게 된 길이가 없으면 연산을 만들지 않는다', () => {
    const d = withAutoClip();
    expect(buildMeasurementOps(d, {})).toEqual([]);
    expect(buildMeasurementOps(d, { v: { duration: null, width: 100, height: 50 } })).toEqual([]);
  });

  it('이미 적힌 값은 덮지 않는다', () => {
    const d = apply(base(), [
      { op: 'setAsset', asset: { id: 'v', kind: 'video', source: { kind: 'file', path: 'a.mp4' }, width: 7 } },
    ]);
    const [op] = buildMeasurementOps(d, { v: { duration: 4, width: 100, height: 50 } });
    expect(op).toMatchObject({ op: 'setAsset', asset: { duration: 4, width: 7, height: 50 } });
  });
});
