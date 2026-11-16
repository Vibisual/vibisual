import { describe, expect, it } from 'vitest';

import { decoderConfigFromText, decoderConfigText, packSegment, segmentProblem, unpackSegment, type EncodedSegment } from './segmentPack.js';

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

function segment(over: Partial<EncodedSegment> = {}): EncodedSegment {
  return {
    frames: 3,
    decoder: 'dec',
    packets: [
      { frame: 0, key: true, data: bytes(1, 2, 3), alpha: null },
      { frame: 1, key: false, data: bytes(4), alpha: bytes(9, 9) },
      { frame: 2, key: false, data: bytes(5, 6), alpha: new Uint8Array(0) },
    ],
    ...over,
  };
}

describe('packSegment / unpackSegment — (E-9) 조각 본문', () => {
  it('묶었다 풀면 같은 구간이다(알파 곁 데이터·빈 알파 포함)', () => {
    const back = unpackSegment(packSegment(segment()));
    expect(back).not.toBeNull();
    expect(back?.frames).toBe(3);
    expect(back?.decoder).toBe('dec');
    expect(back?.packets.map((p) => [p.frame, p.key, [...p.data], p.alpha === null ? null : [...p.alpha]])).toEqual([
      [0, true, [1, 2, 3], null],
      [1, false, [4], [9, 9]],
      [2, false, [5, 6], []],
    ]);
  });

  it('같은 구간은 같은 바이트로 묶인다', () => {
    expect([...packSegment(segment())]).toEqual([...packSegment(segment())]);
  });

  it('잘렸거나 남는 바이트가 있거나 머리가 깨졌으면 null', () => {
    const packed = packSegment(segment());
    expect(unpackSegment(packed.subarray(0, packed.byteLength - 1))).toBeNull();
    expect(unpackSegment(new Uint8Array([...packed, 0]))).toBeNull();
    expect(unpackSegment(new Uint8Array(0))).toBeNull();
    expect(unpackSegment(bytes(1, 2))).toBeNull();
    const broken = new Uint8Array(packed);
    broken[4] = 0x7d; // 머리 글의 첫 글자를 깨뜨린다.
    expect(unpackSegment(broken)).toBeNull();
    const huge = new Uint8Array(packed);
    new DataView(huge.buffer).setUint32(0, 0xffffffff, true);
    expect(unpackSegment(huge)).toBeNull();
  });

  it('다른 바이트 위치의 뷰에서도 풀린다', () => {
    const packed = packSegment(segment());
    const padded = new Uint8Array(packed.byteLength + 7);
    padded.set(packed, 7);
    expect(unpackSegment(padded.subarray(7))?.packets).toHaveLength(3);
  });
});

describe('segmentProblem — (E-5) 이을 수 있는가', () => {
  it('온전한 구간은 문제없다', () => {
    expect(segmentProblem(segment(), 3, 'dec')).toBeNull();
  });

  it('프레임 수·디코더 설정이 다르면 못 잇는다', () => {
    expect(segmentProblem(segment(), 4, 'dec')).toBe('frames');
    expect(segmentProblem(segment(), 3, 'other')).toBe('decoder');
  });

  it('첫 패킷이 키프레임이 아니거나 구간 첫 프레임이 아니면 못 잇는다', () => {
    expect(segmentProblem(segment({ packets: [] }), 3, 'dec')).toBe('empty');
    expect(segmentProblem(segment({ packets: [{ frame: 0, key: false, data: bytes(1), alpha: null }] }), 3, 'dec')).toBe('keyframe');
    expect(segmentProblem(segment({ packets: [{ frame: 1, key: true, data: bytes(1), alpha: null }] }), 3, 'dec')).toBe('keyframe');
  });

  it('프레임 번호가 구간 밖이거나 겹치거나 빈 패킷이면 못 잇는다', () => {
    const key = { frame: 0, key: true, data: bytes(1), alpha: null };
    expect(segmentProblem(segment({ packets: [key, { frame: 3, key: false, data: bytes(1), alpha: null }] }), 3, 'dec')).toBe('packets');
    expect(segmentProblem(segment({ packets: [key, { ...key, key: false }] }), 3, 'dec')).toBe('packets');
    expect(segmentProblem(segment({ packets: [key, { frame: 1, key: false, data: new Uint8Array(0), alpha: null }] }), 3, 'dec')).toBe('packets');
  });

  it('인코더가 떨군 프레임은 허용한다(한 번에 구워도 빈다)', () => {
    const packets = [{ frame: 0, key: true, data: bytes(1), alpha: null }, { frame: 2, key: false, data: bytes(2), alpha: null }];
    expect(segmentProblem(segment({ packets }), 3, 'dec')).toBeNull();
  });
});

describe('decoderConfigText — (E-8) 디코더 설정 지문', () => {
  it('칸 순서가 달라도 같은 글이고, 서술 바이트가 다르면 다른 글이다', () => {
    const a = decoderConfigText({ codec: 'avc1.640028', codedWidth: 1920, codedHeight: 1080, description: bytes(1, 100, 0, 40) });
    const b = decoderConfigText({ description: bytes(1, 100, 0, 40), codedHeight: 1080, codedWidth: 1920, codec: 'avc1.640028' });
    expect(a).toBe(b);
    expect(decoderConfigText({ codec: 'avc1.640028', codedWidth: 1920, codedHeight: 1080, description: bytes(1, 100, 0, 41) })).not.toBe(a);
  });

  it('ArrayBuffer·다른 뷰의 서술도 같은 바이트면 같은 글이다', () => {
    const view = bytes(0, 7, 8, 9).subarray(1);
    expect(decoderConfigText({ codec: 'c', description: view })).toBe(decoderConfigText({ codec: 'c', description: bytes(7, 8, 9).buffer }));
  });

  it('`toJSON` 을 가진 엔진 객체(색 공간)는 편 값으로 적는다', () => {
    const colorSpace = { toJSON: () => ({ primaries: 'bt709', fullRange: false }) };
    expect(decoderConfigText({ codec: 'vp09', colorSpace })).toContain('"primaries":"bt709"');
  });

  it('글에서 설정을 되살린다(서술 바이트 포함)', () => {
    const text = decoderConfigText({ codec: 'avc1.640028', codedWidth: 1920, codedHeight: 1080, description: bytes(1, 100, 0, 40), colorSpace: { primaries: 'bt709' } });
    const back = decoderConfigFromText(text);
    expect(back).toMatchObject({ codec: 'avc1.640028', codedWidth: 1920, codedHeight: 1080, colorSpace: { primaries: 'bt709' } });
    expect([...(back?.['description'] as Uint8Array)]).toEqual([1, 100, 0, 40]);
    expect(decoderConfigText(back ?? {})).toBe(text);
  });

  it('글이 아니거나 코덱이 없으면 null', () => {
    expect(decoderConfigFromText('not json')).toBeNull();
    expect(decoderConfigFromText('[]')).toBeNull();
    expect(decoderConfigFromText('{"codedWidth":1}')).toBeNull();
    expect(decoderConfigFromText('{"codec":"c","description":{"hex":"zz"}}')).toBeNull();
  });
});
