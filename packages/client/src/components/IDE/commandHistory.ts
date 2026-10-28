/**
 * §5.5 #17-23 — 입력창 명령 히스토리(↑/↓). 보내는 순간(`addCommand`) 기록한다 — `queuedCommands` 에서 뽑으면 끝난 명령이 사라진다.
 * 키는 `agentId|sessionId`, 세션 제거 때 함께 지운다(`optimisticRemoveSubAgent` → `dropSessionCommandHistory`). `localStorage` 전용 —
 * 쓰기는 debounce + 저장 직전 디스크 병합(창끼리 안 덮게), 읽기는 모듈 캐시(구독 ❌ — 입력창이 리렌더하지 않는다). 상한은 길이·세션당 개수·전체 예산 세 겹.
 */
import { registerPersistFlush } from '../../utils/persistFlush.js';

/** 저장 포맷 버전 — 올리면 옛 값은 조용히 버려진다(히스토리는 잃어도 되는 편의 기능). */
export const HISTORY_STORE_VERSION = 2;

/** localStorage 키. */
export const COMMAND_HISTORY_STORAGE_KEY = 'vibisual:commandHistory';

/** 항목 하나의 최대 길이. 넘치면 앞부분만 보관한다(붙여넣은 로그 한 덩어리 방어). */
export const HISTORY_MAX_ENTRY_CHARS = 4000;

/** 세션 하나가 보관하는 최대 항목 수. 넘치면 가장 오래된 것부터 지운다. */
export const HISTORY_MAX_ENTRIES = 10;

/** 저장고가 기억하는 최대 세션 수. 넘치면 **가장 오래 안 쓴 세션**부터 버린다(고아 정리 안전판). */
export const HISTORY_MAX_SESSIONS = 200;

/** 저장고 전체 문자 예산. localStorage 총량(브라우저 통상 5MB)의 일부만 쓴다. */
export const HISTORY_MAX_TOTAL_CHARS = 400_000;

/** 세션 탭이 없는 메인 입력창의 키 조각 — 세션 draft 키(`agentSessionInputKey`)와 같은 규약. */
export const HISTORY_MAIN_SESSION_KEY = '__new__';

/** 히스토리 저장 키. 세션 draft 키와 같은 모양이라 눈으로 대조하기 쉽다. */
export function commandHistoryKey(agentId: string, sessionId: string | null): string {
  return `${agentId}|${sessionId ?? HISTORY_MAIN_SESSION_KEY}`;
}

/** 한 세션의 히스토리. */
export interface CommandHistoryBucket {
  /** 마지막으로 항목이 들어온 시각(ms). 저장고가 넘칠 때 버릴 순서 기준. */
  updatedAt: number;
  /** 오래된 것 → 최신 순. 마지막 원소가 "가장 최근 보낸 명령". */
  entries: string[];
}

/** 저장고 전체(직렬화 대상). 키 = `commandHistoryKey()`. */
export interface CommandHistoryStore {
  v: number;
  sessions: Record<string, CommandHistoryBucket>;
}

/** ↑/↓ 탐색 커서. `null` = 탐색 중 아님(= 지금 화면은 사용자의 draft). */
export interface HistoryNavState {
  /** 이번 탐색이 훑는 목록(prefix 필터 적용 후). 오래된 것 → 최신 순. 탐색 중엔 고정된다. */
  matches: string[];
  /** 현재 위치. */
  index: number;
  /** 탐색을 시작할 때 입력창에 있던 원문 — ↓ 로 끝까지 내려오면 이걸 되돌려 준다. */
  draft: string;
}

/** 탐색 한 걸음의 결과. */
export interface HistoryStepResult {
  /** 다음 커서(`null` = 탐색 종료 = draft 로 복귀). */
  nav: HistoryNavState | null;
  /** 입력창에 넣을 텍스트. */
  text: string;
}

export function createEmptyHistoryStore(): CommandHistoryStore {
  return { v: HISTORY_STORE_VERSION, sessions: {} };
}

export function normalizeHistoryEntry(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > HISTORY_MAX_ENTRY_CHARS ? trimmed.slice(0, HISTORY_MAX_ENTRY_CHARS) : trimmed;
}

/** 같은 명령은 옛 자리를 지우고 맨 뒤로(zsh `hist_ignore_all_dups`). 개수 상한은 오래된 것부터. */
export function pushHistoryEntry(entries: readonly string[], text: string): string[] {
  const value = normalizeHistoryEntry(text);
  if (value === null) return entries.slice();
  const next = entries.filter((e) => e !== value);
  next.push(value);
  return next.length > HISTORY_MAX_ENTRIES ? next.slice(next.length - HISTORY_MAX_ENTRIES) : next;
}

