/**
 * §5.4 #36 (H) ③ — 구슬 줄 자리(순수). 장면 → 소재 → 지난 결과 순, 넘치면 마지막 자리를 `+N` 에.
 * 빈 묶음이 아니면 적어도 하나씩(지난 결과가 밀려 사라지지 않게), 묶음 경계는 `groupGap` 만큼 더 띄운다.
 */

import { APP_LINKED_ITEMS, type AppBubblePastFile } from '@vibisual/shared';

import type { AppLinkedFoldGroup, AppLinkedItem } from '../../apps/registry.js';

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

/** §5.4 #36 (J) ⑤ — 장면 알약 폭(캔버스 px): 길이에 비례, 한도 안. 길이를 모르면 하한. */
export function pillWidth(durationSec: number | undefined): number {
  const d = typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
  return Math.min(APP_LINKED_ITEMS.pillMaxWidth, Math.max(APP_LINKED_ITEMS.pillMinWidth, Math.round(d * APP_LINKED_ITEMS.pillPxPerSec)));
}

/** §5.4 #36 (J) ⑤ — 접는 줄의 한 묶음. `chip` 은 접힌 묶음의 칩(펼쳤는지), `more` 는 그 묶음 안의 `+N`. */
export interface GlanceRowGroup {
  readonly group: 'scene' | AppLinkedFoldGroup;
  readonly chip: { readonly expanded: boolean } | null;
  readonly items: readonly AppLinkedItem[];
  readonly past: readonly AppBubblePastFile[];
  /** 그 묶음의 전체 수(칩 숫자). */
  readonly total: number;
  readonly more: number;
}

/**
 * §5.4 #36 (J) ⑤ — 접는 줄 묶음(순수): 장면 → 소재 → 지난 결과. 앱이 접으라고 한 묶음은 칩 하나이고 펼치면 칩 뒤에 구슬이 선다.
 * 묶음마다 `max` 개까지, 넘친 수는 그 묶음 끝의 `+N` 이다(접힌 묶음에는 `+N` 이 없다 — 칩이 수를 말한다). 빈 묶음은 없다.
 */
export function glanceRowGroups(
  items: readonly AppLinkedItem[],
  pastFiles: readonly AppBubblePastFile[],
  fold: readonly AppLinkedFoldGroup[],
  open: ReadonlySet<AppLinkedFoldGroup>,
  max: number,
): GlanceRowGroup[] {
  const cap = Math.max(1, Math.floor(max));
  const out: GlanceRowGroup[] = [];
  const scenes = items.filter((i) => i.group === 'scene');
  if (scenes.length > 0) {
    const shown = scenes.slice(0, cap);
    out.push({ group: 'scene', chip: null, items: shown, past: [], total: scenes.length, more: scenes.length - shown.length });
  }
  const parts = items.filter((i) => i.group === 'part');
  if (parts.length > 0) {
    const folded = fold.includes('part');
    const visible = !folded || open.has('part');
    const shown = visible ? parts.slice(0, cap) : [];
    out.push({
      group: 'part', chip: folded ? { expanded: open.has('part') } : null, items: shown, past: [],
      total: parts.length, more: visible ? parts.length - shown.length : 0,
    });
  }
  if (pastFiles.length > 0) {
    const folded = fold.includes('past');
    const visible = !folded || open.has('past');
    const shown = visible ? pastFiles.slice(0, cap) : [];
    out.push({
      group: 'past', chip: folded ? { expanded: open.has('past') } : null, items: [], past: shown,
      total: pastFiles.length, more: visible ? pastFiles.length - shown.length : 0,
    });
  }
  return out;
}
