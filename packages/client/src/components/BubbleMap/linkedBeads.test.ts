import { describe, expect, it } from 'vitest';
import { beadQuota, layoutBeadRow, type BeadRowOptions } from './linkedBeads.js';

/** §5.4 #36 (H) ③ — 구슬 줄의 자리. 넘치면 `+N`, 빈 묶음이 아니면 적어도 하나씩, 묶음 사이는 더 띄운다. */

const OPTS: BeadRowOptions = { max: 5, size: 20, gap: 4, groupGap: 8 };

describe('§5.4 #36 (H) ③ 묶음마다 보일 수', () => {
  it('다 들어가면 전부', () => {
    expect(beadQuota([2, 1, 1], 5)).toEqual([2, 1, 1]);
  });

  it('넘치면 마지막 자리를 +N 에 내주고, 빈 묶음이 아니면 하나씩 먼저 — 지난 결과가 통째로 밀려나지 않는다', () => {
    expect(beadQuota([6, 6, 2], 5)).toEqual([2, 1, 1]);
    expect(beadQuota([10, 0, 3], 5)).toEqual([3, 0, 1]);
  });

  it('이상한 수는 0 으로 친다', () => {
    expect(beadQuota([Number.NaN, -2, 1], 5)).toEqual([0, 0, 1]);
  });
});

describe('§5.4 #36 (H) ③ 구슬 자리', () => {
  it('구슬 중심 간격 = 지름 + 간격, 묶음이 바뀌면 groupGap 을 더 띄운다', () => {
    const row = layoutBeadRow([['a', 'b'], ['c']], OPTS);
    expect(row.slots.map((s) => [s.item, s.x])).toEqual([['a', 10], ['b', 34], ['c', 66]]);
    expect(row.more).toBe(0);
    expect(row.moreX).toBeNull();
    expect(row.width).toBe(76);
  });

  it('빈 묶음은 자리도 띄움도 없다', () => {
    const row = layoutBeadRow([[], ['c']], OPTS);
    expect(row.slots.map((s) => s.x)).toEqual([10]);
    expect(row.width).toBe(20);
  });

  it('넘치면 +N 구슬이 끝에 선다(묶음 띄움 뒤에)', () => {
    const row = layoutBeadRow([['a', 'b', 'c', 'd', 'e', 'f']], OPTS);
    expect(row.slots).toHaveLength(4);
    expect(row.more).toBe(2);
    expect(row.moreX).toBe(10 + 4 * 24 + 8);
    expect(row.width).toBe((row.moreX ?? 0) + 10);
  });

  it('아무것도 없으면 폭 0 — 그리지 않는다', () => {
    expect(layoutBeadRow([[], []], OPTS).width).toBe(0);
  });
});
