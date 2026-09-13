/**
 * closedTabs.ts — §5.4 #14-4 **"닫은 탭 다시 열기"** 스택의 순수 로직.
 *
 * 브라우저의 Ctrl+Shift+T 와 같은 동작이다: 방금 닫은 탭을 시간 역순으로 되살린다.
 * 목록 자체는 머신 단위 `AppState.recentlyClosedTabs` 에 살고(서버가 SSOT), 이 모듈은 그 목록을
 * **어떻게 쌓고 꺼내는가**만 다룬다 — 파일도 네트워크도 모른다.
 *
 * ## 왜 순수 함수인가
 * 두 가지를 단위 테스트로 고정하기 위해서다.
 * 1. **경로 대소문자** — 같은 프로젝트를 두 번 닫았을 때 한 건으로 접히는지는 OS 마다 답이 다르다
 *    (`C:/A` ≡ `c:/a` on win/mac, `≠` on linux). 그래서 `platform` 을 **인자로 받는다** —
 *    실기 없이 Windows 개발기에서 세 OS 를 전부 검증할 수 있는 유일한 방법이다
 *    ([docs/rules/multiplatform.md] 1축 — 경로 키).
 * 2. **상한** — 25건을 넘으면 오래된 것부터 밀려나야 하는데(§3.2.3 축 E), 이건 "쌓는 함수"
 *    안에서만 지켜지므로 호출부가 늘어나도 상한이 새지 않는다.
 */

import type { ClosedTabEntry } from './types.js';
import { pathKey, type PlatformName } from './pathCase.js';
import { MAX_RECENTLY_CLOSED_TABS } from './constants.js';

/**
 * 두 항목이 **같은 탭인가**의 판정 키.
 *
 * 프로젝트는 `key`(=`p:<표시명>`)가 아니라 **경로**로 접는다. 표시명은 `path.basename` 이라
 * `…/alpha/app` 과 `…/beta/app` 이 둘 다 `p:app` 이 되고, 그대로 접으면 서로 다른 두 프로젝트가
 * 스택에서 한 칸을 다투다 한쪽이 사라진다(v1.63 이 이름 PK 를 버린 바로 그 이유).
 */
export function closedTabDedupeKey(entry: ClosedTabEntry, platform: PlatformName): string {
  if (entry.kind === 'project' && entry.path) return `project:${pathKey(entry.path, platform)}`;
  return `${entry.kind}:${entry.key}`;
}

/**
 * 알 수 없는 값(디스크에서 읽은 JSON)을 항목 배열로 정규화.
 *
 * **되열 수 없는 항목은 처음부터 들이지 않는다** — 프로젝트인데 경로가 없거나 iframe 인데 주소가
 * 없으면 메뉴에는 보이는데 눌러도 아무 일이 없는 유령 항목이 된다(SSOT §3.2.3 이 반면교사로
 * 든 Claude Code #62959 "sidebar shows ghost entries that error on click" 가 그 자리다).
 */
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
  return {
    key,
    kind,
    label: label || key.slice(2),
    closedAt,
    url,
    ...(sk === 'frontend' || sk === 'backend' ? { serverKind: sk } : {}),
  };
}

/**
 * 새로 닫은 탭을 스택 맨 앞에 올린다. 항상 **새 배열**을 돌려준다(입력은 안 건드린다).
 *
 * - 같은 탭이 이미 있으면 그 옛 항목을 걷어내고 새것을 앞에 세운다 — 열었다 닫기를 반복해도
 *   목록이 같은 이름으로 도배되지 않는다.
 * - `max` 를 넘으면 **가장 오래된 것부터** 밀려난다(§3.2.3 축 E). `max <= 0` 이면 무제한.
 * - 되열 수 없는 모양이면 아무것도 하지 않는다(입력 배열을 그대로 돌려준다).
 */
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

/**
 * 스택에서 한 건을 꺼낸다(= 다시 열기).
 *
 * `key` 를 주면 그것을, 안 주면 **가장 최근에 닫은 것**을 꺼낸다(브라우저 Ctrl+Shift+T).
 * 없으면 `entry: null` + 원본 그대로 — 호출부가 "빈 스택"과 "못 찾음"을 구분할 필요가 없다.
 */
export function takeClosedTabEntry(
  list: readonly ClosedTabEntry[],
  key?: string,
): { entry: ClosedTabEntry | null; rest: ClosedTabEntry[] } {
  const at = key ? list.findIndex((e) => e.key === key) : 0;
  const found = at >= 0 ? list[at] : undefined;
  if (!found) return { entry: null, rest: [...list] };
  return { entry: found, rest: list.filter((_, i) => i !== at) };
}

/**
 * 디스크에서 사라진 프로젝트 항목을 걷어낸다(부팅 1회).
 *
 * 폴더를 지웠거나 옮긴 뒤에도 목록에 남아 있으면, 눌렀을 때 `registerProject` 가 없는 경로를
 * 유령 프로젝트로 등록한다. iframe 항목은 판정 대상이 아니다 — 주소는 지금 살아 있는지 알 수
 * 없고(서버가 꺼져 있을 수도 있다) 열어 보는 것 말고는 확인할 방법이 없다.
 */
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
