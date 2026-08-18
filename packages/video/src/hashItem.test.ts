import { describe, expect, it } from 'vitest';

import { hashDocShape, hashItem, stableHash } from './hashItem.js';
import type { VideoAsset, VideoItem } from './types.js';

const asset = (over: Partial<VideoAsset> = {}): Record<string, VideoAsset> => ({
  v1: {
    id: 'v1',
    kind: 'audio',
    source: { kind: 'file', path: 'audio/v1.wav' },
    duration: 3,
    contentHash: 'aaa',
    ...over,
  },
});

const item = (over: Partial<VideoItem> = {}): VideoItem => ({
  id: 'a',
  kind: 'scene',
  at: 0,
  duration: 2,
  sceneId: 'Intro',
  props: { title: '안녕', color: '#fff' },
  ...over,
});

describe('stableHash', () => {
  it('같은 입력이면 같은 값', () => {
    expect(stableHash('hello')).toBe(stableHash('hello'));
  });

  it('다른 입력이면 다른 값', () => {
    expect(stableHash('hello')).not.toBe(stableHash('hellp'));
  });

  it('64비트 16진수 문자열이다', () => {
    expect(stableHash('x')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('hashItem — 무엇이 캐시를 무효로 만드는가', () => {
  it('props 키 순서가 달라도 같은 해시', () => {
    const a = hashItem(item({ props: { x: 1, y: 2 } }), {}, 2);
    const b = hashItem(item({ props: { y: 2, x: 1 } }), {}, 2);
    expect(a).toBe(b);
  });

  it('없는 필드와 undefined 를 같게 본다', () => {
    const a = hashItem(item({ trimStart: undefined }), {}, 2);
    const b = hashItem(item(), {}, 2);
    expect(a).toBe(b);
  });

  it('props 가 바뀌면 해시가 바뀐다', () => {
    const a = hashItem(item({ props: { title: '안녕' } }), {}, 2);
    const b = hashItem(item({ props: { title: '반가워' } }), {}, 2);
    expect(a).not.toBe(b);
  });

  it('길이가 바뀌면 해시가 바뀐다 (진행률 기반 애니메이션이 달라지므로)', () => {
    expect(hashItem(item(), {}, 2)).not.toBe(hashItem(item(), {}, 3));
  });

  it('시작 시각은 해시에 영향이 없다 (뒤로 밀어도 그림은 같다)', () => {
    const a = hashItem(item({ at: 0 }), {}, 2);
    const b = hashItem(item({ at: 12.5 }), {}, 2);
    expect(a).toBe(b);
  });

  it('소재 내용이 바뀌면 해시가 바뀐다 — 경로가 같아도', () => {
    const it1 = item({ kind: 'footage', assetId: 'v1' });
    const a = hashItem(it1, asset({ contentHash: 'aaa' }), 2);
    const b = hashItem(it1, asset({ contentHash: 'bbb' }), 2);
    expect(a).not.toBe(b);
  });

  it('트림이 바뀌면 해시가 바뀐다', () => {
    const a = hashItem(item({ assetId: 'v1', trimStart: 0 }), asset(), 2);
    const b = hashItem(item({ assetId: 'v1', trimStart: 1 }), asset(), 2);
    expect(a).not.toBe(b);
  });

  it('자막 큐가 바뀌면 해시가 바뀐다', () => {
    const a = hashItem(item({ kind: 'caption', cues: [{ start: 0, end: 1, text: 'a' }] }), {}, 1);
    const b = hashItem(item({ kind: 'caption', cues: [{ start: 0, end: 1, text: 'b' }] }), {}, 1);
    expect(a).not.toBe(b);
  });
});

describe('hashDocShape', () => {
  it('해상도가 바뀌면 문서 해시가 바뀐다', () => {
    const a = hashDocShape({ width: 1920, height: 1080 }, 30, ['x']);
    const b = hashDocShape({ width: 1280, height: 720 }, 30, ['x']);
    expect(a).not.toBe(b);
  });

  it('fps 가 바뀌면 문서 해시가 바뀐다', () => {
    expect(hashDocShape({ width: 1920, height: 1080 }, 30, ['x'])).not.toBe(
      hashDocShape({ width: 1920, height: 1080 }, 60, ['x']),
    );
  });

  it('아이템 순서는 문서 해시에 영향이 없다', () => {
    const a = hashDocShape({ width: 1920, height: 1080 }, 30, ['x', 'y']);
    const b = hashDocShape({ width: 1920, height: 1080 }, 30, ['y', 'x']);
    expect(a).toBe(b);
  });
});
