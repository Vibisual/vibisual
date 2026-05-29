import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppState, AppStatePatch } from '@vibisual/shared';
import { logger } from '../logger.js';

// v1.52: AppState = Vibisual 인스턴스 자체 상태 (어떤 프로젝트의 데이터도 아님 → 머신 단위 글로벌).
// 저장 위치 `~/.vibisual/app-state.json` (Claude Code `~/.claude/` 와 동일 패턴).
// v1.63: 식별 모델 = **정규화 절대경로(projectId)**. 과거 `path.basename` 이름 PK 는
//        같은 basename 다른 경로 프로젝트 동시 오픈 시 한 슬롯을 공유해 한쪽이 소실됐다(§3.5 위반).
//        openProjects/pinned/lastActive/default 전부 절대경로. 이름은 표시용(projectNames 캐시).
// v1.74 — `VIBISUAL_HOME` env override: AppState(=머신 단위 글로벌 `~/.vibisual/app-state.json`)
//         의 base 디렉토리만 격리한다. `~/.claude`(인증·roster)·`~/.vscode`(claude.exe 해석)는
//         그대로 실 homedir 을 쓰므로 데몬/스폰은 정상 동작. 격리 인스턴스(테스트·샌드박스)가
//         사용자의 openProjects 목록을 읽어 실 프로젝트를 stub 등록·체크포인트 덮어쓰는 누수 방지.
//         미설정 시 기존 동작(os.homedir()) 그대로.
const HOME_DIR = os.homedir();
const APP_HOME_DIR = path.join(
  (process.env['VIBISUAL_HOME'] && process.env['VIBISUAL_HOME'].trim()) || HOME_DIR,
  '.vibisual',
);
const APP_STATE_FILE = path.join(APP_HOME_DIR, 'app-state.json');

// 마이그레이션용 — 구 위치에서 1회만 끌어올림.
const LEGACY_SAVE_ROOT = path.resolve(process.cwd(), '../../save');
const LEGACY_APP_STATE_FILE = path.join(LEGACY_SAVE_ROOT, '_app-state.json');

function emptyState(): AppState {
  return {
    openProjects: [],
    lastActiveProject: null,
    defaultProject: null,
    pinnedProjects: [],
    projectNames: {},
    updatedAt: 0,
  };
}

// ─── 경로 식별 헬퍼 (projectId = 정규화 절대경로) ───

/** projectId 정규화 — forward-slash + 소문자(Windows FS 대소문자 무시) + trailing slash 제거.
 *  projectGraph.normalize 와 동일 semantics (인스턴스 Map 키와 일치). 비교·중복제거 전용. */
function normPath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}

/** 저장 포맷 정규화 — forward-slash + trailing slash 제거(원본 케이스 유지). */
function toStorePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** "절대경로처럼 보이는가" — 구 name-array(bare 이름) ↔ 신 path-array 판별용.
 *  Windows 드라이브(`C:/…`) / POSIX 루트(`/…`) / UNC(`//…`). */
function looksLikePath(s: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('/') || s.startsWith('\\\\');
}

/** 정규화 경로 기준 중복 제거 — 먼저 나온 원본 케이스를 canonical 로 유지. */
function dedupByPath(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    if (typeof raw !== 'string' || !raw) continue;
    const s = toStorePath(raw);
    const k = normPath(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** 정규화 경로 기준 포함 여부. */
function includesPath(arr: string[], p: string): boolean {
  const k = normPath(p);
  return arr.some((x) => normPath(x) === k);
}

/** 정규화 경로 기준 제거. */
function filterOutPath(arr: string[], p: string): string[] {
  const k = normPath(p);
  return arr.filter((x) => normPath(x) !== k);
}

/** projectNames 정규화 — 키도 store-path 로 정렬, 같은 정규화 키는 마지막 항목 우선. */
function normalizeProjectNames(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  const seenLower = new Map<string, string>(); // norm → canonical store-path (first)
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== 'string' || typeof v !== 'string' || !v) continue;
    const sp = toStorePath(k);
    const nk = normPath(sp);
    const canon = seenLower.get(nk) ?? sp;
    seenLower.set(nk, canon);
    out[canon] = v;
  }
  return out;
}

