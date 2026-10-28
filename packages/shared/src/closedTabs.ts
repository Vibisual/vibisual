/**
 * §5.4 #14-4 닫은 탭 다시 열기 스택의 순수 로직(목록 SSOT 는 `AppState.recentlyClosedTabs`). 같은 프로젝트 접기는 OS 마다 달라 `platform` 을 인자로 받아 세 OS 를 시험한다.
 * 상한(§3.2.3 축 E)은 쌓는 함수 안에서만 지킨다.
 */

import type { ClosedTabEntry } from './types.js';
import { pathKey, type PlatformName } from './pathCase.js';
import { MAX_RECENTLY_CLOSED_TABS } from './constants.js';

/** 같은 탭 판정 키 — 프로젝트는 표시명(`p:<basename>`)이 아니라 **경로**로 접는다(`…/alpha/app` 과 `…/beta/app` 이 한 칸을 다투지 않게). */
export function closedTabDedupeKey(entry: ClosedTabEntry, platform: PlatformName): string {
  if (entry.kind === 'project' && entry.path) return `project:${pathKey(entry.path, platform)}`;
  return `${entry.kind}:${entry.key}`;
}

/** 디스크 JSON → 항목 배열. 되열 수 없는 항목(경로 없는 프로젝트·주소 없는 iframe)은 들이지 않는다 — 눌러도 아무 일이 없는 유령이 된다(§3.2.3). */
export function normalizeClosedTabEntries(
  raw: unknown,
  platform: PlatformName,
  max: number = MAX_RECENTLY_CLOSED_TABS,
): ClosedTabEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ClosedTabEntry[] = [];
  for (const item of raw) {
    const entry = coerceClosedTabEntry(item);
    if (!entry) continue;
    const dk = closedTabDedupeKey(entry, platform);
    if (seen.has(dk)) continue; // 앞(=최신)이 이긴다.
    seen.add(dk);
    out.push(entry);
    if (max > 0 && out.length >= max) break;
  }
  return out;
}

/** 한 건을 항목으로 강제. 되열 수 없는 모양이면 `null`. */
function coerceClosedTabEntry(raw: unknown): ClosedTabEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const key = typeof r['key'] === 'string' ? r['key'] : '';
  const kind = r['kind'];
  const label = typeof r['label'] === 'string' ? r['label'] : '';
  if (!key || (kind !== 'project' && kind !== 'iframe')) return null;
  const closedAt = typeof r['closedAt'] === 'number' && Number.isFinite(r['closedAt'])
    ? r['closedAt']
    : 0;
  if (kind === 'project') {
    const p = typeof r['path'] === 'string' ? r['path'] : '';
    if (!p) return null;
    return { key, kind, label: label || key.slice(2), closedAt, path: p };
  }
  const url = typeof r['url'] === 'string' ? r['url'] : '';
  if (!url) return null;
  const sk = r['serverKind'];
  // §7.11 / §3.5 — 그 프리뷰를 연 프로젝트. 되연 탭이 화면을 불러오기 전에 이 프로젝트 기준으로 묻는다.
  const projectPath = typeof r['projectPath'] === 'string' ? r['projectPath'] : '';
  return {
    key,
    kind,
    label: label || key.slice(2),
    closedAt,
    url,
    ...(sk === 'frontend' || sk === 'backend' ? { serverKind: sk } : {}),
    ...(projectPath ? { projectPath } : {}),
  };
}

/** 새로 닫은 탭을 맨 앞에(새 배열). 같은 탭은 옛 항목을 걷고, `max` 초과는 오래된 것부터 밀린다(`<= 0` = 무제한). 되열 수 없으면 입력 그대로. */
export function pushClosedTabEntry(
  list: readonly ClosedTabEntry[],
  entry: ClosedTabEntry,
  platform: PlatformName,
  max: number = MAX_RECENTLY_CLOSED_TABS,
): ClosedTabEntry[] {
  const clean = coerceClosedTabEntry(entry);
  if (!clean) return [...list];
  const dk = closedTabDedupeKey(clean, platform);
  const rest = list.filter((e) => closedTabDedupeKey(e, platform) !== dk);
  const next = [clean, ...rest];
  return max > 0 ? next.slice(0, max) : next;
}

/** 꺼낸다(다시 열기) — `key` 없으면 가장 최근 것. 못 찾으면 `entry: null` + 원본 그대로. */
export function takeClosedTabEntry(
  list: readonly ClosedTabEntry[],
  key?: string,
): { entry: ClosedTabEntry | null; rest: ClosedTabEntry[] } {
  const at = key ? list.findIndex((e) => e.key === key) : 0;
  const found = at >= 0 ? list[at] : undefined;
  if (!found) return { entry: null, rest: [...list] };
  return { entry: found, rest: list.filter((_, i) => i !== at) };
}

/** 사라진 프로젝트 항목을 걷는다(부팅 1회 — 남기면 `registerProject` 가 유령을 등록한다). iframe 은 열어 보기 전엔 생사를 몰라 둔다. */
export function pruneMissingClosedTabs(
  list: readonly ClosedTabEntry[],
  exists: (path: string) => boolean,
): { kept: ClosedTabEntry[]; removed: number } {
  const kept: ClosedTabEntry[] = [];
  let removed = 0;
  for (const e of list) {
    if (e.kind === 'project' && e.path && !exists(e.path)) {
      removed += 1;
      continue;
    }
    kept.push(e);
  }
  return { kept, removed };
}