/** 여러 항목을 순서대로 추가(시드용). */
export function pushHistoryEntries(entries: readonly string[], texts: readonly string[]): string[] {
  let out = entries.slice();
  for (const t of texts) out = pushHistoryEntry(out, t);
  return out;
}

/** 세션 수 → 전체 문자 예산 순으로, 늘 오래된 쪽부터 자른다. */
export function trimHistoryStore(store: CommandHistoryStore): CommandHistoryStore {
  const ordered = Object.entries(store.sessions)
    .filter(([, b]) => b.entries.length > 0)
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, HISTORY_MAX_SESSIONS);
  const sessions: Record<string, CommandHistoryBucket> = {};
  let budget = HISTORY_MAX_TOTAL_CHARS;
  for (const [key, bucket] of ordered) {
    if (budget <= 0) break;
    const kept: string[] = [];
    for (let i = bucket.entries.length - 1; i >= 0; i--) {
      const entry = bucket.entries[i] ?? '';
      if (entry.length > budget) break;
      budget -= entry.length;
      kept.push(entry);
    }
    if (kept.length === 0) continue;
    kept.reverse();
    sessions[key] = { updatedAt: bucket.updatedAt, entries: kept };
  }
  return { v: HISTORY_STORE_VERSION, sessions };
}

/** 직렬화 문자열 → 저장고. 깨졌거나 버전이 다르면 빈 저장고(히스토리는 잃어도 되는 값). */
export function parseHistoryStore(raw: string | null | undefined): CommandHistoryStore {
  if (!raw) return createEmptyHistoryStore();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return createEmptyHistoryStore();
  }
  if (typeof parsed !== 'object' || parsed === null) return createEmptyHistoryStore();
  const obj = parsed as { v?: unknown; sessions?: unknown };
  if (obj.v !== HISTORY_STORE_VERSION) return createEmptyHistoryStore(); // v1(버블 단위)은 버린다
  if (typeof obj.sessions !== 'object' || obj.sessions === null) return createEmptyHistoryStore();
  const sessions: Record<string, CommandHistoryBucket> = {};
  for (const [key, value] of Object.entries(obj.sessions as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const bucket = value as { updatedAt?: unknown; entries?: unknown };
    if (!Array.isArray(bucket.entries)) continue;
    let entries: string[] = [];
    for (const e of bucket.entries) {
      if (typeof e === 'string') entries = pushHistoryEntry(entries, e);
    }
    if (entries.length === 0) continue;
    sessions[key] = {
      updatedAt: typeof bucket.updatedAt === 'number' && Number.isFinite(bucket.updatedAt) ? bucket.updatedAt : 0,
      entries,
    };
  }
  return trimHistoryStore({ v: HISTORY_STORE_VERSION, sessions });
}

/** `base`(디스크) 위에 `ours`(이 창)를 얹는다. ⚠ `ours` 가 지운 세션(`removed`)은 지운 채로 — 병합이 되살리면 안 된다. */
export function mergeHistoryStores(
  base: CommandHistoryStore,
  ours: CommandHistoryStore,
  removed: readonly string[] = [],
): CommandHistoryStore {
  const removedSet = new Set(removed);
  const sessions: Record<string, CommandHistoryBucket> = {};
  for (const [key, bucket] of Object.entries(base.sessions)) {
    if (removedSet.has(key)) continue;
    sessions[key] = { updatedAt: bucket.updatedAt, entries: bucket.entries.slice() };
  }
  for (const [key, bucket] of Object.entries(ours.sessions)) {
    if (removedSet.has(key)) continue;
    const prev = sessions[key];
    sessions[key] = {
      updatedAt: Math.max(prev?.updatedAt ?? 0, bucket.updatedAt),
      entries: pushHistoryEntries(prev?.entries ?? [], bucket.entries),
    };
  }
  return trimHistoryStore({ v: HISTORY_STORE_VERSION, sessions });
}

/** draft 가 있으면 그 접두사로 시작하는 명령만, 없으면 전체(↑ 무반응보다 낫다). */
export function matchHistoryEntries(entries: readonly string[], draft: string): string[] {
  const all = entries.slice();
  const prefix = draft.trim();
  if (prefix.length === 0) return all;
  const lower = prefix.toLowerCase();
  const filtered = all.filter((e) => e !== draft && e.toLowerCase().startsWith(lower));
  return filtered.length > 0 ? filtered : all;
}

/** 진입(`newest` ↑ / `oldest` ↓). 꺼낼 게 없으면 `null` — 키를 가로채지 않는다. ⚠ 진입은 방향키 두 번째 누름에서만(첫 누름은 힌트, #17-23 ⑤). */
export function beginHistory(
  entries: readonly string[],
  draft: string,
  edge: 'newest' | 'oldest',
): HistoryStepResult | null {
  const matches = matchHistoryEntries(entries, draft);
  if (matches.length === 0) return null;
  const index = edge === 'newest' ? matches.length - 1 : 0;
  return { nav: { matches, index, draft }, text: matches[index] ?? '' };
}