/** projectId(경로) → 표시 이름 (정규화 비교). 캐시에 없으면 basename 폴백. */
function lookupNameCI(names: Record<string, string> | undefined, p: string): string {
  const base = path.basename(toStorePath(p));
  if (!names) return base;
  const k = normPath(p);
  for (const [sp, nm] of Object.entries(names)) {
    if (normPath(sp) === k) return nm || base;
  }
  return base;
}

/**
 * raw 상태 정규화 + **v1.63 마이그레이션** (구 name-array → path-array).
 * 판별: openProjects 엔트리 중 하나라도 path 처럼 보이지 않으면 구 포맷으로 간주,
 * 구 `projectPaths`(name→path) 로 경로 복원. 복원 실패 엔트리는 drop(부팅 시 stale 청소).
 */
function normalize(raw: Partial<AppState> | null | undefined): AppState {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') return base;

  const rawOpen = Array.isArray(raw.openProjects) ? raw.openProjects.filter((n): n is string => typeof n === 'string') : [];
  const rawPinned = Array.isArray(raw.pinnedProjects) ? raw.pinnedProjects.filter((n): n is string => typeof n === 'string') : [];
  const legacyPaths = (raw.projectPaths && typeof raw.projectPaths === 'object') ? (raw.projectPaths as Record<string, string>) : null;

  // 구 포맷 감지 — open 엔트리가 path 가 아니고 legacy projectPaths 가 있으면 1회 변환.
  const isLegacy = rawOpen.length > 0 && rawOpen.some((e) => !looksLikePath(e)) && !!legacyPaths;

  let projectNames = normalizeProjectNames(raw.projectNames);

  const resolveLegacy = (entry: string): string | null => {
    if (looksLikePath(entry)) return toStorePath(entry);
    if (!legacyPaths) return null;
    // legacy projectPaths: name(케이스 무시) → path
    const lk = entry.toLowerCase();
    for (const [n, p] of Object.entries(legacyPaths)) {
      if (typeof p === 'string' && p && n.toLowerCase() === lk) {
        const sp = toStorePath(p);
        projectNames[sp] = entry; // 표시 이름 캐시 보존
        return sp;
      }
    }
    return null;
  };

  const mapEntries = (arr: string[]): string[] => {
    if (!isLegacy) return arr.map(toStorePath);
    const out: string[] = [];
    for (const e of arr) {
      const p = resolveLegacy(e);
      if (p) out.push(p);
    }
    return out;
  };

  const open = dedupByPath(mapEntries(rawOpen));
  const pinned = dedupByPath(mapEntries(rawPinned));
  const mapOne = (v: string | null | undefined): string | null => {
    if (typeof v !== 'string' || !v) return null;
    if (!isLegacy) return toStorePath(v);
    return resolveLegacy(v);
  };

  if (isLegacy) {
    logger.info(`AppState v1.63 migration: name-array → path-array (${open.length} project(s) recovered from projectPaths)`);
  }

  return {
    openProjects: open,
    lastActiveProject: mapOne(raw.lastActiveProject),
    defaultProject: mapOne(raw.defaultProject),
    pinnedProjects: pinned,
    projectNames,
    skillOrder: normalizeSkillOrder(raw.skillOrder),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
  };
}

/** skillOrder 정규화 — 각 type 값을 문자열 배열로 강제, 중복 제거. 둘 다 비면 undefined. */
function normalizeSkillOrder(raw: unknown): AppState['skillOrder'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { project?: unknown; plugin?: unknown };
  const clean = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const x of v) {
      if (typeof x !== 'string' || !x || seen.has(x)) continue;
      seen.add(x);
      out.push(x);
    }
    return out.length > 0 ? out : undefined;
  };
  const project = clean(r.project);
  const plugin = clean(r.plugin);
  if (!project && !plugin) return undefined;
  return {
    ...(project ? { project } : {}),
    ...(plugin ? { plugin } : {}),
  };
}

let cached: AppState | null = null;

