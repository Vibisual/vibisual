import { describe, expect, it } from 'vitest';

import { resolveTimeline } from '../resolveTimeline.js';
import type { VideoDoc, VideoItem, VideoTrack } from '../types.js';
import { audioItemsAt, buildDrawList, captionTextAt } from './drawList.js';
import { frameSignature, totalFrames } from './frameSignature.js';

function doc(tracks: VideoTrack[]): VideoDoc {
  return {
    schemaVersion: 1,
    id: 'd',
    title: 't',
    version: 1,
    size: { width: 1920, height: 1080 },
    fps: 30,
    tracks,
    assets: {},
    createdAt: 0,
    updatedAt: 0,
  };
}

const scene = (id: string, at: VideoItem['at'], duration: number, extra: Partial<VideoItem> = {}): VideoItem => ({
  id,
  kind: 'scene',
  at,
  duration,
  sceneId: 'title',
  ...extra,
});

describe('buildDrawList', () => {
  it('그 시각에 살아 있는 것만 뽑는다', () => {
    const d = doc([{ id: 'v', kind: 'visual', items: [scene('a', 0, 2), scene('b', 2, 2)] }]);
    const ops = buildDrawList(d, resolveTimeline(d), 1);
    expect(ops.map((o) => o.itemId)).toEqual(['a']);
  });

  it('지역 시간과 진행률을 준다', () => {
    const d = doc([{ id: 'v', kind: 'visual', items: [scene('a', 4, 8)] }]);
    const ops = buildDrawList(d, resolveTimeline(d), 6);
    expect(ops[0]?.localTime).toBe(2);
    expect(ops[0]?.progress).toBeCloseTo(0.25);
  });

  it('트랙 순서가 곧 앞뒤다', () => {
    const d = doc([
      { id: 'back', kind: 'visual', items: [scene('bg', 0, 5)] },
      { id: 'front', kind: 'visual', items: [scene('fg', 0, 5)] },
    ]);
    const ops = buildDrawList(d, resolveTimeline(d), 1);
    expect(ops.map((o) => o.itemId)).toEqual(['bg', 'fg']);
    expect(ops[0]?.z).toBeLessThan(ops[1]?.z ?? 0);
  });

  it('오디오는 그릴 것이 없으므로 목록에서 빠진다', () => {
    const d = doc([
      { id: 'v', kind: 'visual', items: [scene('a', 0, 5)] },
      { id: 'a', kind: 'audio', items: [{ id: 'vo', kind: 'audio', at: 0, duration: 5 }] },
    ]);
    expect(buildDrawList(d, resolveTimeline(d), 1).map((o) => o.itemId)).toEqual(['a']);
  });

  it('꺼 둔 아이템과 숨긴 트랙은 그리지 않는다', () => {
    const d = doc([
      { id: 'v', kind: 'visual', items: [scene('a', 0, 5, { enabled: false })] },
      { id: 'h', kind: 'visual', hidden: true, items: [scene('b', 0, 5)] },
      { id: 'ok', kind: 'visual', items: [scene('c', 0, 5)] },
    ]);
    expect(buildDrawList(d, resolveTimeline(d), 1).map((o) => o.itemId)).toEqual(['c']);
  });

  it('트림을 반영한 소재 시각을 준다', () => {
    const d = doc([
      { id: 'v', kind: 'visual', items: [{ id: 'f', kind: 'footage', at: 10, duration: 5, trimStart: 3 }] },
    ]);
    const ops = buildDrawList(d, resolveTimeline(d), 12);
    expect(ops[0]?.sourceTime).toBe(5); // 트림 3 + 지역 2
  });

  it('기본 배치는 화면 전체다', () => {
    const d = doc([{ id: 'v', kind: 'visual', items: [scene('a', 0, 2)] }]);
    const t = buildDrawList(d, resolveTimeline(d), 1)[0]?.transform;
    expect(t).toMatchObject({ x: 0, y: 0, width: 1920, height: 1080, opacity: 1, scale: 1 });
  });
});

