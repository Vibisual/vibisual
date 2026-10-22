/**
 * projectTabOrder.ts — §5.4 #14-2 (C-1) 프로젝트 탭 줄의 순서(클라 순수 로직).
 *
 * 프로젝트 탭끼리의 순서는 서버 `AppState.openProjects` 의 배열 순서가 SSOT 다. 종전에는 줄 순서를 컴포넌트의
 * 휘발 상태(`tabOrder`)만 들고 있었고, 그 첫 값은 첫 스냅샷이 실어 온 순서("마지막으로 보던 프로젝트 → 나머지")
 * 였다 — 그래서 끌어서 맞춰 둔 자리가 앱을 켤 때마다 흐트러지고 마지막에 본 탭이 맨 앞으로 튀었다.
 *
 * 이 모듈이 하는 일은 둘이다.
 *  1. `syncTabOrder` — 지금 줄의 순서(iframe 탭과 섞여 있다)를 들어온 탭 목록과 서버 순서에 맞춘다.
 *  2. 붙들기 — 드롭 직후, PATCH 전에 떠난 스냅샷이 옛 순서를 싣고 와 탭을 한 번 되돌리지 않게 서버 순서 위에
 *     놓은 순서를 얹어 그린다(§5.4 #36 (H) `stores/linkViewHold.ts` 와 같은 규율 — 다 답한 뒤 서버가 그 순서를
 *     따르면 놓고, 실패면 곧바로, 그 밖엔 `PROJECT_TAB_ORDER.pendingMs`).
 *
 * 놓은 순서를 서버 순서에 얹는 계산은 shared `reorderOpenProjects` 한 벌이다 — 서버가 PATCH 를 받으면 똑같이
 * 계산하므로, 붙드는 동안 그린 줄과 저장된 줄이 갈리지 않는다. DOM·store 를 만지지 않아 그대로 단위 테스트된다.
 */
import { pathKey, projectOrderFollows, reorderOpenProjects, type PlatformName } from '@vibisual/shared';

/** 줄에 설 탭 하나 — 순서를 맞추는 데 필요한 것만. */
export interface TabOrderEntry {
  readonly key: string;
  /** 프로젝트 탭이면 그 경로(projectId). iframe 탭은 비운다 — 서버 순서에 없는 탭이다. */
  readonly path?: string;
}

/** 두 순서가 같은가(같은 키가 같은 자리에). */
export function sameTabOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * 다음 줄 순서.
 *
 * ① 사라진 탭은 뺀다. ② **프로젝트 탭끼리는 `projectOrder` 순서로** — 프로젝트 탭이 차지한 자리들 안에서만 다시
 * 줄 세우므로 iframe 탭은 제자리다. 순서에 없는 프로젝트(아직 목록에 안 실린 것)는 지금 앞뒤 그대로 뒤로 간다.
 * ③ 처음 보는 프로젝트 탭은 그 순서의 **제자리**에 끼운다(앞에 올 탭보다 뒤 · 뒤에 올 첫 프로젝트 탭 앞). 표시명이
 * 바뀌어 키가 갈린 탭도 이 길을 타므로 줄 끝으로 튀지 않는다. 뒤에 올 프로젝트 탭이 없거나 순서를 모르면 종전처럼
 * 줄 끝이다 — 새로 연 프로젝트는 서버 목록 끝에 붙으므로 줄 끝에 선다. iframe 탭은 언제나 줄 끝에 붙는다.
 *
 * 바뀐 것이 없으면 내용이 같은 새 배열을 돌려준다 — 같은지는 부르는 쪽이 `sameTabOrder` 로 가린다.
 */
