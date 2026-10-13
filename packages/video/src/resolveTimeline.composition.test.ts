import { describe, expect, it } from 'vitest';

import { docHasCompositions, resolveTimeline } from './resolveTimeline.js';
import type { VideoAsset, VideoDoc, VideoItem, VideoTrack } from './types.js';

/**
 * §5.13 (T-1) — composition 아이템의 해소 진단과 (T-4) 무대 선택 판정.
 *
 * 컴포지션이 틀린 소재를 가리키면 **그 아이템만** 빠지고 진단이 남아야 한다 — 문서 전체를 거부하면 에이전트가
 * 고칠 길이 사라진다. 그리고 `docHasCompositions` 하나가 미리보기·스틸·렌더의 무대를 가르므로(canvas2d 는 HTML 을
 * 못 그린다) 켜짐·숨김·트랙 종류를 여기서 못 박는다.
 */

function track(id: string, kind: VideoTrack['kind'], items: VideoItem[], extra: Partial<VideoTrack> = {}): VideoTrack {
  return { id, kind, items, ...extra };
}

function doc(tracks: VideoTrack[], assets: Record<string, VideoAsset> = {}): VideoDoc {
  return {
    schemaVersion: 2,
    id: 'doc1',
    title: 'test',
    version: 1,
    size: { width: 1920, height: 1080 },
    fps: 30,
    tracks,
    assets,
    createdAt: 0,
    updatedAt: 0,
  };
}

const COMP_PATH = '.vibisual/video/compositions/intro/index.html';

function compAsset(id: string, path: string = COMP_PATH, extra: Partial<VideoAsset> = {}): VideoAsset {
  return { id, kind: 'composition', source: { kind: 'file', path }, duration: 4, ...extra };
}

function compItem(id: string, assetId: string | undefined, extra: Partial<VideoItem> = {}): VideoItem {
  return { id, kind: 'composition', at: 0, duration: 3, ...(assetId === undefined ? {} : { assetId }), ...extra };
}

const scene: VideoItem = { id: 's1', kind: 'scene', at: 0, duration: 2 };

const codes = (d: ReturnType<typeof resolveTimeline>): string[] => d.diagnostics.map((x) => x.code);

describe('§5.13 (T-1) composition 아이템 해소', () => {
  it('프로젝트 안 HTML 소재를 가리키면 평소처럼 놓인다', () => {
    const r = resolveTimeline(doc([track('v', 'visual', [compItem('c1', 'comp1')])], { comp1: compAsset('comp1') }));
    expect(r.diagnostics).toEqual([]);
    expect(r.items.map((i) => [i.id, i.start, i.end])).toEqual([['c1', 0, 3]]);
  });

  it("duration:'auto' 는 선언(탐침)된 길이로 풀린다", () => {
    const r = resolveTimeline(doc(
      [track('v', 'visual', [compItem('c1', 'comp1', { duration: 'auto' })])],
      { comp1: compAsset('comp1', COMP_PATH, { duration: 6 }) },
    ));
    expect(r.items[0]?.end).toBe(6);
  });

  const imageAsset: VideoAsset = { id: 'img', kind: 'image', source: { kind: 'file', path: 'a.png' } };
  const BROKEN: Array<[string, VideoItem, Record<string, VideoAsset>, string]> = [
    ['소재를 적지 않음', compItem('c1', undefined), {}, 'unknown-asset'],
    ['없는 소재', compItem('c1', 'nope'), {}, 'unknown-asset'],
    ['다른 종류의 소재', compItem('c1', 'img'), { img: imageAsset }, 'composition-asset-kind'],
    ['HTML 이 아닌 파일', compItem('c1', 'comp1'), { comp1: compAsset('comp1', '.vibisual/video/compositions/intro/main.js') }, 'composition-not-html'],
    ['절대 경로', compItem('c1', 'comp1'), { comp1: compAsset('comp1', '/etc/index.html') }, 'composition-outside-project'],
    ['드라이브 경로', compItem('c1', 'comp1'), { comp1: compAsset('comp1', 'C:\\x\\index.html') }, 'composition-outside-project'],
    ['상위 폴더로 나감', compItem('c1', 'comp1'), { comp1: compAsset('comp1', '../other/index.html') }, 'composition-outside-project'],
  ];
  it.each(BROKEN)('%s → 그 아이템만 빠지고 진단이 남는다', (_label, item, assets, code) => {
    const r = resolveTimeline(doc([track('v', 'visual', [item, scene])], assets));
    expect(codes(r)).toContain(code);
    expect(r.diagnostics.find((d) => d.code === code)).toMatchObject({ level: 'error', itemId: 'c1', trackId: 'v' });
    expect(r.items.map((i) => i.id)).toEqual(['s1']); // 옆 아이템은 그대로 놓인다
  });

  it('빠진 컴포지션에 앵커를 건 아이템은 함께 빠지지만, 나머지는 놓이고 문서는 거부되지 않는다', () => {
    const after: VideoItem = { id: 'after', kind: 'scene', at: { after: 'c1', offset: 0 }, duration: 1 };
    const r = resolveTimeline(doc([track('v', 'visual', [compItem('c1', 'nope'), after, scene])]));
    expect(codes(r)).toContain('unknown-asset');
    expect(r.items.map((i) => i.id)).toEqual(['s1']);
  });
});

describe('§5.13 (T-4) docHasCompositions — 무대를 가르는 한 판정', () => {
  const assets = { comp1: compAsset('comp1') };

  it('보이는 트랙에 켜진 컴포지션이 있으면 참', () => {
    expect(docHasCompositions(doc([track('v', 'visual', [scene, compItem('c1', 'comp1')])], assets))).toBe(true);
  });

  it('컴포지션이 없으면 거짓', () => {
    expect(docHasCompositions(doc([track('v', 'visual', [scene])]))).toBe(false);
  });

  it('꺼 둔 아이템·숨긴 트랙·소리 트랙은 세지 않는다', () => {
    expect(docHasCompositions(doc([track('v', 'visual', [compItem('c1', 'comp1', { enabled: false })])], assets))).toBe(false);
    expect(docHasCompositions(doc([track('v', 'visual', [compItem('c1', 'comp1')], { hidden: true })], assets))).toBe(false);
    expect(docHasCompositions(doc([track('a', 'audio', [compItem('c1', 'comp1')])], assets))).toBe(false);
  });

  it('여러 트랙 중 하나에만 있어도 참', () => {
    expect(docHasCompositions(doc([
      track('v1', 'visual', [scene]),
      track('v2', 'visual', [compItem('c1', 'comp1')], { muted: true }),
    ], assets))).toBe(true);
  });
});