/** 한 걸음. `null` 이면 커서 기본 동작을 막지 마라. `next` 가 끝을 넘으면 원래 draft 로 돌아가 탐색을 끝낸다. */
export function stepHistory(nav: HistoryNavState, direction: 'prev' | 'next'): HistoryStepResult | null {
  if (direction === 'prev') {
    if (nav.index <= 0) return null; // 이미 가장 오래된 것 — 커서를 붙잡지 않는다
    const index = nav.index - 1;
    return { nav: { ...nav, index }, text: nav.matches[index] ?? '' };
  }
  const index = nav.index + 1;
  if (index >= nav.matches.length) return { nav: null, text: nav.draft };
  return { nav: { ...nav, index }, text: nav.matches[index] ?? '' };
}

/** 방향키 한 번에 대한 판정 결과(#17-23 ⑥). */
export type ArrowOutcome =
  /** 아무 것도 하지 않는다(커서 기본 동작이 이미 처리했거나, 꺼낼 게 없다). */
  | { kind: 'none' }
  /** 힌트를 내린다 — 커서가 움직였으니 "경계에서 한 번 눌렀다"는 셈은 처음부터 다시. */
  | { kind: 'clearHint' }
  /** 힌트를 띄운다 — 여기서 한 번 더 같은 방향을 누르면 히스토리로 들어간다. */
  | { kind: 'hint'; direction: 'prev' | 'next' }
  /** 입력창 텍스트를 갈아 끼운다(진입 또는 이동). */
  | { kind: 'apply'; nav: HistoryNavState | null; text: string };

/**
 * §5.5 #17-23 ⑥ — 커서 이동이 언제나 우선. `caretMoved` 는 기본 동작 후 실제로 움직였는가 — 줄바꿈으로 계산하면 워드랩된 긴 줄에서 오판한다.
 * 탐색 중이면 한 번에, 아니면 첫 누름은 힌트만·두 번째에 진입, 꺼낼 게 없으면 힌트도 없다.
 */
export function decideArrowKey(input: {
  /** 기본 동작 후 커서가 실제로 움직였는가. */
  caretMoved: boolean;
  /** 현재 탐색 커서(null = 탐색 중 아님). */
  nav: HistoryNavState | null;
  /** 지금 떠 있는 힌트 방향(null = 없음). */
  hint: 'prev' | 'next' | null;
  /** 이 세션의 히스토리. */
  entries: readonly string[];
  /** 지금 입력창 내용(진입 시 prefix 이자 ↓ 로 돌아올 자리). */
  draft: string;
  /** 누른 방향. */
  direction: 'prev' | 'next';
}): ArrowOutcome {
  if (input.caretMoved) return { kind: 'clearHint' };
  if (input.nav !== null) {
    const step = stepHistory(input.nav, input.direction);
    return step ? { kind: 'apply', nav: step.nav, text: step.text } : { kind: 'none' };
  }
  if (input.entries.length === 0) return { kind: 'none' };
  if (input.hint !== input.direction) return { kind: 'hint', direction: input.direction };
  const entered = beginHistory(input.entries, input.draft, input.direction === 'prev' ? 'newest' : 'oldest');
  return entered ? { kind: 'apply', nav: entered.nav, text: entered.text } : { kind: 'none' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 영속 계층 — 모듈 캐시 + debounce 저장. 테스트는 `setCommandHistoryStorage` 로 주입한다.
// ─────────────────────────────────────────────────────────────────────────────

/** localStorage 중 우리가 쓰는 부분만. 테스트용 대역 주입을 위해 좁게 잡는다. */
export interface HistoryStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let storageOverride: HistoryStorageLike | null | undefined;
let cache: CommandHistoryStore | null = null;
let dirty = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** 이 창에서 지운 세션 키 — 저장 직전 디스크 병합이 되살리지 못하게 기억해 둔다. */
let removedKeys = new Set<string>();
/** 저장 debounce — 세션 draft 영속화(400ms)와 같은 감각. */
const SAVE_DEBOUNCE_MS = 400;

function getStorage(): HistoryStorageLike | null {
  if (storageOverride !== undefined) return storageOverride;
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null; // 프라이버시 모드·샌드박스에서 접근 자체가 던지는 경우
  }
}

/** 테스트/특수 환경용 저장소 주입. `null` = 영속화 없음(메모리 전용). */
export function setCommandHistoryStorage(storage: HistoryStorageLike | null | undefined): void {
  flushCommandHistory();
  storageOverride = storage;
  cache = null;
  dirty = false;
  removedKeys = new Set();
}

/** 캐시 폐기 — 다음 읽기에서 저장소를 다시 읽는다(다른 창이 고쳤을 때). */
export function resetCommandHistoryCache(): void {
  cache = null;
  dirty = false;
}

function ensureCache(): CommandHistoryStore {
  if (cache !== null) return cache;
  const storage = getStorage();
  cache = storage ? parseHistoryStore(storage.getItem(COMMAND_HISTORY_STORAGE_KEY)) : createEmptyHistoryStore();
  return cache;
}

function writeNow(): void {
  if (!dirty || cache === null) return;
  dirty = false;
  const storage = getStorage();
  if (!storage) return;
  // 저장 직전 디스크와 병합 — 별창·다중 인스턴스가 서로의 기록을 덮지 않게.
  let merged: CommandHistoryStore;
  try {
    merged = mergeHistoryStores(
      parseHistoryStore(storage.getItem(COMMAND_HISTORY_STORAGE_KEY)),
      cache,
      [...removedKeys],
    );
  } catch {
    merged = trimHistoryStore(cache);
  }
  cache = merged;
  removedKeys = new Set();
  try {
    if (Object.keys(merged.sessions).length === 0) storage.removeItem(COMMAND_HISTORY_STORAGE_KEY);
    else storage.setItem(COMMAND_HISTORY_STORAGE_KEY, JSON.stringify(merged));
  } catch {
    /* 용량 초과 등 — 히스토리는 잃어도 되는 값이라 조용히 포기 */
  }
}

/** 밀린 저장을 즉시 반영(탭 숨김·종료 시). */
export function flushCommandHistory(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  writeNow();
}

function scheduleSave(): void {
  dirty = true;
  if (saveTimer !== null) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeNow();
  }, SAVE_DEBOUNCE_MS);
}

