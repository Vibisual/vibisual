import { describe, expect, it } from 'vitest';

import { chapterThumbWants } from './chapterThumbs.js';
import { docPosterTime, docPosterWant } from './docPoster.js';
import { createEmptyDoc } from './ops.js';
import { resolveTimeline } from './resolveTimeline.js';
import type { VideoDoc, VideoItem } from './types.js';

const text = (id: string, props: Record<string, unknown> = { text: 'hi' }, extra: Partial<VideoItem> = {}): VideoItem =>
  ({ id, kind: 'text', at: 0, duration: 10, props, ...extra }) as VideoItem;

function plain(title = 'Doc', overlay = 'hi'): VideoDoc {
  return { ...createEmptyDoc('d1', title), tracks: [{ id: 'v', kind: 'visual', items: [text('a', { text: overlay })] }] };
}

function chaptered(): VideoDoc {
  const base = createEmptyDoc('d2', 'Chaptered');
  return {
    ...base,
    chapters: [
      { id: 'c1', title: 'Plan', duration: 2, status: 'plan' },
      { id: 'c2', title: 'Done', duration: 2, status: 'done' },
    ],
    tracks: [{ id: 'v', kind: 'visual', items: [
      text('a', { text: 'one' }, { at: { chapter: 'c1', offset: 0 }, duration: 2, chapterId: 'c1' }),
      text('b', { text: 'two' }, { at: { chapter: 'c2', offset: 0 }, duration: 2, chapterId: 'c2' }),
    ] }],
  };
}

describe('docPosterWant — 문서 갤러리 포스터', () => {
  it('장면이 없으면 길이 35% 지점 정지 화면', () => {
    const doc = plain();
    const want = docPosterWant(doc, resolveTimeline(doc));
    expect(want?.chapterId).toBeNull();
    expect(want?.source).toEqual({ kind: 'still', t: docPosterTime(10) });
    expect(want?.key).toMatch(/^[0-9a-f]{16}$/);
  });

  it('제목만 바뀌면 열쇠가 같고, 보이는 내용이 바뀌면 달라진다', () => {
    const a = docPosterWant(plain('A'), resolveTimeline(plain('A')));
    const b = docPosterWant(plain('B'), resolveTimeline(plain('B')));
    const c = docPosterWant(plain('A', 'other'), resolveTimeline(plain('A', 'other')));
    expect(a?.key).toBe(b?.key);
    expect(a?.key).not.toBe(c?.key);
  });

  it('장면이 있으면 완성 장면의 대표 프레임 열쇠를 그대로 쓴다(스튜디오가 구운 그림 재사용)', () => {
    const doc = chaptered();
    const timeline = resolveTimeline(doc);
    const want = docPosterWant(doc, timeline);
    expect(want?.chapterId).toBe('c2');
    expect(want?.key).toBe(chapterThumbWants(doc, timeline).find((w) => w.chapterId === 'c2')?.key);
  });

  it('길이가 0 인 문서는 포스터가 없다', () => {
    const doc = createEmptyDoc('e', 'Empty');
    expect(docPosterWant(doc, resolveTimeline(doc))).toBeNull();
  });

  it('포스터 시각은 마지막 프레임 앞을 넘지 않는다', () => {
    expect(docPosterTime(0)).toBe(0);
    expect(docPosterTime(0.01)).toBe(0);
    expect(docPosterTime(100)).toBeCloseTo(35, 5);
  });
});
