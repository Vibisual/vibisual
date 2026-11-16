import { describe, expect, it } from 'vitest';

import { RENDER_SEGMENT_KEY_RE, RENDER_SEGMENT_SECONDS } from '../constants.js';
import { resolveTimeline } from '../resolveTimeline.js';
import type { VideoDoc, VideoItem, VideoTrack } from '../types.js';
import {
  canHashSegments,
  planSegments,
  segmentDescriptors,
  segmentFrameCount,
  segmentKeys,
  sha256Hex,
  type SegmentEncodeKey,
  type SegmentEnv,
  type SegmentKeyInput,
} from './segments.js';

function doc(tracks: VideoTrack[], extra: Partial<VideoDoc> = {}): VideoDoc {
  return {
    schemaVersion: 1, id: 'd', title: 't', version: 1, size: { width: 1920, height: 1080 }, fps: 30,
    tracks, assets: {}, createdAt: 0, updatedAt: 0, ...extra,
  };
}

const text = (id: string, at: number, duration: number, label: string, extra: Partial<VideoItem> = {}): VideoItem => ({
  id, kind: 'text', at, duration, props: { text: label }, ...extra,
});

const ENCODE: SegmentEncodeKey = { container: 'mp4', codec: 'avc', quality: 'high', width: 1920, height: 1080, fps: 30, alpha: false, decoder: 'dec-a' };
const ENV: SegmentEnv = { engine: 'engine-1', files: {}, shared: '' };

function input(d: VideoDoc, over: Partial<SegmentKeyInput> = {}): SegmentKeyInput {
  const timeline = resolveTimeline(d);
  const fps = over.fps ?? d.fps;
  const start = over.start ?? 0;
  return {
    doc: d, timeline, start, fps,
    spans: planSegments(Math.ceil((timeline.duration - start) * fps - 1e-6), fps),
    backend: 'canvas2d', encode: ENCODE, env: ENV, ...over,
  };
}

/** 2초 장면 네 개(구간 격자에 맞게). */
function fourScenes(labels: readonly string[] = ['one', 'two', 'three', 'four']): VideoDoc {
  return doc([{ id: 'v', kind: 'visual', items: labels.map((label, i) => text(`s${i}`, i * 2, 2, label)) }]);
}

function changed(a: readonly string[], b: readonly string[]): number[] {
  expect(a.length).toBe(b.length);
  return a.flatMap((key, i) => (key === b[i] ? [] : [i]));
}

describe('planSegments — (E-1) 2초 닫힌 GOP 단위', () => {
  it('구간 프레임 수는 2초 × fps 를 반올림한 값이다', () => {
    expect(segmentFrameCount(30)).toBe(60);
    expect(segmentFrameCount(24)).toBe(48);
    expect(segmentFrameCount(29.97)).toBe(60);
    expect(segmentFrameCount(0.1)).toBe(1);
  });

  it('구간의 마지막 프레임 시각은 늘 구간 길이 안쪽이다(키프레임이 첫 프레임 하나)', () => {
    for (const fps of [1, 12, 23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 120]) {
      expect((segmentFrameCount(fps) - 1) / fps).toBeLessThan(RENDER_SEGMENT_SECONDS);
    }
  });

  it('빈틈·겹침 없이 전체 프레임을 덮고 마지막 구간만 짧다', () => {
    const spans = planSegments(150, 30);
    expect(spans).toEqual([
      { index: 0, firstFrame: 0, frames: 60 },
      { index: 1, firstFrame: 60, frames: 60 },
      { index: 2, firstFrame: 120, frames: 30 },
    ]);
    expect(planSegments(0, 30)).toEqual([]);
    expect(planSegments(60, 30)).toHaveLength(1);
    expect(planSegments(61, 30).map((s) => s.frames)).toEqual([60, 1]);
  });
});

