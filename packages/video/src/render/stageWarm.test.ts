import { describe, expect, it } from 'vitest';
import type { ResolvedItem, ResolvedTimeline, VideoItemKind } from '../types.js';
import { parkedToRelease, upcomingCompositions } from './stageWarm.js';

function item(id: string, kind: VideoItemKind, start: number, end: number): ResolvedItem {
  return { id, trackId: 'v', trackKind: 'visual', kind, start, end, duration: end - start, item: { id, kind } as ResolvedItem['item'] };
}
function timeline(items: ResolvedItem[]): ResolvedTimeline {
  return { items, duration: Math.max(0, ...items.map((i) => i.end)), diagnostics: [], chapters: [] };
}

describe('§5.13 (X) 39-5 미리보기 무대 데우기 — 곧 시작할 컴포지션', () => {
  const tl = timeline([
    item('a', 'composition', 0, 3),
    item('b', 'composition', 3, 6),
    item('c', 'composition', 4, 8),
    item('d', 'composition', 9, 12),
    item('t', 'text', 3.5, 5),
  ]);

  it('지금 보이는 것은 빼고, 거리 안에서 시작하는 컴포지션만 가까운 순으로 고른다', () => {
    expect(upcomingCompositions(tl, 0.5, new Set(['a']), { aheadSeconds: 3, aheadMax: 5 }).map((u) => u.id)).toEqual(['b']);
    expect(upcomingCompositions(tl, 2.5, new Set(['a']), { aheadSeconds: 3, aheadMax: 5 }).map((u) => u.id)).toEqual(['b', 'c']);
  });

  it('상한만큼만 연다 · 글자 같은 다른 종류는 데우지 않는다', () => {
    expect(upcomingCompositions(tl, 2.5, new Set(['a']), { aheadSeconds: 10, aheadMax: 1 }).map((u) => u.id)).toEqual(['b']);
    expect(upcomingCompositions(tl, 2.5, new Set(), { aheadSeconds: 10, aheadMax: 9 }).some((u) => u.id === 't')).toBe(false);
  });

  it('이미 시작한(지나간) 아이템은 미리 열 대상이 아니다 · 끄면(0) 아무것도 고르지 않는다', () => {
    expect(upcomingCompositions(tl, 5, new Set(['b', 'c']), { aheadSeconds: 3, aheadMax: 5 }).map((u) => u.id)).toEqual([]);
    expect(upcomingCompositions(tl, 0, new Set(), { aheadSeconds: 0, aheadMax: 5 })).toEqual([]);
    expect(upcomingCompositions(tl, 0, new Set(), { aheadSeconds: 5, aheadMax: 0 })).toEqual([]);
  });
});

describe('§5.13 (X) 39-5 미리보기 무대 데우기 — 보관분 버리기', () => {
  const opts = { keepParked: 2, parkedTtlMs: 1000 };

  it('시간이 지난 것은 버리고, 상한을 넘으면 오래 쉰 것부터 버린다', () => {
    const parked = [
      { id: 'old', parkedAt: 0 },
      { id: 'p1', parkedAt: 1500 },
      { id: 'p2', parkedAt: 1600 },
      { id: 'p3', parkedAt: 1700 },
    ];
    expect(parkedToRelease(parked, 1800, new Set(), opts)).toEqual(['old', 'p1']);
  });

  it('곧 쓸 것(미리 연 것)은 시간·상한과 무관하게 남긴다', () => {
    const parked = [{ id: 'soon', parkedAt: 0 }, { id: 'p1', parkedAt: 900 }];
    expect(parkedToRelease(parked, 1500, new Set(['soon']), opts)).toEqual([]);
  });

  it('보관 상한이 0 이면 지나간 것은 전부 버린다', () => {
    expect(parkedToRelease([{ id: 'a', parkedAt: 10 }, { id: 'b', parkedAt: 20 }], 30, new Set(), { keepParked: 0, parkedTtlMs: 1000 })).toEqual(['a', 'b']);
  });
});
