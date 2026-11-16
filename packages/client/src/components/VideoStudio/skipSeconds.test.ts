import { describe, expect, it } from 'vitest';

import { SKIP_SECONDS, formatSkipSeconds, isSkipPreset, normalizeSkipSeconds } from './skipSeconds.js';

describe('건너뛰기 간격 (§5.13 37-24)', () => {
  it('적은 값을 읽는다 — 소수·쉼표 소수점·앞뒤 빈칸', () => {
    expect(normalizeSkipSeconds('10', 5)).toBe(10);
    expect(normalizeSkipSeconds(' 2.5 ', 5)).toBe(2.5);
    expect(normalizeSkipSeconds('2,5', 5)).toBe(2.5);
    expect(normalizeSkipSeconds(30, 5)).toBe(30);
  });

  it('못 읽는 값·0 이하는 종전 값으로 돌아간다', () => {
    for (const raw of ['', '   ', 'abc', '0', '-3', 'NaN', 'Infinity']) expect(normalizeSkipSeconds(raw, 7)).toBe(7);
    expect(normalizeSkipSeconds(Number.NaN, 7)).toBe(7);
  });

  it('범위 안으로 묶고 소수 둘째 자리까지 남긴다', () => {
    expect(normalizeSkipSeconds('0.01', 5)).toBe(SKIP_SECONDS.min);
    expect(normalizeSkipSeconds('99999', 5)).toBe(SKIP_SECONDS.max);
    expect(normalizeSkipSeconds('1.2345', 5)).toBe(1.23);
  });

  it('표기는 끝자리 0 을 떼고, 고정 간격인지 안다', () => {
    expect(formatSkipSeconds(5)).toBe('5');
    expect(formatSkipSeconds(2.5)).toBe('2.5');
    expect(isSkipPreset(10)).toBe(true);
    expect(isSkipPreset(7)).toBe(false);
    expect(isSkipPreset(SKIP_SECONDS.initial)).toBe(true);
  });
});