describe('sha256Hex — 엔진 네이티브 해시', () => {
  it('알려진 값과 같다', async () => {
    expect(canHashSegments()).toBe(true);
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('한글도 UTF-8 바이트로 접는다', async () => {
    expect(await sha256Hex('구간')).toBe(await sha256Hex('구간'));
    expect(await sha256Hex('구간')).not.toBe(await sha256Hex('구간 '));
  });
});

describe('segmentKeys — (E-2) 그 구간에 그려지는 것 전부', () => {
  it('같은 문서는 같은 열쇠(파일 이름 모양)를 낸다', async () => {
    const a = await segmentKeys(input(fourScenes()));
    const b = await segmentKeys(input(fourScenes()));
    expect(a).toEqual(b);
    expect(a).toHaveLength(4);
    for (const key of a) expect(key).toMatch(RENDER_SEGMENT_KEY_RE);
    expect(new Set(a).size).toBe(4);
  });

  it('한 장면만 고치면 그 구간의 열쇠만 바뀐다', async () => {
    const before = await segmentKeys(input(fourScenes()));
    const after = await segmentKeys(input(fourScenes(['one', 'two', 'THREE', 'four'])));
    expect(changed(before, after)).toEqual([2]);
  });

  it('두 구간에 걸친 아이템을 고치면 걸친 구간이 모두 바뀐다', async () => {
    const make = (label: string): VideoDoc => doc([
      { id: 'v', kind: 'visual', items: [text('a', 0, 8, 'base')] },
      { id: 'o', kind: 'visual', items: [text('over', 3, 2, label)] },
    ]);
    expect(changed(await segmentKeys(input(make('x'))), await segmentKeys(input(make('y'))))).toEqual([1, 2]);
  });

  it('그림에 닿지 않는 칸(제목·판 번호·수정 시각·소리 트랙)은 열쇠를 바꾸지 않는다', async () => {
    const base = fourScenes();
    const before = await segmentKeys(input(base));
    const retitled: VideoDoc = { ...base, title: 'renamed', version: 9, updatedAt: 123 };
    expect(await segmentKeys(input(retitled))).toEqual(before);
    const withAudio: VideoDoc = { ...base, tracks: [...base.tracks, { id: 'a', kind: 'audio', items: [{ id: 'vo', kind: 'audio', at: 0, duration: 8 }] }] };
    expect(await segmentKeys(input(withAudio))).toEqual(before);
  });

  it('문서 전역(시드·모르는 새 칸)이 바뀌면 전부 바뀐다', async () => {
    const base = fourScenes();
    const before = await segmentKeys(input(base));
    expect(changed(before, await segmentKeys(input({ ...base, seed: 7 } as VideoDoc)))).toEqual([0, 1, 2, 3]);
    expect(changed(before, await segmentKeys(input({ ...base, futureField: 1 } as unknown as VideoDoc)))).toEqual([0, 1, 2, 3]);
  });

  it('백엔드·엔진 판·인코딩 설정·디코더 지문·공유 파일 지문이 바뀌면 전부 바뀐다', async () => {
    const d = fourScenes();
    const before = await segmentKeys(input(d));
    const all = [0, 1, 2, 3];
    expect(changed(before, await segmentKeys(input(d, { backend: 'offscreen-capture' })))).toEqual(all);
    expect(changed(before, await segmentKeys(input(d, { env: { ...ENV, engine: 'engine-2' } })))).toEqual(all);
    expect(changed(before, await segmentKeys(input(d, { env: { ...ENV, shared: 'fonts-v2' } })))).toEqual(all);
    expect(changed(before, await segmentKeys(input(d, { encode: { ...ENCODE, quality: 'medium' } })))).toEqual(all);
    expect(changed(before, await segmentKeys(input(d, { encode: { ...ENCODE, decoder: 'dec-b' } })))).toEqual(all);
    expect(changed(before, await segmentKeys(input(d, { encode: { ...ENCODE, width: 1280, height: 720 } })))).toEqual(all);
    expect(changed(before, await segmentKeys(input(d, { encode: { ...ENCODE, alpha: true, container: 'webm' } })))).toEqual(all);
  });

  it('통째로 한 구간만큼 민 아이템은 민 자리에서 같은 열쇠다(시작 시각은 열쇠에 없다)', async () => {
    const early = doc([{ id: 'v', kind: 'visual', items: [text('a', 0, 2, 'same')] }]);
    const late = doc([{ id: 'v', kind: 'visual', items: [text('pad', 0, 2, 'pad'), text('a', 2, 2, 'same')] }]);
    const [first] = await segmentKeys(input(early));
    const [, second] = await segmentKeys(input(late));
    expect(second).toBe(first);
  });

  it('구간 격자에서 어긋나게 밀면 다른 열쇠다(프레임마다 아이템 안 시각이 다르다)', async () => {
    const early = doc([{ id: 'v', kind: 'visual', items: [text('a', 0, 4, 'same')] }]);
    const late = doc([{ id: 'v', kind: 'visual', items: [text('a', 0.5, 4, 'same')] }]);
    expect((await segmentKeys(input(early)))[0]).not.toBe((await segmentKeys(input(late)))[0]);
  });

  it('소재 파일 지문이 바뀌면 그 소재를 쓰는 구간만 바뀐다', async () => {
    const d = doc(
      [{ id: 'v', kind: 'visual', items: [text('t', 0, 2, 'plain'), { id: 'img', kind: 'image', at: 2, duration: 2, assetId: 'pic' }] }],
      { assets: { pic: { id: 'pic', kind: 'image', source: { kind: 'file', path: 'a.png' } } } },
    );
    const before = await segmentKeys(input(d, { env: { ...ENV, files: { pic: '10:1' } } }));
    const after = await segmentKeys(input(d, { env: { ...ENV, files: { pic: '10:2' } } }));
    expect(changed(before, after)).toEqual([1]);
  });

  it('소재 선언(내용 해시)이 바뀌어도 그 소재를 쓰는 구간만 바뀐다', async () => {
    const make = (hash: string): VideoDoc => doc(
      [{ id: 'v', kind: 'visual', items: [text('t', 0, 2, 'plain'), { id: 'img', kind: 'image', at: 2, duration: 2, assetId: 'pic' }] }],
      { assets: { pic: { id: 'pic', kind: 'image', source: { kind: 'file', path: 'a.png' }, contentHash: hash } } },
    );
    expect(changed(await segmentKeys(input(make('h1'))), await segmentKeys(input(make('h2'))))).toEqual([1]);
  });

  it('자막은 그 구간에 보이는 큐만 든다 — 다른 구간의 큐를 고쳐도 그대로다', async () => {
    const make = (late: string): VideoDoc => doc([
      { id: 'v', kind: 'visual', items: [text('a', 0, 6, 'base')] },
      { id: 'c', kind: 'caption', items: [{ id: 'cap', kind: 'caption', at: 0, duration: 6, cues: [{ start: 0.2, end: 1.5, text: 'first' }, { start: 4.2, end: 5.5, text: late }] }] },
    ]);
    expect(changed(await segmentKeys(input(make('second'))), await segmentKeys(input(make('edited'))))).toEqual([2]);
  });

  it('구간 렌더는 구간 시작부터 자른다 — 같은 그림이면 전체 렌더의 그 구간과 같은 열쇠', async () => {
    const d = fourScenes();
    const whole = await segmentKeys(input(d));
    const ranged = await segmentKeys(input(d, { start: 4 }));
    expect(ranged).toHaveLength(2);
    // 시작 시각이 열쇠에 없으니 4초부터 자른 첫 구간은 전체 렌더의 세 번째 구간과 같다.
    expect(ranged).toEqual(whole.slice(2));
  });

  it('서술은 구간마다 프레임 수만큼의 줄을 싣는다', () => {
    const [first, , , last] = segmentDescriptors(input(fourScenes()));
    expect(first?.split('\n').filter((line) => line.startsWith('[') || line.startsWith('{"id"')).length).toBeGreaterThan(0);
    expect(first).toContain('frames=60');
    expect(first).toContain('"one"');
    expect(first).not.toContain('"two"');
    expect(last).toContain('"four"');
  });
});
