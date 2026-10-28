import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppState, AppStatePatch, RetentionSettings, KeymapOverrides, ClosedTabEntry,
  ClaudePluginAutoRefreshSettings, ClaudePluginRefreshState, TokenSaverSettings } from '@vibisual/shared';
import { APP_STATE_BACKUP_GENERATIONS, normalizeRetentionSettings, normalizeBgTaskProbeSettings,
  normalizeSessionProbeSettings, normalizeProcessGuardSettings, normalizeExternalTopBudget, normalizeKeymapOverrides,
  normalizePluginRefreshSettings, CLAUDE_PLUGIN_REFRESH_UPDATED_KEEP,
  normalizeClosedTabEntries, pushClosedTabEntry, takeClosedTabEntry, pruneMissingClosedTabs,
  normalizeIDEActivityBarPrefs,
  normalizeWebGroupSettings, WEB_GROUP_DEFAULTS,
  normalizeWebOpenTarget,
  reorderOpenProjects, PROJECT_TAB_ORDER,
  type BackgroundTaskProbeSettings,
  type ProcessGuardSettings,
  type IDEActivityBarPrefs,
  type WebGroupSettings,
  type WebOpenTarget,
  type SessionLivenessProbeSettings, normalizeTokenSaverSettings,
  normalizeApiCreditPersisted, type ApiCreditPersisted } from '@vibisual/shared';
import { atomicWriteFileSync, rotateBackups, loadFromBackups } from './statePersistence.js';
// 경로 대소문자 정책 SSOT — win32/darwin 만 접고 linux 는 접지 않는다.
import { pathKey, HOST_PLATFORM } from './pathKey.js';
import { logger } from '../logger.js';

// AppState = 머신 단위 글로벌 상태(`~/.vibisual/app-state.json`). 식별은 정규화 절대경로(projectId) — basename 을 키로 쓰면 같은 이름·다른 경로가
// 한 슬롯을 나눠 한쪽이 사라진다(§3.5). 이름은 표시용(projectNames 캐시).
// `VIBISUAL_HOME` 은 이 base 만 격리한다(`~/.claude`·`~/.vscode` 는 실 homedir) — 테스트·샌드박스가 실 openProjects 를 읽어 체크포인트를 덮지 않게.
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

/**
 * projectId 정규화(비교 전용) — `/`·끝 슬래시 제거, 대소문자를 실제로 무시하는 FS 에서만 소문자(`projectGraph.normalize` 와 같아야 한다).
 * linux 에서 무조건 접으면 `Feature-X`·`feature-x` 가 한 탭이 된다. 저장은 `toStorePath`(원본 케이스).
 */
