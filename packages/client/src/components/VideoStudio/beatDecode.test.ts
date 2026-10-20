import { describe, expect, it } from 'vitest';
import { analyzeBeats } from '@vibisual/video';

import { BEAT_ANALYSIS_RATE, bpmRangeFor, downsampleMonoInto, usableBpmTag } from './beatDecode.js';

/**
 * §5.13 (Y) 40-2 ⑦ — 비트 재기용 내려 담기. 디코더 조각을 한 갈래 · 11.025kHz 판의 그 시각 자리에 상자 평균으로 담는다(곡을 통째로
 * 풀지 않는다 — 3분 곡 약 7.6MB). 조각을 어떻게 나눠 받아도 같은 판이 되고, 그 판으로 잰 템포가 원 신호로 잰 것과 같다.
 */

function click(rate: number, seconds: number, bpm: number): Float32Array {
  const out = new Float32Array(Math.round(rate * seconds));
  const period = 60 / bpm;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / rate;
    const phase = t % period;
    out[i] = phase < 0.02 ? Math.sin(2 * Math.PI * 80 * t) * (1 - phase / 0.02) : 0;
  }
  return out;
}

describe('§5.13 (Y) 40-2 ⑦ — downsampleMonoInto', () => {
  it('averages channels and source samples into each output sample', () => {
    const out = new Float32Array(4);
    // 원 표본율 8 → 출력 4: 출력 표본 하나가 원 표본 둘의 평균.
    downsampleMonoInto(out, 4, 0, [Float32Array.from([1, 1, 0, 0, 1, 0, 0, 0]), Float32Array.from([1, 1, 0, 0, 1, 0, 0, 0])], 8);
    expect([...out]).toEqual([1, 0, 0.5, 0]);
  });

  it('places a chunk at its start time and leaves other slots alone', () => {
    const out = new Float32Array(10).fill(-1);
    downsampleMonoInto(out, 10, 0.5, [Float32Array.from([0.25, 0.25, 0.25])], 10);
    expect([...out]).toEqual([-1, -1, -1, -1, -1, 0.25, 0.25, 0.25, -1, -1]);
    // 판 끝을 넘는 조각은 잘린다.
    downsampleMonoInto(out, 10, 0.9, [Float32Array.from([0.5, 0.5, 0.5])], 10);
    expect(out[9]).toBe(0.5);
  });

  it('gives the same buffer however the decoder split the chunks', () => {
    const rate = 44_100;
    const source = click(rate, 6, 120);
    const whole = new Float32Array(Math.ceil(6 * BEAT_ANALYSIS_RATE));
    downsampleMonoInto(whole, BEAT_ANALYSIS_RATE, 0, [source], rate);
    const pieces = new Float32Array(whole.length);
    const chunk = 1_024 * 4; // 원 표본 4096 개 — 4:1 경계에 맞물린다.
    for (let at = 0; at < source.length; at += chunk) {
      downsampleMonoInto(pieces, BEAT_ANALYSIS_RATE, at / rate, [source.subarray(at, at + chunk)], rate);
    }
    let diff = 0;
    for (let i = 0; i < whole.length; i += 1) diff = Math.max(diff, Math.abs((whole[i] ?? 0) - (pieces[i] ?? 0)));
    expect(diff).toBeLessThan(1e-6);
  });

  it('measures the same tempo from the 11.025kHz buffer as from the source', () => {
    const rate = 44_100;
    const source = click(rate, 20, 120);
    const mono = new Float32Array(Math.ceil(20 * BEAT_ANALYSIS_RATE));
    downsampleMonoInto(mono, BEAT_ANALYSIS_RATE, 0, [source], rate);
    const low = analyzeBeats(mono, BEAT_ANALYSIS_RATE);
    const high = analyzeBeats(source, rate);
    expect(Math.abs(low.bpm - high.bpm)).toBeLessThan(2);
    expect(Math.abs(low.bpm - 120)).toBeLessThan(2);
  });
});

describe('§5.13 (Y) 40-2 ⑦ — BPM 태그', () => {
  it('accepts only plausible tags and narrows the search around them', () => {
    expect(usableBpmTag(128)).toBe(128);
    expect(usableBpmTag(0)).toBeNull();
    expect(usableBpmTag(999)).toBeNull();
    expect(usableBpmTag('120')).toBeNull();
    expect(bpmRangeFor(null)).toBeUndefined();
    const range = bpmRangeFor(100)!;
    expect(range.minBpm).toBeCloseTo(94, 6);
    expect(range.maxBpm).toBeCloseTo(106, 6);
  });
});
