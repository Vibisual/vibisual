import { describe, expect, it } from 'vitest';
import { COMPARE_GAP, compareLayout } from './compareImage.js';

/** §5.13 (G) 전후 비교 한 장 — 왼쪽 = 전, 오른쪽 = 후, 라벨 띠는 그림 위(그림을 가리지 않는다). */
describe('§5.13 (G) before/after compare layout', () => {
  it('puts before on the left and after on the right at the same height, labels above the pictures', () => {
    const l = compareLayout({ width: 640, height: 360 }, { width: 640, height: 360 });
    const [before, after] = l.cells;
    expect(before.x).toBe(COMPARE_GAP);
    expect(after.x).toBe(COMPARE_GAP * 2 + 640);
    expect(before.y).toBe(after.y);
    expect(before.y).toBe(COMPARE_GAP + l.band);
    expect(before.width).toBe(640);
    expect(l.width).toBe(640 * 2 + COMPARE_GAP * 3);
    expect(l.height).toBe(COMPARE_GAP + l.band + 360 + COMPARE_GAP);
    expect(l.band).toBeGreaterThanOrEqual(l.fontPx);
  });

  it('keeps each picture aspect when the two revisions have different sizes (e.g. a format change)', () => {
    const l = compareLayout({ width: 640, height: 360 }, { width: 360, height: 640 });
    const [before, after] = l.cells;
    expect(before.height).toBe(640);
    expect(after.height).toBe(640);
    expect(before.width / before.height).toBeCloseTo(640 / 360, 2);
    expect(after.width / after.height).toBeCloseTo(360 / 640, 2);
  });

  it('survives an empty picture without dividing by zero', () => {
    const l = compareLayout({ width: 0, height: 0 }, { width: 10, height: 10 });
    expect(Number.isFinite(l.width) && l.width > 0).toBe(true);
    expect(l.cells[0].width).toBeGreaterThan(0);
  });
});