export function syncTabOrder(
  prev: readonly string[],
  items: readonly TabOrderEntry[],
  projectOrder: readonly string[],
  platform: PlatformName,
): string[] {
  const rankByPath = new Map<string, number>();
  for (let i = 0; i < projectOrder.length; i += 1) {
    const p = projectOrder[i];
    if (typeof p !== 'string' || p.length === 0) continue;
    const k = pathKey(p, platform);
    if (!rankByPath.has(k)) rankByPath.set(k, i);
  }
  const itemByKey = new Map<string, { entry: TabOrderEntry; index: number }>();
  for (let i = 0; i < items.length; i += 1) {
    const entry = items[i];
    if (entry && !itemByKey.has(entry.key)) itemByKey.set(entry.key, { entry, index: i });
  }
  const isProject = (key: string): boolean => !!itemByKey.get(key)?.entry.path;
  const rankOf = (key: string): number => {
    const p = itemByKey.get(key)?.entry.path;
    if (!p) return Number.POSITIVE_INFINITY;
    return rankByPath.get(pathKey(p, platform)) ?? Number.POSITIVE_INFINITY;
  };
  /** 순서가 같으면(둘 다 모름) 지금 앞뒤를 지킨다. */
  const byRank = (a: { rank: number; at: number }, b: { rank: number; at: number }): number =>
    a.rank === b.rank ? a.at - b.at : a.rank < b.rank ? -1 : 1;

  // ① 남은 탭 — 사라진 것은 빼고, 혹시 겹친 키는 앞의 것만.
  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of prev) {
    if (!itemByKey.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }

  // ② 프로젝트 탭끼리는 서버 순서로 — 프로젝트가 차지한 자리들 안에서만.
  const slots: number[] = [];
  for (let i = 0; i < out.length; i += 1) {
    const key = out[i];
    if (key !== undefined && isProject(key)) slots.push(i);
  }
  const ranked = slots
    .map((slot, at) => {
      const key = out[slot] ?? '';
      return { key, rank: rankOf(key), at };
    })
    .sort(byRank);
  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    const next = ranked[i];
    if (slot !== undefined && next !== undefined) out[slot] = next.key;
  }

  // ③ 처음 보는 탭.
  const freshProjects: { key: string; rank: number; at: number }[] = [];
  const freshOthers: string[] = [];
  for (const [key, { entry, index }] of itemByKey) {
    if (seen.has(key)) continue;
    if (entry.path) freshProjects.push({ key, rank: rankOf(key), at: index });
    else freshOthers.push(key);
  }
  freshProjects.sort(byRank);
  for (const { key, rank } of freshProjects) {
    if (rank === Number.POSITIVE_INFINITY) {
      out.push(key);
      continue;
    }
    const before = out.findIndex((k) => isProject(k) && rankOf(k) > rank);
    if (before === -1) out.push(key);
    else out.splice(before, 0, key);
  }
  for (const key of freshOthers) out.push(key);
  return out;
}

// ─── 드롭 직후 붙들기 ───

/** 놓은 순서를 화면이 붙들고 있는 상태. */
export interface ProjectTabOrderHold {
  /** 놓은 순서 — 화면에 선 프로젝트 탭의 경로(보이는 순서). 다음 드롭이 통째로 갈아 끼운다. */
  readonly want: readonly string[];
  /** 아직 답이 안 온 PATCH 수. */
  readonly inFlight: number;
  /** 마지막으로 놓은 시각(ms) — 안전망 만료의 기준. */
  readonly at: number;
  /**
   * 이 붙들기가 처음 선 시각(ms). PATCH 의 답은 이 값으로 자기 붙들기를 찾는다 — 실패·만료로 놓인 붙들기의 늦은 답이
   * 그 뒤에 새로 선 붙들기의 수를 깎으면, 아직 도는 PATCH 를 두고 일찍 놓게 된다.
   */
  readonly since: number;
}

/** 놓았다 — 놓은 순서를 얹고, 답을 기다리는 PATCH 를 하나 센다. 부르기 **전에** `since` 를 읽어 답에 쥐여 준다. */
export function beginProjectTabOrderHold(
  prev: ProjectTabOrderHold | null,
  want: readonly string[],
  now: number,
): ProjectTabOrderHold {
  return { want: [...want], inFlight: (prev?.inFlight ?? 0) + 1, at: now, since: prev?.since ?? now };
}

/** PATCH 가 답했다. 실패면 붙들기를 통째로 놓는다. 이미 놓였거나 다른 붙들기면 그대로 둔다. */
export function settleProjectTabOrderHold(
  prev: ProjectTabOrderHold | null,
  since: number,
  ok: boolean,
): ProjectTabOrderHold | null {
  if (prev === null || prev.since !== since) return prev;
  if (!ok) return null;
  return { ...prev, inFlight: Math.max(0, prev.inFlight - 1) };
}

/**
 * 놓아도 되나 — 안전망이 지났거나, 보낸 PATCH 가 **다 답한 뒤** 서버 순서가 놓은 순서를 따른다.
 * "다 답한 뒤"를 기다리는 까닭: 빨리 두 번 놓아 처음 순서로 되돌리면, 첫 PATCH 전에 떠난 스냅샷이 지금의 바람과
 * 우연히 같다. 그것을 확인으로 읽고 놓으면 두 PATCH 사이에 떠난 스냅샷이 다시 뒤집는다.
 */
export function isProjectTabOrderHoldDone(
  hold: ProjectTabOrderHold,
  serverOrder: readonly string[],
  now: number,
  pendingMs: number,
  platform: PlatformName,
): boolean {
  if (now - hold.at > pendingMs) return true;
  return hold.inFlight === 0 && projectOrderFollows(serverOrder, hold.want, platform);
}

/**
 * 줄이 따를 프로젝트 순서 — 붙드는 동안은 서버 순서 위에 놓은 순서를 얹는다(서버가 PATCH 를 받으면 똑같이 계산할
 * 그 순서). 그 사이 서버에서 프로젝트가 열리고 닫혀도 구성원은 서버 것이라 새 탭이 사라지거나 닫은 탭이 남지 않는다.
 */
export function heldProjectTabOrder(
  serverOrder: readonly string[],
  hold: ProjectTabOrderHold | null,
  platform: PlatformName,
): readonly string[] {
  return hold ? reorderOpenProjects(serverOrder, hold.want, platform) : serverOrder;
}
