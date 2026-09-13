import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppState, AppStatePatch, RetentionSettings, KeymapOverrides, ClosedTabEntry,
  ClaudePluginAutoRefreshSettings, ClaudePluginRefreshState, TokenSaverSettings } from '@vibisual/shared';
import { APP_STATE_BACKUP_GENERATIONS, normalizeRetentionSettings, normalizeBgTaskProbeSettings,
  normalizeSessionProbeSettings, normalizeExternalTopBudget, normalizeKeymapOverrides,
  normalizePluginRefreshSettings, CLAUDE_PLUGIN_REFRESH_UPDATED_KEEP,
  normalizeClosedTabEntries, pushClosedTabEntry, takeClosedTabEntry, pruneMissingClosedTabs,
  normalizeIDEActivityBarPrefs,
  type BackgroundTaskProbeSettings,
  type IDEActivityBarPrefs,
  type SessionLivenessProbeSettings, normalizeTokenSaverSettings } from '@vibisual/shared';
import { atomicWriteFileSync, rotateBackups, loadFromBackups } from './statePersistence.js';
// 경로 대소문자 정책 SSOT — win32/darwin 만 접고 linux 는 접지 않는다.
import { pathKey, HOST_PLATFORM } from './pathKey.js';
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

/** projectId 정규화 — forward-slash + trailing slash 제거 + **대소문자를 실제로 무시하는 FS 에서만** 소문자.
 *  projectGraph.normalize 와 동일 semantics (인스턴스 Map 키와 일치). 비교·중복제거 전용.
 *  linux 에서 무조건 접으면 `Feature-X` 와 `feature-x` 두 프로젝트가 한 탭으로 뭉개진다.
 *  저장 포맷은 `toStorePath`(원본 케이스 유지)라 이 변경으로 잃는 저장분은 없다. */
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
    skillFavorites: normalizeSkillFavorites(raw.skillFavorites),
    // §3.2.3 — 저장돼 있을 때만 실는다. 없으면 undefined 로 두어 `appStateGetRetention()` 이
    // 기본값을 내주게 한다(구버전 AppState 하위호환 + 기본값이 나중에 바뀌면 자동 추종).
    retention: raw.retention ? normalizeRetentionSettings(raw.retention) : undefined,
    // §5.3 #9-1 — 같은 규약: 저장돼 있을 때만 실어 기본값 변경을 자동 추종한다.
    tokenSaver: raw.tokenSaver ? normalizeTokenSaverSettings(raw.tokenSaver) : undefined,
    // §5.5 #17-9 ⑭(g) — 같은 규약: 저장돼 있을 때만 실어 기본값 변경을 자동 추종한다.
    bgTaskProbe: raw.bgTaskProbe ? normalizeBgTaskProbeSettings(raw.bgTaskProbe) : undefined,
    sessionProbe: raw.sessionProbe ? normalizeSessionProbeSettings(raw.sessionProbe) : undefined,
    // §2.1 (B) — 같은 규약: 저장돼 있을 때만 실어 기본값 변경을 자동 추종한다.
    externalTopBudget: typeof raw.externalTopBudget === 'number'
      ? normalizeExternalTopBudget(raw.externalTopBudget)
      : undefined,
    // §6 — 같은 규약: **바꾼 것만** 저장돼 있고, 없으면 undefined 로 두어 코드의 기본 바인딩을
    //   따라간다(다음 판올림에서 기본값을 고치면 안 건드린 칸은 자동으로 새 값이 된다).
    keymap: raw.keymap ? normalizeKeymapOverrides(raw.keymap) : undefined,
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

/** §5.5 #17-4 v2.93 — skillFavorites 정규화 — 문자열만, 중복 제거(순서 보존). 비면 undefined. */
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

/** 디스크에서 AppState 로드 (없거나 손상 시 백업 복구 → 그래도 없으면 빈 상태). 내부 캐시 사용.
 *  v1.52: 신규 위치 비었고 구 위치 있으면 1회 이전. v1.63: normalize 가 name→path 변환.
 *  v3.29: §3.2.1 손실방지 — 파싱 실패/파일 부재 시 `.bak1~N` 복구를 먼저 시도. */
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

/** AppState 를 디스크에 저장. §3.2.1 v3.29 — checkpoint 와 동일한 손실방지 인프라 적용:
 *  다세대 백업 롤링 → 원자적 쓰기(tmp+fsync+rename)+디렉토리 fsync. projectPaths(구) 는 더는 쓰지 않음. */
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
    externalTopBudgetMemo = null; // 같은 이유 — 외부 폴더 예산(§2.1 (B))도 같은 창구를 탄다.
    keymapMemo = null; // 같은 이유 — 단축키(§6)도 같은 창구를 탄다.
    ideActivityBarMemo = null; // 같은 이유 — 활동바 구성(§5.5 #16-1)도 같은 창구를 탄다.
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

// ─── 보존 정책 (§3.2.3) ───
//
// 판정은 **여기 하나**를 통과한다. `recordFileEdit` 처럼 뜨거운 경로에서도 불리므로
// 정규화 결과를 메모해 둔다(`loadAppState` 자체는 이미 in-memory 캐시라 싸다).

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

// ─── 토큰 절약 (§5.3 #9-1) ───
//
// 보존 정책과 같은 결이다 — **머신 단위**라 여기 살고, 판정은 여기 하나를 통과하며, 스폰마다
// 불리므로 정규화 결과를 메모해 둔다. 다른 점은 대상이 디스크가 아니라 **스폰 정책**이라는 것뿐.

let tokenSaverMemo: TokenSaverSettings | null = null;