/** 디스크에서 AppState 로드 (없거나 손상 시 빈 상태). 내부 캐시 사용.
 *  v1.52: 신규 위치 비었고 구 위치 있으면 1회 이전. v1.63: normalize 가 name→path 변환. */
export function loadAppState(): AppState {
  if (cached) return cached;
  try {
    if (!fs.existsSync(APP_STATE_FILE) && fs.existsSync(LEGACY_APP_STATE_FILE)) {
      try {
        if (!fs.existsSync(APP_HOME_DIR)) fs.mkdirSync(APP_HOME_DIR, { recursive: true });
        const legacyRaw = fs.readFileSync(LEGACY_APP_STATE_FILE, 'utf-8');
        fs.writeFileSync(APP_STATE_FILE, legacyRaw, 'utf-8');
        const bak = `${LEGACY_APP_STATE_FILE}.bak`;
        try { fs.renameSync(LEGACY_APP_STATE_FILE, bak); } catch { /* noop */ }
        logger.info(`AppState migrated: ${LEGACY_APP_STATE_FILE} → ${APP_STATE_FILE} (legacy backed up to ${bak})`);
      } catch (err) {
        logger.warn(`AppState legacy migration failed (${err instanceof Error ? err.message : String(err)}) — starting fresh`);
      }
    }
    if (!fs.existsSync(APP_STATE_FILE)) {
      cached = emptyState();
      return cached;
    }
    const raw = fs.readFileSync(APP_STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppState>;
    cached = normalize(parsed);
    return cached;
  } catch (err) {
    logger.warn(`AppState load failed (${err instanceof Error ? err.message : String(err)}) — falling back to empty state`);
    cached = emptyState();
    return cached;
  }
}

/** AppState 를 디스크에 저장 (atomic write + 캐시 갱신). projectPaths(구) 는 더는 쓰지 않음. */
export function saveAppState(state: AppState): void {
  try {
    if (!fs.existsSync(APP_HOME_DIR)) fs.mkdirSync(APP_HOME_DIR, { recursive: true });
    const normalized = normalize(state);
    const withTimestamp: AppState = { ...normalized, updatedAt: Date.now() };
    const tmp = `${APP_STATE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(withTimestamp, null, 2), 'utf-8');
    fs.renameSync(tmp, APP_STATE_FILE);
    cached = withTimestamp;
  } catch (err) {
    logger.error(`AppState save failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 부분 업데이트 helper — 현재 상태 + patch 필드 머지 후 저장.
 * 배열 필드는 치환 (클라가 전체 목록을 보냄). v1.63: 모든 값은 projectId(절대경로).
 */
export function patchAppState(patch: AppStatePatch): AppState {
  const current = loadAppState();
  const merged: AppState = {
    ...current,
    ...(patch.openProjects !== undefined ? { openProjects: dedupByPath(patch.openProjects) } : {}),
    ...(patch.pinnedProjects !== undefined ? { pinnedProjects: dedupByPath(patch.pinnedProjects) } : {}),
    ...(patch.lastActiveProject !== undefined ? { lastActiveProject: patch.lastActiveProject ? toStorePath(patch.lastActiveProject) : null } : {}),
    ...(patch.defaultProject !== undefined ? { defaultProject: patch.defaultProject ? toStorePath(patch.defaultProject) : null } : {}),
  };
  saveAppState(merged);
  return cached ?? merged;
}

/** openProjects에 프로젝트 추가 (정규화 경로 기준 중복 체크). 새로 추가/이름변경 시 true.
 *  v1.63: 식별 = projectPath(projectId). displayName 은 projectNames 캐시에 기록(표시 전용). */
export function appStateAddOpenProject(projectPath: string, displayName?: string): boolean {
  const current = loadAppState();
  const sp = toStorePath(projectPath);
  const alreadyOpen = includesPath(current.openProjects, sp);

  const names = { ...(current.projectNames ?? {}) };
  let nameChanged = false;
  if (displayName) {
    const prev = lookupNameCI(current.projectNames, sp);
    if (prev !== displayName || !includesPath(Object.keys(names), sp)) {
      // 같은 정규화 키의 기존 엔트리 제거 후 canonical store-path 로 재등록.
      for (const k of Object.keys(names)) {
        if (normPath(k) === normPath(sp)) delete names[k];
      }
      names[sp] = displayName;
      nameChanged = true;
    }
  }

  if (alreadyOpen && !nameChanged) return false;

  saveAppState({
    ...current,
    openProjects: alreadyOpen ? current.openProjects : [...current.openProjects, sp],
    projectNames: names,
  });
  return !alreadyOpen;
}

/**
 * openProjects에서 프로젝트 제거 (정규화 경로 기준). Pin/Default/LastActive도 매칭 시 해제.
 * 실제로 openProjects에서 제거됐으면 true. projectNames 캐시는 유지(재오픈 라벨).
 */
export function appStateRemoveOpenProject(projectPath: string): boolean {
  const current = loadAppState();
  const sp = toStorePath(projectPath);
  const k = normPath(sp);
  const hadOpen = includesPath(current.openProjects, sp);
  const hadPin = includesPath(current.pinnedProjects, sp);
  const lastMatch = current.lastActiveProject !== null && normPath(current.lastActiveProject) === k;
  const defaultMatch = current.defaultProject !== null && normPath(current.defaultProject) === k;
  if (!hadOpen && !hadPin && !lastMatch && !defaultMatch) {
    return false;
  }
  saveAppState({
    ...current,
    openProjects: filterOutPath(current.openProjects, sp),
    pinnedProjects: filterOutPath(current.pinnedProjects, sp),
    lastActiveProject: lastMatch ? null : current.lastActiveProject,
    defaultProject: defaultMatch ? null : current.defaultProject,
  });
  return hadOpen;
}

/** projectId(경로) → 표시 이름 조회 (정규화 비교). 캐시 미스 시 basename 폴백. */
export function appStateGetProjectName(projectPath: string): string {
  const current = loadAppState();
  return lookupNameCI(current.projectNames, projectPath);
}

/** projectNames 캐시에서 디스크에 더는 없는 경로 엔트리 제거 (부팅 1회).
 *  닫혔지만 디스크에 살아있는 프로젝트의 재오픈 라벨은 보존 — 무한 누적만 차단. */
export function appStatePruneStaleProjectNames(exists: (p: string) => boolean): number {
  const current = loadAppState();
  const names = current.projectNames ?? {};
  const next: Record<string, string> = {};
  let removed = 0;
  for (const [p, nm] of Object.entries(names)) {
    if (exists(p)) next[p] = nm;
    else removed += 1;
  }
  if (removed > 0) saveAppState({ ...current, projectNames: next });
  return removed;
}

/** §5.5 #17-4 — SkillsView 고정 순서 조회. 항상 {project,plugin} shape 보장(빈 배열 기본). */
export function appStateGetSkillOrder(): { project: string[]; plugin: string[] } {
  const current = loadAppState();
  return {
    project: current.skillOrder?.project ?? [],
    plugin: current.skillOrder?.plugin ?? [],
  };
}

/** §5.5 #17-4 — 한 type 의 고정 순서를 치환 저장 (클라가 전체 가시 순서를 보냄). */
export function appStateSetSkillOrder(type: 'project' | 'plugin', order: string[]): void {
  const current = loadAppState();
  const next = {
    project: current.skillOrder?.project ?? [],
    plugin: current.skillOrder?.plugin ?? [],
    [type]: order,
  };
  saveAppState({ ...current, skillOrder: next });
}

/** §5.5 #17-4 — 삭제된 스킬명을 고정 순서에서 제거 (project/plugin 양쪽 스캔). */
export function appStateRemoveSkillFromOrder(name: string): void {
  const current = loadAppState();
  if (!current.skillOrder) return;
  const project = (current.skillOrder.project ?? []).filter((n) => n !== name);
  const plugin = (current.skillOrder.plugin ?? []).filter((n) => n !== name);
  saveAppState({ ...current, skillOrder: { project, plugin } });
}

/** 캐시만 리셋 (테스트용). */
export function _resetAppStateCache(): void {
  cached = null;
}
