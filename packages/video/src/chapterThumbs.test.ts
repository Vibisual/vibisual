import { describe, expect, it } from 'vitest';

import { chapterThumbWants } from './chapterThumbs.js';
import { createEmptyDoc } from './ops.js';
import { resolveTimeline } from './resolveTimeline.js';
import type { VideoDoc, VideoItem } from './types.js';

/** 장면 둘(각 2초)과 장면에 묶이지 않은 덧그림(전체 구간) 하나. */
function sample(overlayText = 'logo', secondText = 'second'): VideoDoc {
  const base = createEmptyDoc('d1', 'Doc');
  const first: VideoItem = { id: 'a', kind: 'text', at: { chapter: 'c1', offset: 0 }, duration: 2, chapterId: 'c1', props: { text: 'first' } };
  const second: VideoItem = { id: 'b', kind: 'text', at: { chapter: 'c2', offset: 0 }, duration: 2, chapterId: 'c2', props: { text: secondText } };
  const overlay: VideoItem = { id: 'o', kind: 'text', at: 0, duration: 4, props: { text: overlayText } };
  return {
    ...base,
    chapters: [
      { id: 'c1', title: 'One', duration: 2, status: 'done' },
      { id: 'c2', title: 'Two', duration: 2, status: 'done' },
      { id: 'c3', title: 'Empty', duration: 2, status: 'done' },
    ],
    tracks: [
      { id: 'v', kind: 'visual', items: [first, second] },
      { id: 'top', kind: 'visual', items: [overlay] },
    ],
  };
}

function wants(doc: VideoDoc) {
  return chapterThumbWants(doc, resolveTimeline(doc));
}

describe('§5.13 (X) 39-4 장면 대표 프레임 열쇠', () => {
  it('그릴 것이 묶인 장면만 · 장면 40% 지점 · 파일 이름으로 쓸 수 있는 열쇠', () => {
    const list = wants(sample());
    expect(list.map((w) => w.chapterId)).toEqual(['c1', 'c2']);
    expect(list[0]?.source).toEqual({ kind: 'still', t: 0.8 });
    expect(list[1]?.source).toEqual({ kind: 'still', t: 2.8 });
    for (const w of list) expect(w.key).toMatch(/^[0-9a-f]{16}$/);
  });

  it('다른 장면만 바뀌면 그 장면의 열쇠는 그대로다(디스크 그림을 다시 쓴다)', () => {
    const before = wants(sample());
    const after = wants(sample('logo', 'changed'));
    expect(after[0]?.key).toBe(before[0]?.key);
    expect(after[1]?.key).not.toBe(before[1]?.key);
  });

  it('장면에 묶이지 않은 덧그림이 바뀌면 그 시각의 열쇠도 바뀐다(낡은 그림이 남지 않게)', () => {
    const before = wants(sample('logo'));
    const after = wants(sample('new logo'));
    expect(after[0]?.key).not.toBe(before[0]?.key);
    expect(after[1]?.key).not.toBe(before[1]?.key);
  });

  it('그림 크기가 다르면 다른 열쇠다', () => {
    const doc = sample();
    const timeline = resolveTimeline(doc);
    expect(chapterThumbWants(doc, timeline, 320)[0]?.key).not.toBe(chapterThumbWants(doc, timeline, 640)[0]?.key);
  });
});
