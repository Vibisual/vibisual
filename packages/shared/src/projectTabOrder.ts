/**
 * §5.4 #14-2 (C-1) — 프로젝트 탭 순서의 순수 로직. 순서 SSOT 는 서버 `AppState.openProjects` 다(클라 휘발 상태면 켤 때마다 흐트러진다).
 * 드롭하면 클라가 보이는 탭 경로를 보내고(`PATCH /api/projects/order`) 서버는 목록을 치환하지 않고 얹는다 — 클라도 같은 계산으로 붙드니 한 벌이어야 한다.
 * `platform` 인자 — 경로 키가 OS 마다 다르다(win32·darwin 접음, linux 안 접음).
 */

import { pathKey, type PlatformName } from './pathCase.js';

/**
 * `open` 에 놓은 순서(`order`)를 얹는다 — 길이·구성원은 `open` 그대로. `order` 경로가 지금 차지한 자리에만 되꽂는다(`applyVisibleOrder` 와 같은 자리 채우기).
 * `order` 에 없는 것(별창 탭·새 프로젝트)은 제자리, `open` 에 없는 경로는 버린다(늘리면 닫은 탭이 살아난다). 값은 `open` 원문 케이스, 중복은 앞이 이긴다.
 */
export function reorderOpenProjects(
  open: readonly string[],
  order: readonly string[],
  platform: PlatformName,
): string[] {
  const out = [...open];
  const slotByKey = new Map<string, number>();
  for (let i = 0; i < out.length; i += 1) {
    const p = out[i];
    if (typeof p !== 'string') continue;
    const k = pathKey(p, platform);
    if (!slotByKey.has(k)) slotByKey.set(k, i);
  }
  // 놓은 순서대로, 그 프로젝트가 `open` 에서 앉아 있던 자리.
  const picked: number[] = [];
  const seen = new Set<string>();
  for (const p of order) {
    if (typeof p !== 'string' || p.length === 0) continue;
    const k = pathKey(p, platform);
    if (seen.has(k)) continue;
    seen.add(k);
    const at = slotByKey.get(k);
    if (at !== undefined) picked.push(at);
  }
  // 하나 이하면 바꿀 앞뒤가 없다.
  if (picked.length < 2) return out;
  const slots = [...picked].sort((a, b) => a - b);
  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    const from = picked[i];
    if (slot === undefined || from === undefined) continue;
    const value = open[from];
    if (value !== undefined) out[slot] = value;
  }
  return out;
}

/** `open` 이 이미 `want` 의 앞뒤를 따르는가(얹어도 안 바뀌면 참). 쓰는 곳: 같으면 서버에 안 보내기(iframe 탭만 옮김) · 드롭 뒤 서버가 따라왔으면 붙들기 놓기. */
export function projectOrderFollows(
  open: readonly string[],
  want: readonly string[],
  platform: PlatformName,
): boolean {
  const next = reorderOpenProjects(open, want, platform);
  for (let i = 0; i < next.length; i += 1) {
    if (next[i] !== open[i]) return false;
  }
  return true;
}