/** 이 세션의 히스토리(오래된 것 → 최신). 구독 없이 읽는다. */
export function getCommandHistory(agentId: string, sessionId: string | null): string[] {
  return ensureCache().sessions[commandHistoryKey(agentId, sessionId)]?.entries ?? [];
}

/** 저장된 히스토리가 있는가(시드 여부 판정용). */
export function hasCommandHistory(agentId: string, sessionId: string | null): boolean {
  return getCommandHistory(agentId, sessionId).length > 0;
}

function putBucket(key: string, entries: string[]): void {
  const store = ensureCache();
  cache = {
    v: HISTORY_STORE_VERSION,
    sessions: { ...store.sessions, [key]: { updatedAt: Date.now(), entries } },
  };
  removedKeys.delete(key);
  scheduleSave();
}

/** 명령을 보낸 순간 호출 — 그 세션 히스토리에 적재(+ debounce 저장). */
export function recordCommandHistory(agentId: string, sessionId: string | null, text: string): void {
  if (!agentId) return;
  const value = normalizeHistoryEntry(text);
  if (value === null) return;
  const key = commandHistoryKey(agentId, sessionId);
  putBucket(key, pushHistoryEntry(ensureCache().sessions[key]?.entries ?? [], value));
}

/** 저장된 게 없을 때만 서버 완료 아카이브로 한 번 채운다(그 뒤 입구는 `recordCommandHistory` 하나). */
export function seedCommandHistory(agentId: string, sessionId: string | null, texts: readonly string[]): void {
  if (!agentId || texts.length === 0) return;
  if (hasCommandHistory(agentId, sessionId)) return;
  const entries = pushHistoryEntries([], texts);
  if (entries.length === 0) return;
  putBucket(commandHistoryKey(agentId, sessionId), entries);
}

/** 세션이 지워질 때 호출 — 그 세션의 히스토리도 함께 지운다(#17-23 ③). */
export function dropSessionCommandHistory(agentId: string, sessionId: string | null): void {
  if (!agentId) return;
  const key = commandHistoryKey(agentId, sessionId);
  const store = ensureCache();
  removedKeys.add(key); // 디스크 병합이 되살리지 못하게
  if (!(key in store.sessions)) {
    scheduleSave();
    return;
  }
  const sessions = { ...store.sessions };
  delete sessions[key];
  cache = { v: HISTORY_STORE_VERSION, sessions };
  scheduleSave();
}

// §3.2.1 — 앱 종료는 `app.exit(0)` 이라 아래 세 이벤트가 안 뜬다. main 이 종료 직전에
//   물어봐 주는 창구에도 같은 flush 를 올린다(모듈이 로드된 창에서만 등록된다).
registerPersistFlush(flushCommandHistory);

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushCommandHistory);
  window.addEventListener('beforeunload', flushCommandHistory);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushCommandHistory();
  });
  // 다른 창이 히스토리를 고치면 캐시를 버려 다음 ↑ 에서 최신을 읽는다.
  window.addEventListener('storage', (e) => {
    if (e.key === null || e.key === COMMAND_HISTORY_STORAGE_KEY) resetCommandHistoryCache();
  });
}