function normPath(p: string): string {
  return pathKey(p);
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

/** 정규화 + 옛 이름 배열 → 경로 배열 이주(경로처럼 안 보이는 엔트리가 있으면 옛 `projectPaths` 로 되찾고, 못 찾으면 버린다). */
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
    skillFavorites: normalizeSkillFavorites(raw.skillFavorites),
    // §3.2.3 — 저장돼 있을 때만 실는다. 없으면 undefined 로 두어 `appStateGetRetention()` 이
    // 기본값을 내주게 한다(구버전 AppState 하위호환 + 기본값이 나중에 바뀌면 자동 추종).
    retention: raw.retention ? normalizeRetentionSettings(raw.retention) : undefined,
    // §5.3 #9-1 — 같은 규약: 저장돼 있을 때만 실어 기본값 변경을 자동 추종한다.
    tokenSaver: raw.tokenSaver ? normalizeTokenSaverSettings(raw.tokenSaver) : undefined,
    // §5.5 #17-9 ⑭(g) — 같은 규약: 저장돼 있을 때만 실어 기본값 변경을 자동 추종한다.
    bgTaskProbe: raw.bgTaskProbe ? normalizeBgTaskProbeSettings(raw.bgTaskProbe) : undefined,
    sessionProbe: raw.sessionProbe ? normalizeSessionProbeSettings(raw.sessionProbe) : undefined,
    // §5.3 #9-2 — 같은 규약: 저장돼 있을 때만 실어 기본값 변경을 자동 추종한다.
    processGuard: raw.processGuard ? normalizeProcessGuardSettings(raw.processGuard) : undefined,
    // §2.1 (B) — 같은 규약: 저장돼 있을 때만 실어 기본값 변경을 자동 추종한다.
    externalTopBudget: typeof raw.externalTopBudget === 'number'
      ? normalizeExternalTopBudget(raw.externalTopBudget)
      : undefined,
    // §5.23 접어 보기 — 같은 규약: 켜고 끈 적이 있을 때만 싣는다. 이 줄이 없으면 저장이 매번 이 칸을 떨군다.
    //   종전 설정이라 이제 읽기(이주)만 한다 — `appStateGetWebGroup` 참조.
    webFoldPerAgent: typeof raw.webFoldPerAgent === 'boolean' ? raw.webFoldPerAgent : undefined,
    // §3.6 「수명」 — 사용량 수집기 켬 여부. 없으면 첫 부팅이 settings.json 에서 옮겨 적는다(`syncUsageCollectorAtBoot`).
    usageCollector: typeof raw.usageCollector === 'boolean' ? raw.usageCollector : undefined,
    // §4 API 크레딧 — 같은 규약: 저장돼 있을 때만 싣는다. 이 줄이 없으면 저장이 매번 이 칸(키·장부 포함)을 떨군다.
    apiCredits: raw.apiCredits ? normalizeApiCreditPersisted(raw.apiCredits, Date.now()) : undefined,
    // §3.6 「수명」 · §5.25 (I) — 코덱스 전역 훅 켬 여부. 없으면 첫 부팅이 hooks.json 에서 옮겨 적는다(`syncCodexHooksAtBoot`).
    codexHooks: typeof raw.codexHooks === 'boolean' ? raw.codexHooks : undefined,
    // §5.23 웹 버블 묶기 — 같은 규약: 저장돼 있을 때만 실어 기본값 변경을 자동 추종한다.
    webGroup: raw.webGroup ? normalizeWebGroupSettings(raw.webGroup) : undefined,
    // §5.23 「더블클릭」 — 같은 규약: 고른 적이 있을 때만 싣는다. 이 줄이 없으면 저장이 매번 이 칸을 떨군다.
    webOpenTarget: raw.webOpenTarget !== undefined ? normalizeWebOpenTarget(raw.webOpenTarget) : undefined,
    // §6 — 같은 규약: **바꾼 것만** 저장돼 있고, 없으면 undefined 로 두어 코드의 기본 바인딩을
    //   따라간다(다음 판올림에서 기본값을 고치면 안 건드린 칸은 자동으로 새 값이 된다).
    keymap: raw.keymap ? normalizeKeymapOverrides(raw.keymap, process.platform) : undefined,
    // §5.5 #16-1 — 같은 규약: 만진 적 없으면 undefined 로 두어 코드의 기본 순서를 따라간다
    //   (그래야 다음 판올림에서 활동바 항목을 늘려도 안 건드린 사용자에게 그대로 나타난다).
    ideActivityBar: normalizeIDEActivityBarPrefs(raw.ideActivityBar),
    // §5.4 #14-4 — 되열 수 없는 모양(경로·주소 없음)은 여기서 걸러 낸다. 저장된 것이 없으면
    //   빈 배열이 아니라 undefined 로 둔다 — 안 그러면 한 번도 탭을 닫은 적 없는 사용자의
    //   app-state.json 에 빈 칸이 새로 생겨 매 저장이 diff 를 만든다.
    recentlyClosedTabs: raw.recentlyClosedTabs
      ? normalizeClosedTabEntries(raw.recentlyClosedTabs, HOST_PLATFORM)
      : undefined,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
  };
}

/** §5.5 #17-4 — 문자열만, 중복 제거(순서 보존). 비면 undefined. */
function normalizeSkillFavorites(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== 'string' || !x || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out.length > 0 ? out : undefined;
}

/** skillOrder 정규화 — 각 type 값을 문자열 배열로 강제, 중복 제거. 둘 다 비면 undefined. */
function normalizeSkillOrder(raw: unknown): AppState['skillOrder'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { project?: unknown; global?: unknown; plugin?: unknown };
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
  const global = clean(r.global);
  const plugin = clean(r.plugin);
  if (!project && !global && !plugin) return undefined;
  return {
    ...(project ? { project } : {}),
    ...(global ? { global } : {}),
    ...(plugin ? { plugin } : {}),
  };
}

let cached: AppState | null = null;

/** loadFromBackups 검증 — AppState 꼴(openProjects 배열 또는 projectNames 객체 보유)인지 최소 판정.
 *  구/신 포맷 모두 통과시키고(정규화는 normalize 가 담당), 완전 손상 JSON 만 걸러낸다. */
function looksLikeAppState(o: Record<string, unknown>): boolean {
  return (
    Array.isArray((o as { openProjects?: unknown }).openProjects) ||
    Array.isArray((o as { projectPaths?: unknown }).projectPaths) ||
    (typeof (o as { projectNames?: unknown }).projectNames === 'object' &&
      (o as { projectNames?: unknown }).projectNames !== null)
  );
}

/** 본 파일이 없거나 손상됐을 때 `.bak1~N` 에서 마지막으로 유효했던 AppState 를 복구.
 *  §3.2.1-4 "로드가 의심스러우면 백업으로" 를 app-state.json 에도 적용(과거엔 즉시 빈 목록 →
 *  다음 저장이 손상을 영구 확정하는 손실 경로였다). 복구 실패 시 null. */
