import { describe, expect, it } from 'vitest';
import { APP_LINKED_ITEMS } from '@vibisual/shared';

import type { AppLinkedItem } from '../../apps/registry.js';
import { beadQuota, glanceRowGroups, layoutBeadRow, pillWidth, type BeadRowOptions } from './linkedBeads.js';

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

/** §5.4 #36 (J) ⑤ — 접는 줄: 장면은 알약, 소재·지난 결과는 앱이 접으라고 하면 칩 하나 — `+N` 은 펼친 묶음 안에만. */
describe('§5.4 #36 (J) ⑤ 접는 줄', () => {
  const scene = (id: string, durationSec?: number): AppLinkedItem => ({
    id: `scene:${id}`, group: 'scene', kind: 'scene', label: id, pill: true, ...(durationSec === undefined ? {} : { durationSec }),
  });
  const part = (id: string): AppLinkedItem => ({ id: `asset:${id}`, group: 'part', kind: 'image', label: id });
  const pastOf = (n: number): { file: string }[] => Array.from({ length: n }, (_, i) => ({ file: `out/v${i}.mp4` }));

  it('알약 폭은 길이에 비례하고 한도 안이다(길이를 모르면 하한)', () => {
    expect(pillWidth(5)).toBe(Math.max(APP_LINKED_ITEMS.pillMinWidth, Math.min(APP_LINKED_ITEMS.pillMaxWidth, 5 * APP_LINKED_ITEMS.pillPxPerSec)));
    expect(pillWidth(0.1)).toBe(APP_LINKED_ITEMS.pillMinWidth);
    expect(pillWidth(9_999)).toBe(APP_LINKED_ITEMS.pillMaxWidth);
    expect(pillWidth(undefined)).toBe(APP_LINKED_ITEMS.pillMinWidth);
    expect(pillWidth(Number.NaN)).toBe(APP_LINKED_ITEMS.pillMinWidth);
    expect(pillWidth(8)).toBeGreaterThanOrEqual(pillWidth(4));
  });

  it('접힌 묶음은 칩 하나 — 구슬도 +N 도 없고 칩이 수를 말한다', () => {
    const groups = glanceRowGroups([scene('a', 3), part('i'), part('j')], pastOf(2), ['part', 'past'], new Set(), 10);
    expect(groups.map((g) => [g.group, g.chip, g.items.length, g.past.length, g.total, g.more])).toEqual([
      ['scene', null, 1, 0, 1, 0],
      ['part', { expanded: false }, 0, 0, 2, 0],
      ['past', { expanded: false }, 0, 0, 2, 0],
    ]);
  });

  it('펼치면 칩 뒤에 구슬이 서고, 넘친 수는 그 묶음 안의 +N 이다', () => {
    const parts = Array.from({ length: 5 }, (_, i) => part(`p${i}`));
    const groups = glanceRowGroups(parts, pastOf(4), ['part', 'past'], new Set(['part']), 3);
    expect(groups.map((g) => [g.group, g.chip?.expanded, g.items.length, g.past.length, g.more])).toEqual([
      ['part', true, 3, 0, 2],
      ['past', false, 0, 0, 0],
    ]);
  });

  it('장면 알약도 한도까지 — 넘치면 장면 묶음 끝의 +N', () => {
    const scenes = Array.from({ length: 12 }, (_, i) => scene(`s${i}`, 2));
    const [g] = glanceRowGroups(scenes, [], [], new Set(), 10);
    expect(g).toMatchObject({ group: 'scene', chip: null, total: 12, more: 2 });
    expect(g?.items).toHaveLength(10);
  });

  it('접으라고 하지 않은 묶음은 칩 없이 편다 · 빈 묶음은 없다', () => {
    const groups = glanceRowGroups([part('i')], [], ['past'], new Set(), 10);
    expect(groups).toEqual([{ group: 'part', chip: null, items: [part('i')], past: [], total: 1, more: 0 }]);
    expect(glanceRowGroups([], [], ['part', 'past'], new Set(), 10)).toEqual([]);
  });
});
