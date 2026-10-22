/**
 * projectTabOrder.ts — §5.4 #14-2 (C-1) **프로젝트 탭 순서**의 순수 로직.
 *
 * 프로젝트 탭끼리의 순서는 서버 `AppState.openProjects` 의 배열 순서가 SSOT 다. 종전에는 그 순서를
 * 클라 컴포넌트의 휘발 상태(`tabOrder`)만 들고 있어서, 앱을 켤 때마다 첫 스냅샷이 실어 온 순서
 * ("마지막으로 보던 프로젝트 → 나머지")로 줄이 다시 섰다 — 끌어서 맞춰 둔 자리가 켤 때마다 흐트러졌다.
 *
 * 탭을 끌어 놓으면 클라는 화면에 선 프로젝트 탭의 경로를 보이는 순서로 보내고(`PATCH /api/projects/order`),
 * 서버는 그 순서를 **목록을 치환하지 않고** 얹는다. 클라는 서버가 따라올 때까지 같은 계산으로 화면을
 * 붙든다 — 그래서 이 계산은 한 벌이어야 한다(두 벌이면 놓은 자리와 저장된 자리가 갈린다).
 *
 * `platform` 을 인자로 받는 이유: 경로 비교 키는 OS 마다 답이 다르다(win32·darwin 은 케이스를 접고
 * linux 는 접지 않는다). 실기 없이 세 OS 를 단위 테스트로 고정하는 유일한 방법이다
 * ([docs/rules/multiplatform.md] 1축 — 경로 키).
 */

import { pathKey, type PlatformName } from './pathCase.js';

/**
 * 열린 프로젝트 목록(`open`)에 사용자가 놓은 순서(`order`)를 얹는다.
 *
 * - `order` 에 든 경로가 `open` 에서 **지금 차지한 자리들에만** 새 순서를 되꽂는다
 *   (§5.4 #14-2 (C) 의 `applyVisibleOrder` 와 같은 자리 채우기).
 * - `order` 에 없는 항목(별창으로 뺀 탭 · 그 사이 새로 열린 프로젝트)은 제자리다.
 * - `open` 에 없는 경로는 버린다 — 순서를 정하는 함수가 목록을 늘리면 닫은 탭이 되살아난다.
 * - 값은 `open` 의 원문(저장 포맷 · 원본 케이스)을 그대로 쓴다. 클라가 보낸 케이스로 바꿔 적지 않는다.
 * - 같은 프로젝트가 `order` 에 두 번 오면 앞의 것이 이긴다.
 *
 * 결과의 길이·구성원은 언제나 `open` 과 같다(순서만 바뀐다).
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

/**
 * `open` 이 이미 `want` 의 앞뒤를 따르는가 — `want` 를 얹어도 아무것도 바뀌지 않으면 참이다.
 *
 * 쓰는 자리 둘: 놓은 순서가 지금과 같으면 서버에 보내지 않고(iframe 탭만 옮긴 경우), 드롭 뒤 서버가
 * 그 순서를 돌려줬는지 보고 붙들기를 놓는다. `want` 에 있지만 `open` 에 없는 경로는 따질 대상이 아니다.
 */
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
