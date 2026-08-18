import { describe, expect, it } from 'vitest';

import { createEmptyDoc } from './ops.js';
import { validateDoc } from './validateDoc.js';

/** 디스크에서 읽은 것처럼 JSON 왕복을 거친 값. */
function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

describe('validateDoc — 정상 문서', () => {
  it('빈 문서는 통과한다', () => {
    const r = validateDoc(roundTrip(createEmptyDoc('d', '제목', 1)));
    expect(r.ok).toBe(true);
  });

  it('아이템과 소재가 있는 문서도 통과한다', () => {
    const d = createEmptyDoc('d', '제목', 1);
    const full = {
      ...d,
      assets: { v1: { id: 'v1', kind: 'audio', source: { kind: 'file', path: 'a.wav' }, duration: 2 } },
      tracks: [
        {
          id: 'visual',
          kind: 'visual',
          items: [
            { id: 'a', kind: 'scene', at: 0, duration: 2 },
            { id: 'b', kind: 'footage', at: { after: 'a', offset: 0.5 }, duration: 'auto', assetId: 'v1' },
          ],
        },
      ],
    };
    const r = validateDoc(roundTrip(full));
    expect(r.ok).toBe(true);
  });
});

describe('validateDoc — 구조가 깨진 문서', () => {
  it('객체가 아니면 거절한다', () => {
    expect(validateDoc(null).ok).toBe(false);
    expect(validateDoc('문서').ok).toBe(false);
    expect(validateDoc([]).ok).toBe(false);
  });

  it('앱보다 높은 schemaVersion 은 거절하고 업데이트를 안내한다', () => {
    const d = { ...createEmptyDoc('d', 't', 1), schemaVersion: 99 };
    const r = validateDoc(roundTrip(d));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(' ')).toContain('업데이트');
  });

  it('알 수 없는 아이템 종류를 거절한다', () => {
    const d = createEmptyDoc('d', 't', 1);
    const broken = {
      ...d,
      tracks: [{ id: 'v', kind: 'visual', items: [{ id: 'a', kind: 'hologram', at: 0, duration: 1 }] }],
    };
    const r = validateDoc(roundTrip(broken));
    expect(r.ok).toBe(false);
  });

  it('after 와 start 를 동시에 쓴 앵커를 거절한다 (어느 쪽인지 알 수 없다)', () => {
    const d = createEmptyDoc('d', 't', 1);
    const broken = {
      ...d,
      tracks: [
        { id: 'v', kind: 'visual', items: [{ id: 'a', kind: 'scene', at: { after: 'x', start: 'y' }, duration: 1 }] },
      ],
    };
    const r = validateDoc(roundTrip(broken));
    expect(r.ok).toBe(false);
  });

  it("duration 이 숫자도 'auto' 도 아니면 거절한다", () => {
    const d = createEmptyDoc('d', 't', 1);
    const broken = {
      ...d,
      tracks: [{ id: 'v', kind: 'visual', items: [{ id: 'a', kind: 'scene', at: 0, duration: 'long' }] }],
    };
    expect(validateDoc(roundTrip(broken)).ok).toBe(false);
  });

  it('소재의 id 필드가 키와 다르면 거절한다', () => {
    const d = createEmptyDoc('d', 't', 1);
    const broken = { ...d, assets: { v1: { id: 'other', kind: 'audio', source: { kind: 'file', path: 'a.wav' } } } };
    expect(validateDoc(roundTrip(broken)).ok).toBe(false);
  });

  it('트랙 id 가 중복이면 거절한다', () => {
    const d = createEmptyDoc('d', 't', 1);
    const broken = {
      ...d,
      tracks: [
        { id: 'v', kind: 'visual', items: [] },
        { id: 'v', kind: 'audio', items: [] },
      ],
    };
    expect(validateDoc(roundTrip(broken)).ok).toBe(false);
  });

  it('오류를 첫 건에서 멈추지 않고 모아 준다', () => {
    const broken = { schemaVersion: 1, tracks: [] };
    const r = validateDoc(broken);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBeGreaterThan(2);
  });
});