function recoverAppStateFromBackups(): AppState | null {
  const rec = loadFromBackups<Partial<AppState>>(APP_STATE_FILE, looksLikeAppState, APP_STATE_BACKUP_GENERATIONS);
  if (!rec) return null;
  logger.warn(`AppState recovered from ${APP_STATE_FILE}.bak${rec.bakIndex} (primary missing/corrupt) — data-loss guard.`);
  return normalize(rec.data);
}

/** 로드(캐시). 파싱 실패·부재면 `.bak1~N` 부터(§3.2.1), 그래도 없으면 빈 상태. 옛 위치에만 있으면 한 번 옮긴다. */
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
      // 본 파일이 사라졌어도(크래시로 rename 미완/삭제) 백업이 있으면 목록을 살린다.
      cached = recoverAppStateFromBackups() ?? emptyState();
      return cached;
    }
    const raw = fs.readFileSync(APP_STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppState>;
    cached = normalize(parsed);
    return cached;
  } catch (err) {
    logger.warn(`AppState load failed (${err instanceof Error ? err.message : String(err)}) — trying backups before empty state`);
    cached = recoverAppStateFromBackups() ?? emptyState();
    return cached;
  }
}

/** §3.2.1 손실방지 — 다세대 백업 롤링 → 원자적 쓰기(tmp+fsync+rename) + 디렉토리 fsync. 옛 `projectPaths` 는 쓰지 않는다. */
export function saveAppState(state: AppState): void {
  try {
    if (!fs.existsSync(APP_HOME_DIR)) fs.mkdirSync(APP_HOME_DIR, { recursive: true });
    const normalized = normalize(state);
    const withTimestamp: AppState = { ...normalized, updatedAt: Date.now() };
    // 저장 직전 기존 파일을 .bak1~N 으로 회전 보관(빈/손상 목록으로 덮이기 전 세대를 남긴다).
    rotateBackups(APP_STATE_FILE, APP_STATE_BACKUP_GENERATIONS);
    atomicWriteFileSync(APP_STATE_FILE, JSON.stringify(withTimestamp, null, 2));
    cached = withTimestamp;
    retentionMemo = null; // 다른 경로가 상태를 통째로 갈아끼웠을 수 있다 — 다음 조회 때 다시 만든다.
    tokenSaverMemo = null; // §5.3 #9-1 — 같은 이유로 함께 비운다(한쪽만 비우면 설정이 어긋난다).
    bgTaskProbeMemo = null; // 같은 이유 — 두 메모가 갈리면 한쪽만 옛 값을 들고 판정한다.
    sessionProbeMemo = null; // 같은 이유 — 세션 판정 설정도 같은 창구를 탄다.
    processGuardMemo = null; // 같은 이유 — 자손 프로세스 보호(§5.3 #9-2)도 같은 창구를 탄다.
    externalTopBudgetMemo = null; // 같은 이유 — 외부 폴더 예산(§2.1 (B))도 같은 창구를 탄다.
    webGroupMemo = null; // 같은 이유 — 웹 버블 묶기(§5.23)도 같은 창구를 탄다.
    webOpenTargetMemo = null; // 같은 이유 — 웹 버블 더블클릭이 여는 곳(§5.23)도 같은 창구를 탄다.
    keymapMemo = null; // 같은 이유 — 단축키(§6)도 같은 창구를 탄다.
    ideActivityBarMemo = null; // 같은 이유 — 활동바 구성(§5.5 #16-1)도 같은 창구를 탄다.
  } catch (err) {
    logger.error(`AppState save failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** patch 를 머지해 저장. 배열 필드는 치환(클라가 전체 목록을 보낸다). 프로젝트 값은 projectId(절대경로). */
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

// 보존 정책(§3.2.3) — 판정은 여기 하나. `recordFileEdit` 같은 뜨거운 경로에서도 불려 정규화 결과를 메모한다.

let retentionMemo: RetentionSettings | null = null;

/**
 * 현재 보존 설정. 저장된 값이 없으면 `DEFAULT_RETENTION_SETTINGS`.
 * ⚠ 값 `0` 은 "그 축은 정리하지 않음"이라 호출부에서 그대로 존중해야 한다(`isExpiredByDays` 참고).
 */
export function appStateGetRetention(): RetentionSettings {
  if (retentionMemo) return retentionMemo;
  retentionMemo = normalizeRetentionSettings(loadAppState().retention);
  return retentionMemo;
}

/** 보존 설정 부분 갱신 → 정규화 후 저장. 반환은 저장된 최종본. */
export function appStateSetRetention(patch: Partial<RetentionSettings>): RetentionSettings {
  const merged = normalizeRetentionSettings({ ...appStateGetRetention(), ...patch });
  const current = loadAppState();
  saveAppState({ ...current, retention: merged });
  retentionMemo = merged; // saveAppState 가 방금 비운 메모를 확정값으로 다시 채운다.
  return merged;
}

// 토큰 절약(§5.3 #9-1) — 보존 정책처럼 머신 단위·판정 한 곳·스폰마다 불려 메모한다.

let tokenSaverMemo: TokenSaverSettings | null = null;

/** §5.3 #9-1 — 없으면 `DEFAULT_TOKEN_SAVER_SETTINGS`(전 축 끔). ⚠ 숫자 축 `0` 은 상한이 아니라 끔이다(`buildTokenSaverEnv` 는 env 키를 안 만든다). */
export function appStateGetTokenSaver(): TokenSaverSettings {
  if (tokenSaverMemo) return tokenSaverMemo;
  tokenSaverMemo = normalizeTokenSaverSettings(loadAppState().tokenSaver);
  return tokenSaverMemo;
}

/** 토큰 절약 설정 부분 갱신 → 정규화 후 저장. 반환은 저장된 최종본(`preset` 은 값에서 재판정된다). */
export function appStateSetTokenSaver(patch: Partial<TokenSaverSettings>): TokenSaverSettings {
  const merged = normalizeTokenSaverSettings({ ...appStateGetTokenSaver(), ...patch });
  const current = loadAppState();
  saveAppState({ ...current, tokenSaver: merged });
  tokenSaverMemo = merged; // saveAppState 가 방금 비운 메모를 확정값으로 다시 채운다.
  return merged;
}

let bgTaskProbeMemo: BackgroundTaskProbeSettings | null = null;

/**
 * §5.5 #17-9 ⑭(g) — 표식 없이 조용한 백그라운드 작업을 스스로 판정할지.
 * 저장된 값이 없으면 `DEFAULT_BG_TASK_PROBE_SETTINGS`. `quietMinutes: 0` 은 "끔"이다.
 */
export function appStateGetBgTaskProbe(): BackgroundTaskProbeSettings {
  if (bgTaskProbeMemo) return bgTaskProbeMemo;
  bgTaskProbeMemo = normalizeBgTaskProbeSettings(loadAppState().bgTaskProbe);
  return bgTaskProbeMemo;
}

/** 판정 설정 부분 갱신 → 정규화 후 저장. 반환은 저장된 최종본. */
export function appStateSetBgTaskProbe(
  patch: Partial<BackgroundTaskProbeSettings>,
): BackgroundTaskProbeSettings {
  const merged = normalizeBgTaskProbeSettings({ ...appStateGetBgTaskProbe(), ...patch });
  const current = loadAppState();
  saveAppState({ ...current, bgTaskProbe: merged });
  bgTaskProbeMemo = merged; // saveAppState 가 방금 비운 메모를 확정값으로 다시 채운다.
  return merged;
}

let sessionProbeMemo: SessionLivenessProbeSettings | null = null;

/**
 * §2.4 — "실행중…"이 진짜인지 에이전트에게 물어 확인할지.
 * 저장된 값이 없으면 `DEFAULT_SESSION_PROBE_SETTINGS`.
 */
export function appStateGetSessionProbe(): SessionLivenessProbeSettings {
  if (sessionProbeMemo) return sessionProbeMemo;
  sessionProbeMemo = normalizeSessionProbeSettings(loadAppState().sessionProbe);
  return sessionProbeMemo;
}

/** 세션 판정 설정 부분 갱신 → 정규화 후 저장. 반환은 저장된 최종본. */
export function appStateSetSessionProbe(
  patch: Partial<SessionLivenessProbeSettings>,
): SessionLivenessProbeSettings {
  const merged = normalizeSessionProbeSettings({ ...appStateGetSessionProbe(), ...patch });
  const current = loadAppState();
  saveAppState({ ...current, sessionProbe: merged });
  sessionProbeMemo = merged; // saveAppState 가 방금 비운 메모를 확정값으로 다시 채운다.
  return merged;
}

let processGuardMemo: ProcessGuardSettings | null = null;

/**
 * §5.3 #9-2 — 에이전트가 띄운 프로세스의 묶음·메모리 상한·정리.
 * 저장된 값이 없으면 `DEFAULT_PROCESS_GUARD_SETTINGS`(켬).
 */
export function appStateGetProcessGuard(): ProcessGuardSettings {
  if (processGuardMemo) return processGuardMemo;
  processGuardMemo = normalizeProcessGuardSettings(loadAppState().processGuard);
  return processGuardMemo;
}

/** 보호 설정 부분 갱신 → 정규화 후 저장. 반환은 저장된 최종본. */
export function appStateSetProcessGuard(patch: Partial<ProcessGuardSettings>): ProcessGuardSettings {
  const merged = normalizeProcessGuardSettings({ ...appStateGetProcessGuard(), ...patch });
  const current = loadAppState();
  saveAppState({ ...current, processGuard: merged });
  processGuardMemo = merged; // saveAppState 가 방금 비운 메모를 확정값으로 다시 채운다.
  return merged;
}

/**
 * §4 API 크레딧 — 서버 **밖으로** 내보내는 AppState. 크레딧 칸(암호화된 키·키링 없는 환경의 원문 키·장부)은 뺀다.
 * 스냅샷은 모바일 웹 접속(LAN)에도 실리므로 키는 어떤 모양으로도 나가면 안 된다. 화면이 쓰는 크레딧 값은
 * `GraphSnapshot.apiCredits`(키 본문 없음)로만 간다. **AppState 를 응답·스냅샷에 싣는 자리는 전부 이 함수를 지난다.**
 */
export function publicAppState(state: AppState): AppState {
  if (state.apiCredits === undefined) return state;
  const { apiCredits: _private, ...rest } = state;
  return rest;
}

// API 크레딧(§4) — 설정·감싼 두 키·Anthropic 거절 기억이 한 칸에(금액 없음 — Console 이 센다). 판정·암호화는 `apiCreditService`, 여기는 저장만.

/** 저장된 크레딧 칸. 없으면 빈 객체(= 기능 꺼짐·키 없음). */
export function appStateGetApiCredits(): ApiCreditPersisted {
  return loadAppState().apiCredits ?? {};
}

/** 크레딧 칸을 통째로 갈아 끼운다(호출부가 완성본을 만든다 — 부분 머지는 키·장부를 잃기 쉽다). */
export function appStateSetApiCredits(next: ApiCreditPersisted): void {
  const current = loadAppState();
  saveAppState({ ...current, apiCredits: next });
}

/**
 * §3.6 「수명」 · §5.7 #24-3 — 사용량 수집기(`statusLine`) 켬 여부(머신 단위). 저장된 적 없으면 `undefined` — 첫 부팅이 settings.json 실태로
 * 옮겨 적는다(`syncUsageCollectorAtBoot`).
 */
export function appStateGetUsageCollector(): boolean | undefined {
  const value = loadAppState().usageCollector;
  return typeof value === 'boolean' ? value : undefined;
}

/** 사용량 수집기 켬 여부 저장. 같은 값이면 쓰지 않는다. */
export function appStateSetUsageCollector(enabled: boolean): void {
  const current = loadAppState();
  if (current.usageCollector === enabled) return;
  saveAppState({ ...current, usageCollector: enabled });
}

/** §3.6 「수명」 · §5.25 (I) — 코덱스 전역 훅 켬 여부. 같은 규약: 저장된 적 없으면 `undefined`, 첫 부팅이 `hooks.json` 실태로 옮겨 적는다(`syncCodexHooksAtBoot`). */
export function appStateGetCodexHooks(): boolean | undefined {
  const value = loadAppState().codexHooks;
  return typeof value === 'boolean' ? value : undefined;
}

/** 코덱스 전역 훅 켬 여부 저장. 같은 값이면 쓰지 않는다. */
export function appStateSetCodexHooks(enabled: boolean): void {
  const current = loadAppState();
  if (current.codexHooks === enabled) return;
  saveAppState({ ...current, codexHooks: enabled });
}

let externalTopBudgetMemo: number | null = null;

/** §2.1 (B) — 최상위에 동시에 세울 외부 폴더 예산(머신 단위). 없거나 범위 밖이면 `normalizeExternalTopBudget` 이 접는다. */
export function appStateGetExternalTopBudget(): number {
  if (externalTopBudgetMemo !== null) return externalTopBudgetMemo;
  externalTopBudgetMemo = normalizeExternalTopBudget(loadAppState().externalTopBudget);
  return externalTopBudgetMemo;
}

/** 예산 갱신 → 정규화 후 저장. 반환은 저장된 최종본(클램프된 값일 수 있다). */
export function appStateSetExternalTopBudget(value: unknown): number {
  const next = normalizeExternalTopBudget(value);
  const current = loadAppState();
  saveAppState({ ...current, externalTopBudget: next });
  externalTopBudgetMemo = next; // saveAppState 가 방금 비운 메모를 확정값으로 다시 채운다.
  return next;
}

let webGroupMemo: WebGroupSettings | null = null;

/** §5.23 웹 버블 묶기(머신 단위). 없으면 `WEB_GROUP_DEFAULTS`. 이주 — 묶기를 저장한 적 없고 옛 `webFoldPerAgent: true` 면 최대 1개로 읽는다. */
export function appStateGetWebGroup(): WebGroupSettings {
  if (webGroupMemo !== null) return { ...webGroupMemo };
  const state = loadAppState();
  webGroupMemo = state.webGroup
    ? normalizeWebGroupSettings(state.webGroup)
    : state.webFoldPerAgent === true
      ? { ...WEB_GROUP_DEFAULTS, maxPerAgent: 1 }
      : { ...WEB_GROUP_DEFAULTS };
  return { ...webGroupMemo };
}

/**
 * 묶기 설정 저장. **준 칸만 바꾼다** — 빠진 칸은 지금 값을 지킨다(부분 페이로드가 나머지를 기본값으로 덮지 않게).
 * 정규화는 shared 한 곳. 반환은 저장된 최종본(범위로 접힌 값일 수 있다).
 */
export function appStateSetWebGroup(value: unknown): WebGroupSettings {
  const patch = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const next = normalizeWebGroupSettings({ ...appStateGetWebGroup(), ...patch });
  const current = loadAppState();
  saveAppState({ ...current, webGroup: next });
  webGroupMemo = next; // saveAppState 가 방금 비운 메모를 확정값으로 다시 채운다.
  return { ...next };
}

let webOpenTargetMemo: WebOpenTarget | null = null;

/** §5.23 「더블클릭」 — 도메인 버블 더블클릭이 여는 곳(머신 단위). 없으면 바깥 브라우저. */
export function appStateGetWebOpenTarget(): WebOpenTarget {
  if (webOpenTargetMemo !== null) return webOpenTargetMemo;
  webOpenTargetMemo = normalizeWebOpenTarget(loadAppState().webOpenTarget);
  return webOpenTargetMemo;
}

/** 여는 곳 저장 → 정규화(모르는 값은 기본값) 후 저장. 반환은 저장된 최종본. */
export function appStateSetWebOpenTarget(value: unknown): WebOpenTarget {
  const next = normalizeWebOpenTarget(value);
  const current = loadAppState();
  saveAppState({ ...current, webOpenTarget: next });
  webOpenTargetMemo = next; // saveAppState 가 방금 비운 메모를 확정값으로 다시 채운다.
  return next;
}

let keymapMemo: KeymapOverrides | null = null;

/** §6 — 사용자가 바꾼 단축키만(머신 단위). 없으면 빈 객체 = 전부 기본. */
export function appStateGetKeymap(): KeymapOverrides {
  if (keymapMemo) return keymapMemo;
  keymapMemo = normalizeKeymapOverrides(loadAppState().keymap, process.platform);
  return keymapMemo;
}

/**
 * 단축키 부분 갱신 → 정규화 후 저장. 반환은 저장된 최종본.
 *
 * ⚠ 값의 **세 가지 뜻**을 구분한다 — `string`(그 키로 바꿈) · `null`(해제, 키보드에서 내림) ·
 * `undefined`(그 칸은 이번 요청에서 언급 안 함). 셋을 뭉개면 "되돌리기"가 "해제"가 된다.
 * 기본값으로 되돌리려면 `resetKeys` 로 그 명령을 지운다.
 */
export function appStateSetKeymap(
  patch: KeymapOverrides,
  resetKeys: readonly string[] = [],
): KeymapOverrides {
  const merged: Record<string, string | null> = { ...appStateGetKeymap() };
  for (const [id, value] of Object.entries(patch)) merged[id] = value;
  for (const id of resetKeys) delete merged[id];
  const normalized = normalizeKeymapOverrides(merged, process.platform);
  const current = loadAppState();
  saveAppState({ ...current, keymap: normalized });
  keymapMemo = normalized; // saveAppState 가 방금 비운 메모를 확정값으로 다시 채운다.
  return normalized;
}

/** 전부 기본값으로. */
export function appStateResetKeymap(): KeymapOverrides {
  const current = loadAppState();
  saveAppState({ ...current, keymap: {} });
  keymapMemo = {};
  return {};
}

let ideActivityBarMemo: IDEActivityBarPrefs | null = null;

/** §5.5 #16-1 — IDE 활동바 구성(머신 단위). 만진 적 없으면 빈 객체(= 기본 순서로 전부 보임). 서버는 항목 이름을 모른다 — 문자열 배열만 정규화하고 실재 판정은 클라 정본 표(`skillOrder` 와 같은 규약). */
export function appStateGetIDEActivityBar(): IDEActivityBarPrefs {
  if (ideActivityBarMemo) return ideActivityBarMemo;
  ideActivityBarMemo = normalizeIDEActivityBarPrefs(loadAppState().ideActivityBar) ?? {};
  return ideActivityBarMemo;
}

/** `order`·`hidden` 은 언급한 칸만 치환한다 — 순서만 바꿨는데 제외 목록이 날아가면 안 된다. */
export function appStateSetIDEActivityBar(patch: {
  order?: readonly string[];
  hidden?: readonly string[];
}): IDEActivityBarPrefs {
  const current = appStateGetIDEActivityBar();
  const merged = {
    order: patch.order !== undefined ? [...patch.order] : (current.order ?? []),
    hidden: patch.hidden !== undefined ? [...patch.hidden] : (current.hidden ?? []),
  };
  const normalized = normalizeIDEActivityBarPrefs(merged) ?? {};
  const state = loadAppState();
  saveAppState({ ...state, ideActivityBar: normalized });
  ideActivityBarMemo = normalized; // saveAppState 가 방금 비운 메모를 확정값으로 다시 채운다.
  return normalized;
}

/** 활동바를 코드의 기본 배치로 되돌린다(순서·제외 둘 다). */
export function appStateResetIDEActivityBar(): IDEActivityBarPrefs {
  const state = loadAppState();
  saveAppState({ ...state, ideActivityBar: undefined });
  ideActivityBarMemo = {};
  return {};
}

/** 정규화 경로로 중복 체크. 새로 추가·이름 변경 시 true. displayName 은 projectNames 캐시(표시 전용). */
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

/**
 * §5.4 #14-2 (C-1) — 탭 순서 = `openProjects` 배열 순서. 목록은 치환하지 않고 순서만 바꾼다 — 보낸 경로가 차지한 자리에만 되꽂고, 안 보낸 것
 * (별창 탭·그 사이 연 프로젝트)은 제자리, 안 열린 경로는 버린다. 옛 목록으로 통째 덮으면 그 사이 연 프로젝트가 다음 부팅에 사라진다. 바뀐 때만 저장·`true`.
 */
export function appStateReorderOpenProjects(order: readonly string[]): boolean {
  const current = loadAppState();
  const next = reorderOpenProjects(
    current.openProjects,
    order.slice(0, PROJECT_TAB_ORDER.maxEntries),
    HOST_PLATFORM,
  );
  if (next.every((p, i) => p === current.openProjects[i])) return false;
  saveAppState({ ...current, openProjects: next });
  return true;
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

// §5.4 #14-4 닫은 탭 스택의 유일한 창구(쌓는 규칙은 shared 순수 함수). `patchAppState` 로 통째 덮는 길을 열지 마라 — 부분 페이로드가 목록을 날린다.

/** 지금 스택. 저장된 것이 없으면 빈 배열. */
export function appStateGetClosedTabs(): ClosedTabEntry[] {
  return loadAppState().recentlyClosedTabs ?? [];
}

/** 닫은 탭 한 건을 스택 맨 앞에 올린다. 실제로 바뀌었으면 저장하고 최종본을 돌려준다. */
export function appStatePushClosedTab(entry: ClosedTabEntry): ClosedTabEntry[] {
  const current = loadAppState();
  const next = pushClosedTabEntry(current.recentlyClosedTabs ?? [], entry, HOST_PLATFORM);
  saveAppState({ ...current, recentlyClosedTabs: next });
  return next;
}

/** 스택에서 한 건을 꺼낸다(`key` 가 없으면 가장 최근 것). 꺼내기 = 지우기(한 동작). 따로 하면 그 사이 죽었을 때 이미 열린 탭이 목록에 남아 눌러도 아무 일 없는 항목이 된다. */
export function appStateTakeClosedTab(key?: string): ClosedTabEntry | null {
  const current = loadAppState();
  const { entry, rest } = takeClosedTabEntry(current.recentlyClosedTabs ?? [], key);
  if (!entry) return null;
  saveAppState({ ...current, recentlyClosedTabs: rest });
  return entry;
}

/** 스택을 비운다(메뉴의 "목록 지우기"). 지운 건수를 돌려준다. */
export function appStateClearClosedTabs(): number {
  const current = loadAppState();
  const had = (current.recentlyClosedTabs ?? []).length;
  if (had === 0) return 0;
  saveAppState({ ...current, recentlyClosedTabs: [] });
  return had;
}

/** 부팅 1회, 사라진 프로젝트 항목을 걷는다(`appStatePruneStaleProjectNames` 와 짝) — 안 하면 누를 때 `registerProject` 가 유령 프로젝트를 등록한다(§3.2.3). */
export function appStatePruneMissingClosedTabs(exists: (p: string) => boolean): number {
  const current = loadAppState();
  const list = current.recentlyClosedTabs ?? [];
  if (list.length === 0) return 0;
  const { kept, removed } = pruneMissingClosedTabs(list, exists);
  if (removed > 0) saveAppState({ ...current, recentlyClosedTabs: kept });
  return removed;
}

/** §5.5 #17-4/#17-5 — SkillsView 고정 순서 조회. 항상 {project,global,plugin} shape 보장(빈 배열 기본). */
export function appStateGetSkillOrder(): { project: string[]; global: string[]; plugin: string[] } {
  const current = loadAppState();
  return {
    project: current.skillOrder?.project ?? [],
    global: current.skillOrder?.global ?? [],
    plugin: current.skillOrder?.plugin ?? [],
  };
}

/** §5.5 #17-4/#17-5 — 한 type 의 고정 순서를 치환 저장 (클라가 전체 가시 순서를 보냄). */
export function appStateSetSkillOrder(type: 'project' | 'global' | 'plugin', order: string[]): void {
  const current = loadAppState();
  const next = {
    project: current.skillOrder?.project ?? [],
    global: current.skillOrder?.global ?? [],
    plugin: current.skillOrder?.plugin ?? [],
    [type]: order,
  };
  saveAppState({ ...current, skillOrder: next });
}

/** §5.5 #17-4/#17-5 — 삭제된 스킬명을 고정 순서·즐겨찾기에서 제거 (project/global/plugin 모두 스캔). */
export function appStateRemoveSkillFromOrder(name: string): void {
  const current = loadAppState();
  const favorites = (current.skillFavorites ?? []).filter((n) => n !== name);
  const nextFavorites = favorites.length > 0 ? favorites : undefined;
  if (!current.skillOrder) {
    if ((current.skillFavorites ?? []).length !== favorites.length) {
      saveAppState({ ...current, skillFavorites: nextFavorites });
    }
    return;
  }
  const project = (current.skillOrder.project ?? []).filter((n) => n !== name);
  const global = (current.skillOrder.global ?? []).filter((n) => n !== name);
  const plugin = (current.skillOrder.plugin ?? []).filter((n) => n !== name);
  saveAppState({ ...current, skillOrder: { project, global, plugin }, skillFavorites: nextFavorites });
}

/** §5.5 #17-4 — SkillsView 즐겨찾기(없으면 빈 배열). */
export function appStateGetSkillFavorites(): string[] {
  const current = loadAppState();
  return current.skillFavorites ?? [];
}

/** §5.5 #17-4 — 전체 치환(클라가 별 누른 순서대로 전체를 보낸다). */
export function appStateSetSkillFavorites(favorites: string[]): void {
  const current = loadAppState();
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const x of favorites) {
    if (typeof x !== 'string' || !x || seen.has(x)) continue;
    seen.add(x);
    clean.push(x);
  }
  saveAppState({ ...current, skillFavorites: clean.length > 0 ? clean : undefined });
}

// ─── §5.5 #17-33 ⑦ — Claude Code 플러그인 자동 갱신 (머신 단위) ───

/** 설정은 늘 정규화해서 준다. 머신 단위 — 마켓 클론(`~/.claude/plugins`)은 하나뿐이다. */
export function appStateGetClaudePluginRefresh(): Required<Pick<ClaudePluginRefreshState, 'settings'>> & ClaudePluginRefreshState {
  const current = loadAppState();
  const raw = current.claudePluginRefresh ?? {};
  return { ...raw, settings: normalizePluginRefreshSettings(raw.settings) };
}

/** 넘긴 칸만 바꾼다 — 시각만 찍는 호출이 설정을 지우면 끈 것이 되살아난다(§5.5 #12-1 부분 페이로드 강등). `lastError` 는 `null` 로 지운다. */
export function appStateSetClaudePluginRefresh(patch: {
  settings?: ClaudePluginAutoRefreshSettings;
  lastMarketAt?: number;
  lastPluginAt?: number;
  lastUpdatedIds?: string[];
  lastError?: string | null;
}): void {
  const current = loadAppState();
  const prev = current.claudePluginRefresh ?? {};
  const next: ClaudePluginRefreshState = { ...prev };
  if (patch.settings) next.settings = normalizePluginRefreshSettings(patch.settings);
  if (typeof patch.lastMarketAt === 'number') next.lastMarketAt = patch.lastMarketAt;
  if (typeof patch.lastPluginAt === 'number') next.lastPluginAt = patch.lastPluginAt;
  if (patch.lastUpdatedIds) {
    next.lastUpdatedIds = patch.lastUpdatedIds.slice(0, CLAUDE_PLUGIN_REFRESH_UPDATED_KEEP);
  }
  if (patch.lastError === null) delete next.lastError;
  else if (typeof patch.lastError === 'string') next.lastError = patch.lastError.slice(0, 400);
  saveAppState({ ...current, claudePluginRefresh: next });
}

/** 캐시만 리셋 (테스트용). */
export function _resetAppStateCache(): void {
  cached = null;
}
