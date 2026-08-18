import { describe, expect, it } from 'vitest';

import { activeItems, cutPoints, itemsAt, resolveTimeline } from './resolveTimeline.js';
import type { VideoAsset, VideoDoc, VideoItem, VideoTrack } from './types.js';

function track(id: string, kind: VideoTrack['kind'], items: VideoItem[]): VideoTrack {
  return { id, kind, items };
}

function doc(tracks: VideoTrack[], assets: Record<string, VideoAsset> = {}): VideoDoc {
  return {
    schemaVersion: 1,
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

function audioAsset(id: string, duration: number): VideoAsset {
  return { id, kind: 'audio', source: { kind: 'file', path: `audio/${id}.wav` }, duration };
}

const codes = (d: ReturnType<typeof resolveTimeline>): string[] => d.diagnostics.map((x) => x.code);

describe('resolveTimeline — 시각 해소', () => {
  it('절대 시각을 그대로 쓴다', () => {
    const r = resolveTimeline(
      doc([track('v', 'visual', [{ id: 'a', kind: 'scene', at: 2, duration: 3 }])]),
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.start).toBe(2);
    expect(r.items[0]?.end).toBe(5);
    expect(r.duration).toBe(5);
  });

  it('after 앵커는 기준이 끝난 뒤로 놓는다', () => {
    const r = resolveTimeline(
      doc([
        track('v', 'visual', [
          { id: 'a', kind: 'scene', at: 0, duration: 3 },
          { id: 'b', kind: 'scene', at: { after: 'a', offset: 0.5 }, duration: 2 },
        ]),
      ]),
    );
    expect(r.items.find((i) => i.id === 'b')?.start).toBe(3.5);
    expect(r.duration).toBe(5.5);
  });

  it('start 앵커는 기준과 같이 시작한다 (음수 offset 포함)', () => {
    const r = resolveTimeline(
      doc([
        track('v', 'visual', [
          { id: 'a', kind: 'scene', at: 4, duration: 3 },
          { id: 'b', kind: 'scene', at: { start: 'a', offset: -1 }, duration: 1 },
        ]),
      ]),
    );
    expect(r.items.find((i) => i.id === 'b')?.start).toBe(3);
  });

  it('앵커 체인을 끝까지 따라간다', () => {
    const r = resolveTimeline(
      doc([
        track('v', 'visual', [
          { id: 'a', kind: 'scene', at: 1, duration: 1 },
          { id: 'b', kind: 'scene', at: { after: 'a' }, duration: 2 },
          { id: 'c', kind: 'scene', at: { after: 'b' }, duration: 3 },
        ]),
      ]),
    );
    expect(r.items.find((i) => i.id === 'c')?.start).toBe(4);
    expect(r.duration).toBe(7);
  });

  it('선언 순서가 뒤바뀌어도 앵커를 푼다', () => {
    const r = resolveTimeline(
      doc([
        track('v', 'visual', [
          { id: 'b', kind: 'scene', at: { after: 'a' }, duration: 2 },
          { id: 'a', kind: 'scene', at: 0, duration: 3 },
        ]),
      ]),
    );
    expect(r.diagnostics).toHaveLength(0);
    expect(r.items.find((i) => i.id === 'b')?.start).toBe(3);
  });
});

describe("resolveTimeline — duration 'auto' (오디오가 시간의 주인)", () => {
  it('소재의 실측 길이를 쓴다', () => {
    const r = resolveTimeline(
      doc(
        [track('a', 'audio', [{ id: 'n1', kind: 'audio', at: 0, duration: 'auto', assetId: 'v1' }])],
        { v1: audioAsset('v1', 4.25) },
      ),
    );
    expect(r.items[0]?.duration).toBe(4.25);
  });

  it('trimStart 만큼 뺀다', () => {
    const r = resolveTimeline(
      doc(
        [
          track('a', 'audio', [
            { id: 'n1', kind: 'audio', at: 0, duration: 'auto', assetId: 'v1', trimStart: 1.25 },
          ]),
        ],
        { v1: audioAsset('v1', 4.25) },
      ),
    );
    expect(r.items[0]?.duration).toBe(3);
  });

  it('TTS 길이가 씬 길이를 정한다 — 씬이 음성을 따라간다', () => {
    const r = resolveTimeline(
      doc(
        [
          track('a', 'audio', [{ id: 'vo', kind: 'audio', at: 0, duration: 'auto', assetId: 'v1' }]),
          track('v', 'visual', [
            { id: 's1', kind: 'scene', at: { start: 'vo' }, duration: 'auto', assetId: 'v1' },
          ]),
        ],
        { v1: audioAsset('v1', 6.5) },
      ),
    );
    expect(r.items.find((i) => i.id === 's1')?.duration).toBe(6.5);
    expect(r.duration).toBe(6.5);
  });

  it('자막은 큐가 덮는 구간을 길이로 삼는다', () => {
    const r = resolveTimeline(
      doc([
        track('c', 'caption', [
          {
            id: 'cap',
            kind: 'caption',
            at: 0,
            duration: 'auto',
            cues: [
              { start: 0, end: 1.5, text: '안녕하세요' },
              { start: 1.5, end: 4, text: '반갑습니다' },
            ],
          },
        ]),
      ]),
    );
    expect(r.items[0]?.duration).toBe(4);
  });

  it('참조할 소재가 없으면 오류로 빼고 이유를 남긴다', () => {
    const r = resolveTimeline(
      doc([track('v', 'visual', [{ id: 'a', kind: 'scene', at: 0, duration: 'auto' }])]),
    );
    expect(r.items).toHaveLength(0);
    expect(codes(r)).toContain('auto-without-source');
  });

  it('소재 길이가 아직 측정 안 됐으면 오류로 남긴다', () => {
    const r = resolveTimeline(
      doc([track('a', 'audio', [{ id: 'n', kind: 'audio', at: 0, duration: 'auto', assetId: 'v1' }])], {
        v1: { id: 'v1', kind: 'audio', source: { kind: 'file', path: 'audio/v1.wav' } },
      }),
    );
    expect(codes(r)).toContain('auto-without-duration');
  });

  it('없는 소재를 가리키면 오류로 남긴다', () => {
    const r = resolveTimeline(
      doc([track('a', 'audio', [{ id: 'n', kind: 'audio', at: 0, duration: 'auto', assetId: 'nope' }])]),
    );
    expect(codes(r)).toContain('unknown-asset');
  });

  it("빈 자막에 'auto' 를 쓰면 오류로 남긴다", () => {
    const r = resolveTimeline(
      doc([track('c', 'caption', [{ id: 'cap', kind: 'caption', at: 0, duration: 'auto', cues: [] }])]),
    );
    expect(codes(r)).toContain('empty-caption');
  });
});

describe('resolveTimeline — 깨진 문서에도 멈추지 않는다', () => {
  it('순환 앵커를 끊고 나머지는 그린다', () => {
    const r = resolveTimeline(
      doc([
        track('v', 'visual', [
          { id: 'a', kind: 'scene', at: { after: 'b' }, duration: 1 },
          { id: 'b', kind: 'scene', at: { after: 'a' }, duration: 1 },
          { id: 'ok', kind: 'scene', at: 0, duration: 2 },
        ]),
      ]),
    );
    expect(codes(r)).toContain('anchor-cycle');
    expect(r.items.map((i) => i.id)).toEqual(['ok']);
  });

  it('없는 아이템을 가리키면 그것만 뺀다', () => {
    const r = resolveTimeline(
      doc([
        track('v', 'visual', [
          { id: 'a', kind: 'scene', at: { after: 'ghost' }, duration: 1 },
          { id: 'b', kind: 'scene', at: 0, duration: 1 },
        ]),
      ]),
    );
    expect(codes(r)).toContain('unknown-anchor');
    expect(r.items.map((i) => i.id)).toEqual(['b']);
  });

  it('중복 id 는 뒤엣것을 버리고 알린다', () => {
    const r = resolveTimeline(
      doc([
        track('v', 'visual', [
          { id: 'dup', kind: 'scene', at: 0, duration: 1 },
          { id: 'dup', kind: 'scene', at: 5, duration: 1 },
        ]),
      ]),
    );
    expect(codes(r)).toContain('duplicate-item-id');
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.start).toBe(0);
  });

  it('음수 길이는 오류로 뺀다', () => {
    const r = resolveTimeline(
      doc([track('v', 'visual', [{ id: 'a', kind: 'scene', at: 0, duration: -2 }])]),
    );
    expect(codes(r)).toContain('negative-duration');
    expect(r.items).toHaveLength(0);
  });

  it('음수 시작은 0으로 당기되 경고를 남긴다 (조용히 자르지 않는다)', () => {
    const r = resolveTimeline(
      doc([track('v', 'visual', [{ id: 'a', kind: 'scene', at: -3, duration: 5 }])]),
    );
    expect(r.items[0]?.start).toBe(0);
    const warn = r.diagnostics.find((d) => d.code === 'negative-start');
    expect(warn?.level).toBe('warn');
  });
});

describe('resolveTimeline — 꺼 둔 아이템 (설계상 중요)', () => {
  it('꺼도 뒤에 붙은 아이템이 밀리지 않는다', () => {
    const build = (enabled: boolean): VideoDoc =>
      doc([
        track('v', 'visual', [
          { id: 'a', kind: 'scene', at: 0, duration: 3, enabled },
          { id: 'b', kind: 'scene', at: { after: 'a' }, duration: 2 },
        ]),
      ]);

    const on = resolveTimeline(build(true));
    const off = resolveTimeline(build(false));
    expect(on.items.find((i) => i.id === 'b')?.start).toBe(3);
    expect(off.items.find((i) => i.id === 'b')?.start).toBe(3);
  });

  it('꺼 둔 아이템은 전체 길이를 늘리지 않는다', () => {
    const r = resolveTimeline(
      doc([
        track('v', 'visual', [
          { id: 'a', kind: 'scene', at: 0, duration: 2 },
          { id: 'tail', kind: 'scene', at: 10, duration: 5, enabled: false },
        ]),
      ]),
    );
    expect(r.duration).toBe(2);
  });

  it('activeItems 가 꺼 둔 것과 숨긴 트랙을 걸러낸다', () => {
    const d: VideoDoc = doc([
      { id: 'v', kind: 'visual', items: [{ id: 'a', kind: 'scene', at: 0, duration: 1 }] },
      { id: 'hidden', kind: 'visual', hidden: true, items: [{ id: 'h', kind: 'scene', at: 0, duration: 1 }] },
      { id: 'v2', kind: 'visual', items: [{ id: 'off', kind: 'scene', at: 0, duration: 1, enabled: false }] },
    ]);
    const list = activeItems(d, resolveTimeline(d));
    expect(list.map((i) => i.id)).toEqual(['a']);
  });
});

describe('resolveTimeline — 정렬과 조회', () => {
  it('시작 시각 순으로 안정 정렬한다', () => {
    const r = resolveTimeline(
      doc([
        track('v1', 'visual', [{ id: 'late', kind: 'scene', at: 5, duration: 1 }]),
        track('v2', 'visual', [
          { id: 'early', kind: 'scene', at: 0, duration: 1 },
          { id: 'same', kind: 'scene', at: 5, duration: 1 },
        ]),
      ]),
    );
    expect(r.items.map((i) => i.id)).toEqual(['early', 'late', 'same']);
  });

  it('itemsAt 은 그 시각에 살아 있는 것만 준다 (끝 지점은 제외)', () => {
    const r = resolveTimeline(
      doc([
        track('v', 'visual', [
          { id: 'a', kind: 'scene', at: 0, duration: 2 },
          { id: 'b', kind: 'scene', at: 2, duration: 2 },
        ]),
      ]),
    );
    expect(itemsAt(r.items, 1).map((i) => i.id)).toEqual(['a']);
    expect(itemsAt(r.items, 2).map((i) => i.id)).toEqual(['b']);
  });

  it('cutPoints 는 화면 전환점만 준다 (오디오는 화면을 바꾸지 않는다)', () => {
    const r = resolveTimeline(
      doc([
        track('v', 'visual', [
          { id: 'a', kind: 'scene', at: 0, duration: 2 },
          { id: 'b', kind: 'scene', at: 2, duration: 3 },
        ]),
        track('a', 'audio', [{ id: 'bgm', kind: 'audio', at: 0.7, duration: 1 }]),
      ]),
    );
    expect(cutPoints(r.items)).toEqual([0, 2, 5]);
  });
});
