// §9 v3.89 — graph_snapshot 키맵 슬라이스 증분 왕복 검증.
//
// 이 최적화의 유일한 위험은 "데이터가 조용히 어긋나는 것" 이다(전송량은 줄었는데 클라가 가진 맵이
// 서버와 달라짐 = 편집 이력이 안 보이거나 지운 게 남음). 그래서 여기서는 diff → apply 를 실제
// 브로드캐스트 순서대로 이어 붙여 **매 단계 전체 맵이 서버와 일치하는지**만 본다.

import { describe, it, expect } from 'vitest';
import { diffKeyedSlice, applyKeyedSliceDelta } from '@vibisual/shared';

type Slice = Record<string, string[]>;

/** 서버(diff) ↔ 클라(apply) 한 왕복. 서버가 전체를 보내기로 하면 클라도 전체로 갈아탄다. */
function roundTrip(baseline: Slice | null, next: Slice, clientPrev: Slice): { sent: 'full' | 'delta'; client: Slice } {
  const delta = diffKeyedSlice(baseline, next);
  if (!delta) return { sent: 'full', client: next };
  return { sent: 'delta', client: applyKeyedSliceDelta(clientPrev, delta) };
}

describe('keyedSliceDelta — 증분 왕복', () => {
  it('첫 전송은 전체, 이후 바뀐 키만 간다', () => {
    const a = ['edit-a'];
    const b = ['edit-b'];
    const v1: Slice = { fileA: a, fileB: b };

    const first = roundTrip(null, v1, {});
    expect(first.sent).toBe('full');
    expect(first.client).toEqual(v1);

    // fileA 만 새 배열로 교체 — fileB 는 참조 그대로.
    const a2 = ['edit-a2', 'edit-a'];
    const v2: Slice = { fileA: a2, fileB: b };
    const delta = diffKeyedSlice(v1, v2);
    expect(delta).not.toBeNull();
    expect(Object.keys(delta!.changed)).toEqual(['fileA']);
    expect(delta!.removed).toEqual([]);
    expect(applyKeyedSliceDelta(first.client, delta!)).toEqual(v2);
  });

  it('사라진 키가 클라에서도 사라진다', () => {
    const v1: Slice = { fileA: ['x'], fileB: ['y'], fileC: ['z'] };
    const v2: Slice = { fileA: v1['fileA'] as string[], fileC: v1['fileC'] as string[] };
    const delta = diffKeyedSlice(v1, v2);
    expect(delta!.removed).toEqual(['fileB']);
    expect(applyKeyedSliceDelta(v1, delta!)).toEqual(v2);
  });

  it('연속 브로드캐스트를 이어 적용해도 서버와 일치한다', () => {
    let baseline: Slice | null = null;
    let client: Slice = {};
    let server: Slice = {};

    // 파일 30개를 하나씩 편집하는 흐름 — 매 단계 클라가 서버와 같아야 한다.
    for (let i = 0; i < 30; i++) {
      const key = `file${i % 7}`;
      server = { ...server, [key]: [`edit-${i}`, ...(server[key] ?? [])] };
      const r = roundTrip(baseline, server, client);
      client = r.client;
      baseline = server;
      expect(client).toEqual(server);
    }
  });

  it('변화가 없으면 이전 참조를 그대로 돌려준다(구독자 무자극)', () => {
    const v: Slice = { fileA: ['x'] };
    const delta = diffKeyedSlice(v, { fileA: v['fileA'] as string[] });
    expect(delta).toEqual({ changed: {}, removed: [] });
    const client: Slice = { fileA: v['fileA'] as string[] };
    expect(applyKeyedSliceDelta(client, delta!)).toBe(client);
  });

  it('절반 넘게 바뀌면 증분을 포기하고 전체를 보낸다', () => {
    const v1: Slice = { a: ['1'], b: ['2'], c: ['3'], d: ['4'] };
    const v2: Slice = { a: ['1x'], b: ['2x'], c: ['3x'], d: v1['d'] as string[] };
    expect(diffKeyedSlice(v1, v2)).toBeNull();
  });

  it('빈 맵으로 비워지는 것도 증분으로 전달된다', () => {
    const v1: Slice = { a: ['1'] };
    const delta = diffKeyedSlice(v1, {});
    expect(delta).toEqual({ changed: {}, removed: ['a'] });
    expect(applyKeyedSliceDelta(v1, delta!)).toEqual({});
  });
});
