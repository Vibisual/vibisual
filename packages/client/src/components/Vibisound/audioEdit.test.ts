/**
 * §5.13 (R-4) — 음악 편집기의 편집 연산 테스트.
 *
 * 여기가 틀리면 화면에는 아무 표도 안 나고 **소리만 깨진다**(한 샘플 어긋난 자르기는 "딸깍"
 * 으로만 드러난다). 귀로 검수할 수 없는 부분이므로 경계값을 여기서 고정한다.
 */
import { describe, expect, it } from 'vitest';

import {
  applyFade,
  applyGain,
  clipDuration,
  computePeaks,
  cropRange,
  deleteRange,
  encodeWav,
  formatClipTime,
  type AudioClip,
} from './audioEdit.js';

/** 값이 0,1,2,… 인 모노 클립 — 어느 샘플이 남았는지 눈으로 셀 수 있다. */
function ramp(length: number, sampleRate = 10): AudioClip {
  const ch = new Float32Array(length);
  for (let i = 0; i < length; i += 1) ch[i] = i / 100;
  return { channels: [ch], sampleRate };
}

describe('cropRange', () => {
  it('선택 구간만 남긴다', () => {
    const out = cropRange(ramp(10), 0.2, 0.5); // 10Hz → 샘플 2~5
    expect(out.channels[0]?.length).toBe(3);
    expect(out.channels[0]?.[0]).toBeCloseTo(0.02);
  });

  it('시작과 끝을 거꾸로 줘도 같은 구간', () => {
    expect(cropRange(ramp(10), 0.5, 0.2).channels[0]?.length).toBe(3);
  });

  it('빈 구간이면 원본 그대로 — 빈 파일을 만들지 않는다', () => {
    const src = ramp(10);
    expect(cropRange(src, 0.3, 0.3)).toBe(src);
  });
});

describe('deleteRange', () => {
  it('구간을 지우고 앞뒤를 잇는다', () => {
    const out = deleteRange(ramp(10), 0.2, 0.5);
    expect(out.channels[0]?.length).toBe(7);
    // 지운 자리 바로 앞은 샘플 1, 그 뒤에 샘플 5 가 이어 붙는다.
    expect(out.channels[0]?.[1]).toBeCloseTo(0.01);
    expect(out.channels[0]?.[2]).toBeCloseTo(0.05);
  });

  it('전체를 지우려 하면 원본 그대로', () => {
    const src = ramp(10);
    expect(deleteRange(src, 0, 1)).toBe(src);
  });
});

describe('applyGain / applyFade', () => {
  it('이득 0 은 그 구간만 조용해지고 길이는 그대로', () => {
    const out = applyGain(ramp(10), 0.2, 0.5, 0);
    expect(out.channels[0]?.length).toBe(10);
    expect(out.channels[0]?.[3]).toBe(0);
    expect(out.channels[0]?.[6]).toBeCloseTo(0.06);
  });

  it('페이드 인은 구간 시작에서 0, 페이드 아웃은 시작에서 원래 값', () => {
    const fin = applyFade(ramp(10), 0, 1, 'in');
    expect(fin.channels[0]?.[0]).toBe(0);
    const fout = applyFade(ramp(10), 0, 1, 'out');
    expect(fout.channels[0]?.[0]).toBeCloseTo(0);
    expect(fout.channels[0]?.[9]).toBeCloseTo(0.09 * 0.1, 5);
  });
});

describe('computePeaks', () => {
  it('열마다 최소·최대 한 쌍', () => {
    const peaks = computePeaks(ramp(100), 4);
    expect(peaks.length).toBe(8);
    expect(peaks[0]).toBeCloseTo(0);
    expect(peaks[1]).toBeCloseTo(0.24);
  });

  it('빈 클립도 터지지 않는다', () => {
    expect(computePeaks({ channels: [new Float32Array(0)], sampleRate: 44100 }, 4).length).toBe(8);
  });
});

describe('encodeWav', () => {
  it('RIFF/WAVE 헤더 + 16비트 샘플', () => {
    const bytes = encodeWav({ channels: [Float32Array.from([0, 1, -1])], sampleRate: 8000 });
    const text = String.fromCharCode(...bytes.slice(0, 4));
    expect(text).toBe('RIFF');
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('WAVE');
    // 44바이트 헤더 + 3샘플 × 2바이트
    expect(bytes.length).toBe(44 + 6);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint16(22, true)).toBe(1); // 채널 수
    expect(view.getUint32(24, true)).toBe(8000); // 표본율
    expect(view.getInt16(44 + 2, true)).toBe(0x7fff); // +1.0 은 최대치로
    expect(view.getInt16(44 + 4, true)).toBe(-0x8000); // -1.0 은 최소치로
  });

  it('스테레오는 채널이 교차로 들어간다', () => {
    const bytes = encodeWav({
      channels: [Float32Array.from([1, 0]), Float32Array.from([-1, 0])],
      sampleRate: 8000,
    });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });
});

describe('clipDuration / formatClipTime', () => {
  it('길이는 샘플 수 ÷ 표본율', () => {
    expect(clipDuration(ramp(20, 10))).toBeCloseTo(2);
  });

  it('mm:ss.cc 로 적는다', () => {
    expect(formatClipTime(65.5)).toBe('01:05.50');
    expect(formatClipTime(-3)).toBe('00:00.00');
  });
});