/**
 * §5.3 #9-1 — 현재 토큰 절약 설정. 저장된 값이 없으면 `DEFAULT_TOKEN_SAVER_SETTINGS`(전 축 끔).
 *
 * ⚠ 숫자 축의 `0` 은 상한이 아니라 **"그 축을 끔"** 이다 — 호출부가 그대로 존중해야 한다
 * (`buildTokenSaverEnv` 는 0 이면 env 키 자체를 만들지 않는다).
 */
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

let externalTopBudgetMemo: number | null = null;

/**
 * §2.1 (B) — 최상위에 동시에 세울 **외부 폴더 예산**.
 *
 * 위 설정들과 같은 이유로 **머신 단위**다(어느 프로젝트를 열든 같은 화면 밀도여야 한다).
 * 저장된 값이 없거나 범위를 벗어나면 `normalizeExternalTopBudget` 이 기본값·경계로 접는다.
 */
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

let keymapMemo: KeymapOverrides | null = null;

/**
 * §6 — 사용자가 바꾼 단축키만. 저장된 값이 없으면 빈 객체(= 전부 기본 바인딩).
 *
 * 위 설정들과 같은 이유로 **머신 단위**다 — 손에 익은 키가 프로젝트마다 달라질 이유가 없다.
 */
export function appStateGetKeymap(): KeymapOverrides {
  if (keymapMemo) return keymapMemo;
  keymapMemo = normalizeKeymapOverrides(loadAppState().keymap);
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
  const normalized = normalizeKeymapOverrides(merged);
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

/**
 * §5.5 #16-1 — IDE 활동바 구성. 만진 적 없으면 빈 객체(= 코드의 기본 순서 그대로 전부 보임).
 *
 * 단축키와 같은 이유로 **머신 단위**다 — 활동바는 프로젝트의 것이 아니라 그 사람이 손에 익힌
 * 자리다. **서버는 항목 이름을 모른다**: 여기서 하는 일은 문자열 배열을 정규화해 들고 있는 것뿐이고,
 * 무엇이 실재하는 뷰인지는 클라의 정본 표가 판정한다(`skillOrder` 와 같은 규약).
 */
export function appStateGetIDEActivityBar(): IDEActivityBarPrefs {
  if (ideActivityBarMemo) return ideActivityBarMemo;
  ideActivityBarMemo = normalizeIDEActivityBarPrefs(loadAppState().ideActivityBar) ?? {};
  return ideActivityBarMemo;
}

/**
 * 활동바 구성 부분 갱신 → 정규화 후 저장. 반환은 저장된 최종본.
 *
 * `order`·`hidden` 은 **언급한 칸만** 치환한다(둘은 서로 다른 축이라, 순서를 바꿨다고 제외
 * 목록이 함께 날아가면 안 된다 — `keymap` 의 `undefined` = "이번 요청에서 언급 안 함"과 같은 뜻).
 */
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

// ─── §5.4 #14-4 "닫은 탭 다시 열기" 스택 ───
//
// 여기가 **유일한 창구**다. 목록을 쌓는 규칙(중복 접기·상한·최신이 앞)은 shared 의 순수 함수가
// 쥐고 있고, 이 층은 그것을 디스크에 앉히기만 한다 — `patchAppState` 로 통째 덮어쓰는 길을
// 열어 두지 않은 이유이기도 하다(부분 페이로드가 목록을 통째로 날리는 사고를 원천 차단).

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

/**
 * 스택에서 한 건을 꺼낸다(= 다시 열기). `key` 를 안 주면 가장 최근 것.
 *
 * **꺼내는 것과 지우는 것이 한 동작**이다 — 되열고 나서 따로 지우게 하면 그 사이에 앱이 죽었을 때
 * 이미 열려 있는 탭이 목록에도 남아, 다시 눌러도 아무 일이 없는 항목이 된다.
 */
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

/**
 * 디스크에서 사라진 프로젝트 항목을 걷어낸다(부팅 1회 — `appStatePruneStaleProjectNames` 와 짝).
 *
 * 이걸 안 하면 폴더를 지운 뒤에도 메뉴에 이름이 남고, 누르면 `registerProject` 가 없는 경로를
 * 유령 프로젝트로 등록한다(§3.2.3 이 반면교사로 든 "눌리면 깨지는 유령 항목"이 그 자리다).
 */
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

/** §5.5 #17-4 v2.93 — SkillsView 즐겨찾기 목록 조회 (없으면 빈 배열). */
export function appStateGetSkillFavorites(): string[] {
  const current = loadAppState();
  return current.skillFavorites ?? [];
}

/** §5.5 #17-4 v2.93 — 즐겨찾기 목록 전체 치환 저장 (클라가 별 누른 순서대로 전체를 보냄). */
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

/**
 * 자동 갱신 상태 조회 — 설정은 항상 정규화해서 준다(구버전 AppState·손으로 고친 값 대비).
 *
 * **머신 단위**로 두는 이유: 마켓 클론(`~/.claude/plugins`)은 어느 프로젝트를 열든 하나뿐이라
 * 프로젝트마다 다른 주기를 둘 이유가 없다(`retention` 과 같은 결).
 */
export function appStateGetClaudePluginRefresh(): Required<Pick<ClaudePluginRefreshState, 'settings'>> & ClaudePluginRefreshState {
  const current = loadAppState();
  const raw = current.claudePluginRefresh ?? {};
  return { ...raw, settings: normalizePluginRefreshSettings(raw.settings) };
}

/**
 * 자동 갱신 상태를 병합 저장. **넘긴 칸만 바꾼다** — 마지막 시각을 찍는 호출이 설정을 지우면
 * 사용자가 끈 것이 되살아난다(§5.5 #12-1 agent-config 부분 페이로드가 겪은 그 강등).
 *
 * `lastError` 는 `null` 을 넘겨 지운다(성공했을 때 옛 사유가 화면에 남으면 안 된다).
 */
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
