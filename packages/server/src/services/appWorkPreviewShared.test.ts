import { describe, expect, it } from 'vitest';
import { pickWorkPreview, withWorkPreview } from '@vibisual/shared';

describe('§5.4 #36 (L) — 작업 중 미리보기 판정', () => {
  it('종류마다 가장 최근 한 건만 남기고, 더 새롭지 않으면 같은 객체를 돌려준다', () => {
    const first = withWorkPreview(undefined, 'image', 'a.png', 10);
    expect(first).toEqual({ image: { file: 'a.png', at: 10 } });
    expect(withWorkPreview(first, 'image', 'b.png', 10)).toBe(first);
    expect(withWorkPreview(first, 'image', 'b.png', 9)).toBe(first);
    expect(withWorkPreview(first, 'image', 'b.png', 11)).toEqual({ image: { file: 'b.png', at: 11 } });
    expect(withWorkPreview(first, 'video', 'c.mp4', 1)).toEqual({ image: { file: 'a.png', at: 10 }, video: { file: 'c.mp4', at: 1 } });
  });

  it('화면은 그림·영상·3D 중 가장 새 것을 고르고, 그것이 없을 때만 소리를 고른다', () => {
    const image = { file: 'a.png', at: 10 };
    const video = { file: 'c0001.mp4', at: 20 };
    const audio = { file: 'voice.flac', at: 30 };
    expect(pickWorkPreview({ image, video, audio }, 'video')).toEqual(video);
    expect(pickWorkPreview({ image, audio }, 'video')).toEqual(image);
    expect(pickWorkPreview({ audio }, 'video')).toEqual(audio);
    expect(pickWorkPreview(undefined, 'video')).toBeNull();
    expect(pickWorkPreview({}, 'video')).toBeNull();
  });

  it('소리 앱은 더 새 그림이 있어도 소리를 먼저 비춘다', () => {
    const image = { file: 'cover.png', at: 50 };
    const audio = { file: 'mix.wav', at: 10 };
    expect(pickWorkPreview({ image, audio }, 'audio')).toEqual(audio);
    expect(pickWorkPreview({ image }, 'audio')).toEqual(image);
  });
});
