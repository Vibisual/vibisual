import { describe, expect, it } from 'vitest';
import { CHAPTER_THUMB_AT, createEmptyDoc, resolveTimeline, type DiffLine, type PassRecord, type VideoChapter, type VideoDoc, type VideoItem } from '@vibisual/video';

import {
  changeNote,
  chapterAt,
  containRect,
  focusChapterId,
  outlineRects,
  pickPoster,
  posterCandidates,
  posterTime,
  scrubImageAt,
  scrubStillTimes,
  scrubTime,
} from './glanceView.js';

/** §5.4 #36 (J) — 훑어보기 판정: ③ 바뀐 곳부터 포스터 · ② 훑는 시각과 그림 · ④ 바뀐 아이템 상자(문서 기하). */

function chapter(id: string, extra: Partial<VideoChapter> = {}): VideoChapter {
  return { id, title: id, duration: 4, status: 'done', ...extra };
}

function docWith(chapters: VideoChapter[], items: VideoItem[] = []): VideoDoc {
  const base = createEmptyDoc('d1', 'Doc', 1);
  return { ...base, chapters, tracks: base.tracks.map((t) => (t.kind === 'visual' ? { ...t, items } : t)) };
}

function pass(extra: Partial<PassRecord> = {}): PassRecord {
  return { id: 'p1', startedAt: 1, startVersion: 1, status: 'done', versions: [2], ...extra };
}

function glanceOf(doc: VideoDoc, p: PassRecord | null, lines: DiffLine[] = []) {
  return { timeline: resolveTimeline(doc), pass: p, lines };
}

describe('§5.4 #36 (J) ③ 바뀐 곳부터', () => {
  const doc = docWith([chapter('a'), chapter('b', { status: 'building' }), chapter('c')]);

  it('후보 차례: 바퀴의 장면 → 만진 것 → 바뀐 것의 첫 장면 줄 → 첫 done 장면(겹치면 한 번)', () => {
    const lines: DiffLine[] = [{ kind: 'chapterTitle', values: {}, target: { chapterId: 'b' } }];
    expect(posterCandidates(glanceOf(doc, pass({ chapterId: 'c', focus: 'b' }), lines))).toEqual(['c', 'b', 'a']);
    expect(posterCandidates(glanceOf(doc, pass({ focus: 'item-1' }), lines))).toEqual(['b', 'a']);
    expect(posterCandidates(glanceOf(doc, null))).toEqual(['a']);
  });

  it('그림이 있는 첫 후보가 포스터 — 시각은 그 장면의 대표 프레임 자리', () => {
    const g = glanceOf(doc, pass({ chapterId: 'c' }));
    const pick = pickPoster(g, { a: 'A', c: 'C' });
    expect(pick.chapterId).toBe('c');
    expect(pick.image).toBe('C');
    const c = g.timeline.chapters.find((x) => x.id === 'c')!;
    expect(pick.t).toBeCloseTo(c.start + c.duration * CHAPTER_THUMB_AT);
    // 바뀐 장면의 그림이 아직이면 다음 후보(첫 done 장면)의 그림.
    expect(pickPoster(g, { a: 'A', c: null }).image).toBe('A');
  });

  it('후보에 그림이 없으면 그림 없이 첫 후보 시각, 장면이 없으면 종전 35% 지점', () => {
    const g = glanceOf(doc, pass({ chapterId: 'b' }));
    expect(pickPoster(g, {})).toMatchObject({ chapterId: 'b', image: null });
    const empty = glanceOf(docWith([]), null);
    expect(pickPoster(empty, {})).toEqual({ chapterId: null, t: posterTime(empty.timeline.duration), image: null });
  });

  it('바뀐 것 한 줄: 보고 요약의 첫 줄 → 없으면 바뀐 것 줄 → 둘 다 없으면 없음', () => {
    const report = { summary: '\n  첫 줄  \n둘째 줄', suggestions: [], warnings: [], notesFixed: [], reportedAt: 1 };
    expect(changeNote({ pass: pass({ report }), lines: [] })).toEqual({ kind: 'report', text: '첫 줄' });
    expect(changeNote({ pass: pass(), lines: [{ kind: 'style', values: {} }] })).toEqual({ kind: 'lines' });
    expect(changeNote({ pass: null, lines: [] })).toBeNull();
  });
});

