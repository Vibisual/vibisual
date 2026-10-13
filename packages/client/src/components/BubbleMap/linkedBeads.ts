/**
 * linkedBeads.ts — §5.4 #36 (H) ③ 앱 노드 아래 **구슬 줄의 자리**(순수).
 *
 * 묶음(장면 → 소재 → 지난 결과)을 한 줄로 늘어놓는다. 보이는 수는 `max` — 넘치면 마지막 자리 하나를 `+N` 구슬에 내준다.
 * 빈 묶음이 아니면 **적어도 하나씩** 보인다(지난 결과가 장면·소재에 밀려 통째로 사라지지 않게). 나머지 자리는 앞 묶음부터
 * 채운다. 묶음이 바뀌는 자리는 `groupGap` 만큼 더 띄운다. DOM 을 만지지 않으므로 그대로 단위 테스트된다.
 */

import { APP_LINKED_ITEMS } from '@vibisual/shared';

export interface BeadSlot<T> {
  readonly item: T;
  /** 구슬 중심의 x(줄 왼쪽 끝 = 0). */
  readonly x: number;
}

export interface BeadRow<T> {
  readonly slots: readonly BeadSlot<T>[];
  /** 넘친 수(`+N` 의 N). 0 이면 넘침 구슬이 없다. */
  readonly more: number;
  /** 넘침 구슬 중심 x. 없으면 null. */
  readonly moreX: number | null;
  /** 줄 전체 폭(첫 구슬 왼쪽 끝 ~ 마지막 구슬 오른쪽 끝). 구슬이 하나도 없으면 0. */
  readonly width: number;
}

export interface BeadRowOptions {
  readonly max: number;
  readonly size: number;
  readonly gap: number;
  readonly groupGap: number;
}

export const DEFAULT_BEAD_ROW: BeadRowOptions = {
  max: APP_LINKED_ITEMS.maxVisible,
  size: APP_LINKED_ITEMS.beadSize,
  gap: APP_LINKED_ITEMS.beadGap,
  groupGap: APP_LINKED_ITEMS.groupGap,
};

/** 묶음마다 보일 구슬 수. 다 들어가면 전부, 넘치면 `max - 1` 자리를 나눈다(빈 묶음이 아니면 하나씩 먼저, 나머지는 앞부터). */
export function beadQuota(sizes: readonly number[], max: number): number[] {
  const counts = sizes.map((n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0));
  const total = counts.reduce((s, n) => s + n, 0);
  const cap = Math.max(0, Math.floor(max));
  if (total <= cap) return counts;
  let budget = Math.max(0, cap - 1);
  const quota = counts.map(() => 0);
  for (let i = 0; i < counts.length && budget > 0; i += 1) {
    if ((counts[i] ?? 0) > 0) {
      quota[i] = 1;
      budget -= 1;
    }
  }
  for (let i = 0; i < counts.length && budget > 0; i += 1) {
    const take = Math.min((counts[i] ?? 0) - (quota[i] ?? 0), budget);
    if (take > 0) {
      quota[i] = (quota[i] ?? 0) + take;
      budget -= take;
    }
  }
  return quota;
}

export function layoutBeadRow<T>(groups: readonly (readonly T[])[], opts: BeadRowOptions = DEFAULT_BEAD_ROW): BeadRow<T> {
  const quota = beadQuota(groups.map((g) => g.length), opts.max);
  const total = groups.reduce((s, g) => s + g.length, 0);
  const shown = quota.reduce((s, n) => s + n, 0);
  const more = Math.max(0, total - shown);
  const half = opts.size / 2;
  const slots: BeadSlot<T>[] = [];
  let cursor = half;
  let started = false;
  groups.forEach((group, gi) => {
    const n = quota[gi] ?? 0;
    if (n === 0) return;
    if (started) cursor += opts.groupGap;
    started = true;
    for (let i = 0; i < n; i += 1) {
      const item = group[i];
      if (item === undefined) continue;
      slots.push({ item, x: cursor });
      cursor += opts.size + opts.gap;
    }
  });
  let moreX: number | null = null;
  if (more > 0) {
    if (started) cursor += opts.groupGap;
    moreX = cursor;
    cursor += opts.size + opts.gap;
  }
  const width = slots.length === 0 && moreX === null ? 0 : cursor - opts.gap - half;
  return { slots, more, moreX, width };
}