describe('자막', () => {
  const d = doc([
    {
      id: 'c',
      kind: 'caption',
      items: [
        {
          id: 'cap',
          kind: 'caption',
          at: 0,
          duration: 6,
          cues: [
            { start: 0, end: 2, text: '첫 줄' },
            { start: 2, end: 4, text: '둘째 줄' },
          ],
        },
      ],
    },
  ]);

  it('그 시각의 큐만 준다', () => {
    const ops = buildDrawList(d, resolveTimeline(d), 1);
    expect(ops[0]?.cues.map((c) => c.text)).toEqual(['첫 줄']);
  });

  it('큐 사이 빈 구간에는 자막이 없다', () => {
    expect(captionTextAt(buildDrawList(d, resolveTimeline(d), 5))).toBe('');
  });

  it('captionTextAt 이 지금 보이는 글자를 모은다', () => {
    expect(captionTextAt(buildDrawList(d, resolveTimeline(d), 3))).toBe('둘째 줄');
  });
});

describe('audioItemsAt', () => {
  it('음소거 트랙은 빼고 오디오만 준다', () => {
    const d = doc([
      { id: 'v', kind: 'visual', items: [scene('a', 0, 5)] },
      { id: 'a1', kind: 'audio', items: [{ id: 'vo', kind: 'audio', at: 0, duration: 5 }] },
      { id: 'a2', kind: 'audio', muted: true, items: [{ id: 'bgm', kind: 'audio', at: 0, duration: 5 }] },
    ]);
    expect(audioItemsAt(d, resolveTimeline(d)).map((i) => i.id)).toEqual(['vo']);
  });
});

describe('frameSignature — 부분 렌더의 정확도', () => {
  const build = (text: string): VideoDoc =>
    doc([{ id: 'v', kind: 'visual', items: [scene('a', 0, 4, { props: { title: text } })] }]);

  it('같은 프레임이면 같은 지문', () => {
    const d = build('안녕');
    expect(frameSignature(d, resolveTimeline(d), 1, 30)).toBe(frameSignature(d, resolveTimeline(d), 1, 30));
  });

  it('내용이 바뀌면 지문이 바뀐다 — 낡은 프레임을 재사용하지 않는다', () => {
    const a = build('안녕');
    const b = build('반가워');
    expect(frameSignature(a, resolveTimeline(a), 1, 30)).not.toBe(frameSignature(b, resolveTimeline(b), 1, 30));
  });

  it('같은 아이템이라도 지역 프레임이 다르면 지문이 다르다', () => {
    const d = build('안녕');
    const tl = resolveTimeline(d);
    expect(frameSignature(d, tl, 1, 30)).not.toBe(frameSignature(d, tl, 2, 30));
  });

  it('아이템을 통째로 뒤로 밀어도 같은 지역 프레임이면 지문이 같다 (캐시가 산다)', () => {
    const early = doc([{ id: 'v', kind: 'visual', items: [scene('a', 0, 4, { props: { title: 'x' } })] }]);
    const late = doc([{ id: 'v', kind: 'visual', items: [scene('a', 10, 4, { props: { title: 'x' } })] }]);
    expect(frameSignature(early, resolveTimeline(early), 1, 30)).toBe(
      frameSignature(late, resolveTimeline(late), 11, 30),
    );
  });

  it('빈 화면도 지문을 갖는다', () => {
    const d = doc([{ id: 'v', kind: 'visual', items: [] }]);
    expect(frameSignature(d, resolveTimeline(d), 0, 30)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('totalFrames', () => {
  it('마지막 프레임을 잃지 않도록 올림한다', () => {
    expect(totalFrames(1.01, 30)).toBe(31);
  });
  it('길이가 0이면 0', () => {
    expect(totalFrames(0, 30)).toBe(0);
  });
});