describe('§5.4 #36 (J) ② 훑기', () => {
  const doc = docWith([chapter('a'), chapter('b'), chapter('c')]);
  const timeline = resolveTimeline(doc);

  it('x 비율 → 시각(0~1 로 자르고 마지막 프레임 앞까지)', () => {
    expect(scrubTime(0.5, 12)).toBe(6);
    expect(scrubTime(-1, 12)).toBe(0);
    expect(scrubTime(2, 12, 30)).toBeCloseTo(12 - 1 / 30);
    expect(scrubTime(0.5, 0)).toBe(0);
  });

  it('그 시각의 장면 그림 — 없으면 가장 가까운 장면의 그림', () => {
    expect(chapterAt(timeline, 5)?.id).toBe('b');
    expect(scrubImageAt(timeline, { a: 'A', b: 'B', c: 'C' }, [], 5)).toBe('B');
    expect(scrubImageAt(timeline, { a: 'A', b: null, c: 'C' }, [], 4.5)).toBe('A');
    expect(scrubImageAt(timeline, {}, [], 5)).toBeNull();
  });

  it('장면이 없는 문서는 가장 가까운 정지 화면', () => {
    const plain = resolveTimeline(docWith([], [{ id: 'x', kind: 'shape', at: 0, duration: 12 }]));
    const times = scrubStillTimes(plain.duration, 3);
    expect(times).toEqual([2, 6, 10]);
    expect(scrubImageAt(plain, {}, ['S0', null, 'S2'], 5.5)).toBe('S0'); // 못 구운 칸은 건너뛰고 가까운 쪽
    expect(scrubImageAt(plain, {}, ['S0', 'S1', 'S2'], 6.5)).toBe('S1');
    expect(scrubImageAt(plain, {}, [null, null, null], 6)).toBeNull();
  });
});

describe('§5.4 #36 (J) ④ 바뀐 아이템 상자', () => {
  const box = { id: 'box', kind: 'shape' as const, at: 0, duration: 4, transform: { x: 960, y: 0, width: 960, height: 540 } };
  const other = { id: 'other', kind: 'shape' as const, at: 0, duration: 4, transform: { x: 0, y: 540, width: 960, height: 540 } };
  const doc = docWith([], [box, other]);
  const timeline = resolveTimeline(doc);

  it('맞춤 상자는 가운데 · 비율 그대로', () => {
    expect(containRect({ width: 240, height: 240 }, { width: 1920, height: 1080 })).toEqual({ left: 0, top: 52.5, width: 240, height: 135 });
    expect(containRect({ width: 0, height: 10 }, { width: 1, height: 1 }).width).toBe(0);
  });

  it('그 시각에 보이는 바뀐 아이템만 결과 칸 좌표로 옮긴다', () => {
    const rects = outlineRects(doc, timeline, 1, new Set(['box']), { width: 240, height: 135 });
    expect(rects).toEqual([{ left: 120, top: 0, width: 120, height: 67.5 }]);
    expect(outlineRects(doc, timeline, 1, new Set(), { width: 240, height: 135 })).toEqual([]);
    // 그 시각에 없는 아이템은 테가 없다.
    expect(outlineRects(doc, timeline, 10, new Set(['box']), { width: 240, height: 135 })).toEqual([]);
  });

  it('장면 구슬 id → 장면 id', () => {
    expect(focusChapterId('scene:intro')).toBe('intro');
    expect(focusChapterId('asset:logo')).toBeNull();
  });
});
