import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REVIEW_THRESHOLDS,
  computeFrameStats,
  inspectSamples,
  shouldRetry,
  summarizeFindings,
  type FrameStats,
  type ReviewSample,
} from './inspect.js';

/** 단색 화면 픽셀. */
function solid(r: number, g: number, b: number, pixels = 4096): Uint8ClampedArray {
  const data = new Uint8ClampedArray(pixels * 4);
  for (let i = 0; i < pixels; i += 1) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return data;
}

/** 절반은 검정, 절반은 흰색인 화면. */
function halfSplit(pixels = 4096): Uint8ClampedArray {
  const data = new Uint8ClampedArray(pixels * 4);
  for (let i = 0; i < pixels; i += 1) {
    const v = i < pixels / 2 ? 0 : 255;
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return data;
}

const sample = (over: Partial<ReviewSample> = {}): ReviewSample => ({
  t: 1,
  stats: { meanLuma: 0.5, stdLuma: 0.2, variedRatio: 0.5 },
  itemIds: ['a'],
  captionText: '자막',
  captionOverflow: false,
  expectsAudio: false,
  ...over,
});

const flat: FrameStats = { meanLuma: 0, stdLuma: 0, variedRatio: 0 };

describe('computeFrameStats', () => {
  it('단색은 표준편차가 0이다', () => {
    const s = computeFrameStats(solid(0, 0, 0));
    expect(s.stdLuma).toBeCloseTo(0);
    expect(s.variedRatio).toBeCloseTo(0);
  });

  it('흰 화면은 평균 밝기가 1에 가깝다', () => {
    expect(computeFrameStats(solid(255, 255, 255)).meanLuma).toBeCloseTo(1, 2);
  });

  it('반씩 갈린 화면은 변화가 있다', () => {
    const s = computeFrameStats(halfSplit());
    expect(s.stdLuma).toBeGreaterThan(0.3);
    expect(s.variedRatio).toBeGreaterThan(0.3);
  });

  it('사람 눈 가중치를 쓴다 — 초록이 파랑보다 밝게 잡힌다', () => {
    const green = computeFrameStats(solid(0, 255, 0)).meanLuma;
    const blue = computeFrameStats(solid(0, 0, 255)).meanLuma;
    expect(green).toBeGreaterThan(blue);
  });

  it('빈 배열에도 터지지 않는다', () => {
    expect(computeFrameStats(new Uint8ClampedArray(0))).toEqual({ meanLuma: 0, stdLuma: 0, variedRatio: 0 });
  });
});

describe('inspectSamples — 빈 화면', () => {
  it('그릴 것이 있는데 화면이 평평하면 오류다', () => {
    const f = inspectSamples([sample({ stats: flat })]);
    expect(f.map((x) => x.code)).toContain('blank-frame');
    expect(f[0]?.level).toBe('error');
    expect(f[0]?.itemIds).toEqual(['a']);
  });

  it('그릴 것이 없으면 평평해도 정상이다', () => {
    expect(inspectSamples([sample({ stats: flat, itemIds: [] })])).toHaveLength(0);
  });

  it('정상 화면은 아무것도 잡지 않는다', () => {
    expect(inspectSamples([sample()])).toHaveLength(0);
  });
});

describe('inspectSamples — 소리와 자막', () => {
  it('소리가 나는데 자막이 없으면 확인 거리로 알린다', () => {
    const f = inspectSamples([sample({ expectsAudio: true, captionText: '' })]);
    expect(f.map((x) => x.code)).toContain('caption-empty');
    expect(f.find((x) => x.code === 'caption-empty')?.level).toBe('warn');
  });

  it('소리가 있어야 하는데 무음이면 오류다', () => {
    const f = inspectSamples([sample({ expectsAudio: true, audioLevel: 0 })]);
    expect(f.map((x) => x.code)).toContain('silent-audio');
  });

  it('오디오 크기를 못 재면 무음 판정을 하지 않는다', () => {
    const f = inspectSamples([sample({ expectsAudio: true })]);
    expect(f.map((x) => x.code)).not.toContain('silent-audio');
  });

  it('자막이 넘치면 알린다', () => {
    const f = inspectSamples([sample({ captionOverflow: true })]);
    expect(f.map((x) => x.code)).toContain('caption-overflow');
  });
});

describe('inspectSamples — 급변', () => {
  it('밝기가 확 튀면 전환을 권한다', () => {
    const f = inspectSamples([
      sample({ t: 1, stats: { meanLuma: 0.02, stdLuma: 0.2, variedRatio: 0.4 } }),
      sample({ t: 2, stats: { meanLuma: 0.95, stdLuma: 0.2, variedRatio: 0.4 } }),
    ]);
    expect(f.map((x) => x.code)).toContain('hard-jump');
  });

  it('완만한 변화는 잡지 않는다 (오탐이 잦으면 아무도 안 읽는다)', () => {
    const f = inspectSamples([
      sample({ t: 1, stats: { meanLuma: 0.4, stdLuma: 0.2, variedRatio: 0.4 } }),
      sample({ t: 2, stats: { meanLuma: 0.6, stdLuma: 0.2, variedRatio: 0.4 } }),
    ]);
    expect(f.map((x) => x.code)).not.toContain('hard-jump');
  });

  it('첫 표본은 비교 대상이 없어 급변으로 잡히지 않는다', () => {
    const f = inspectSamples([sample({ stats: { meanLuma: 1, stdLuma: 0.2, variedRatio: 0.4 } })]);
    expect(f.map((x) => x.code)).not.toContain('hard-jump');
  });

  it('임계값을 바꾸면 판정이 따라온다', () => {
    const samples = [
      sample({ t: 1, stats: { meanLuma: 0.4, stdLuma: 0.2, variedRatio: 0.4 } }),
      sample({ t: 2, stats: { meanLuma: 0.6, stdLuma: 0.2, variedRatio: 0.4 } }),
    ];
    const f = inspectSamples(samples, { ...DEFAULT_REVIEW_THRESHOLDS, jumpLuma: 0.1 });
    expect(f.map((x) => x.code)).toContain('hard-jump');
  });
});

describe('요약과 재시도', () => {
  it('문제가 없으면 그렇게 말한다', () => {
    expect(summarizeFindings([])).toContain('찾지 못했습니다');
  });

  it('오류와 확인을 나눠 센다', () => {
    const f = inspectSamples([sample({ stats: flat }), sample({ captionOverflow: true })]);
    const text = summarizeFindings(f);
    expect(text).toContain('오류');
    expect(text).toContain('확인');
  });

  it('오류가 있을 때만 다시 렌더한다', () => {
    expect(shouldRetry(inspectSamples([sample({ stats: flat })]))).toBe(true);
    expect(shouldRetry(inspectSamples([sample({ captionOverflow: true })]))).toBe(false);
    expect(shouldRetry([])).toBe(false);
  });
});
