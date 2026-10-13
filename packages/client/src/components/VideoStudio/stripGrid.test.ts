import { describe, expect, it } from 'vitest';

import { stripColumns } from './stripGrid.js';

/** §5.13 (T-9) — 프레임 띠는 가로가 조금 긴 격자 한 장이다(8칸 → 4×2, 24칸 → 6×4). */
describe('§5.13 (T-9) 프레임 띠 격자', () => {
  it('칸 수에 맞는 열 수를 고른다', () => {
    expect(stripColumns(0)).toBe(1);
    expect(stripColumns(1)).toBe(1);
    expect(stripColumns(2)).toBe(2);
    expect(stripColumns(8)).toBe(4);
    expect(stripColumns(24)).toBe(6);
  });

  it('열은 칸 수를 넘지 않고, 격자는 세로로 길어지지 않는다', () => {
    for (let n = 1; n <= 24; n += 1) {
      const cols = stripColumns(n);
      expect(cols, `${n}칸`).toBeLessThanOrEqual(n);
      expect(Math.ceil(n / cols), `${n}칸`).toBeLessThanOrEqual(cols);
    }
  });
});
