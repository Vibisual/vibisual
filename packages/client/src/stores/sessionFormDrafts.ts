import { useCallback, useMemo } from 'react';
import { create } from 'zustand';
import { registerPersistFlush } from '../utils/persistFlush.js';

// §5.5 #17-11 ⑬ — 세션 스코프 폼 초안(제출 전 입력 보존).
//
// IDE 사이드바의 폼(루프 설정 등)은 [시작]·[저장] 을 누르기 전까지 서버에 없는 값이다.
// 그 값을 컴포넌트 `useState` 로만 들고 있으면 **세션 탭을 바꾸거나 뷰를 접는 순간**
// 리셋·언마운트로 통째로 사라진다 — 사용자가 공들여 쳐 둔 명령·경로·상한이 "다른 세션
// 확인하고 오니 비어 있는" 사고가 그것이다.
//
// 여기는 그 손글씨를 기기 로컬에 붙잡아 두는 자리다. 서버는 관여하지 않는다(초안은 SSOT 가
// 아니라 아직 제출하지 않은 입력이다). 터미널 입력창의 세션별 draft(§5.3 #28 v2.69)와 같은
// 약속을 폼 전반으로 넓힌 것이라, 영속화 규약(쓰기 debounce + 창 숨김·종료 시 flush)도 같다.
//
// 새 폼은 `useSessionFormDraft(폼id, 스코프id, 바탕값)` 한 줄만 붙이면 된다.

/** 초안이 담는 값 — 폼 컨트롤이 실제로 다루는 원시 타입만(객체·배열은 초안 대상이 아니다). */
export type FormDraftValue = string | number | boolean;
export type FormDraftValues = Record<string, FormDraftValue>;

export interface SessionFormDraft {
  /** 사용자가 실제로 건드린 칸만 담는다(안 건드린 칸은 서버 값을 계속 따라가야 하므로). */
  values: FormDraftValues;
  /** 마지막 수정 시각 — 상한을 넘겼을 때 오래된 초안부터 버리는 기준. */
  at: number;
}

/** localStorage 키. (회귀 테스트가 "종료 flush 뒤 여기에 앉았는가"를 확인하므로 export 한다.) */
export const SESSION_FORM_DRAFT_STORAGE_KEY = 'vibisual:sessionFormDrafts';
const STORAGE_KEY = SESSION_FORM_DRAFT_STORAGE_KEY;
/** 보관 상한(폼 × 스코프 조합 수). 넘으면 오래된 초안부터 버린다. */
export const SESSION_FORM_DRAFT_MAX = 120;
/** 한 칸에 담을 문자열 상한 — 초안은 손글씨지 파일이 아니다. */
export const SESSION_FORM_DRAFT_TEXT_MAX = 20_000;
/** 영속화 debounce — 타이핑 핫패스에서 동기 I/O 를 뺀다(§5.3 #28 v2.x 와 같은 규약). */
const SAVE_DEBOUNCE_MS = 400;

/** 초안 키 — 폼 하나가 스코프(세션 탭 등)마다 따로 초안을 갖는다. */
export function sessionFormDraftKey(formId: string, scopeId: string): string {
  return `${formId}::${scopeId}`;
}

/** 초안에 담을 수 있는 값만 남긴다(문자열은 상한까지 자르고, NaN·Infinity·객체는 버린다). */
export function sanitizeDraftValues(input: unknown): FormDraftValues {
  if (typeof input !== 'object' || input === null) return {};
  const out: FormDraftValues = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'string') {
      out[key] = value.length > SESSION_FORM_DRAFT_TEXT_MAX ? value.slice(0, SESSION_FORM_DRAFT_TEXT_MAX) : value;
    } else if (typeof value === 'number') {
      if (Number.isFinite(value)) out[key] = value;
    } else if (typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

/**
 * 바탕값(서버 값) 위에 초안이 **건드린 칸만** 덮는다.
 * 덮을 것이 없으면 바탕값을 그대로 돌려준다(참조가 유지돼 불필요한 리렌더가 없다).
 * 폼이 개편돼 사라진 칸·타입이 어긋난 칸은 조용히 무시한다(낡은 초안이 화면을 깨지 않게).
 */
export function mergeFormDraft<T extends FormDraftValues>(base: T, draft: FormDraftValues | undefined): T {
  if (!draft) return base;
  let merged: T | null = null;
  for (const [key, value] of Object.entries(draft)) {
    if (!(key in base)) continue;
    if (typeof value !== typeof base[key]) continue;
    if (Object.is(base[key], value)) continue;
    merged ??= { ...base };
    // 위에서 키 존재·타입 일치를 확인했으므로 이 대입은 T 의 모양을 깨지 않는다.
    (merged as FormDraftValues)[key] = value;
  }
  return merged ?? base;
}

/** 상한을 넘으면 최근 수정 순으로 남기고 오래된 초안을 버린다. */
export function pruneDrafts(
  drafts: Record<string, SessionFormDraft>,
  max: number = SESSION_FORM_DRAFT_MAX,
): Record<string, SessionFormDraft> {
  const keys = Object.keys(drafts);
  if (keys.length <= max) return drafts;
  const kept = keys
    .sort((a, b) => (drafts[b]?.at ?? 0) - (drafts[a]?.at ?? 0))
    .slice(0, max);
  const out: Record<string, SessionFormDraft> = {};
  for (const key of kept) {
    const draft = drafts[key];
    if (draft) out[key] = draft;
  }
  return out;
}

/** 저장된 JSON → 초안 맵. 모양이 깨졌으면 그 항목만 조용히 버린다. */
export function parseStoredDrafts(raw: string | null): Record<string, SessionFormDraft> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};
  const out: Record<string, SessionFormDraft> = {};
  for (const [key, entry] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as { values?: unknown; at?: unknown };
    const values = sanitizeDraftValues(record.values);
    if (Object.keys(values).length === 0) continue;
    out[key] = { values, at: typeof record.at === 'number' && Number.isFinite(record.at) ? record.at : 0 };
  }
  return pruneDrafts(out);
}

function readStorage(): Record<string, SessionFormDraft> {
  try {
    if (typeof localStorage === 'undefined') return {};
    return parseStoredDrafts(localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

function writeStorage(drafts: Record<string, SessionFormDraft>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (Object.keys(drafts).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    /* quota·비가용 — 이번 세션에서는 store 만으로 동작한다(입력을 막지는 않는다). */
  }
}

// 쓰기 debounce — 마지막 맵이 이긴다(뒤늦은 저장이 이미 비운 초안을 되살리지 않게).
let pendingSave: Record<string, SessionFormDraft> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function flushDrafts(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (pendingSave !== null) {
    writeStorage(pendingSave);
    pendingSave = null;
  }
}

function scheduleSaveDrafts(drafts: Record<string, SessionFormDraft>): void {
  pendingSave = drafts;
  if (saveTimer !== null) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (pendingSave !== null) {
      writeStorage(pendingSave);
      pendingSave = null;
    }
  }, SAVE_DEBOUNCE_MS);
}

// §3.2.1 — 앱 종료는 `app.exit(0)` 이라 아래 세 이벤트가 안 뜬다. main 이 종료 직전에
//   물어봐 주는 창구에도 같은 flush 를 올린다.
registerPersistFlush(flushDrafts);

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushDrafts);
  window.addEventListener('beforeunload', flushDrafts);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushDrafts();
  });
}

interface SessionFormDraftState {
  drafts: Record<string, SessionFormDraft>;
  /** 건드린 칸만 초안에 얹는다(부분 갱신). */
  patchFormDraft: (key: string, patch: FormDraftValues) => void;
  /** 그 스코프의 초안을 비운다(저장이 끝나 서버가 그 값을 갖게 됐을 때). */
  clearFormDraft: (key: string) => void;
}

export const useSessionFormDraftStore = create<SessionFormDraftState>((set, get) => ({
  drafts: readStorage(),
  patchFormDraft: (key, patch): void => {
    const clean = sanitizeDraftValues(patch);
    if (Object.keys(clean).length === 0) return;
    const current = get().drafts[key];
    const next = pruneDrafts({
      ...get().drafts,
      [key]: { values: { ...(current?.values ?? {}), ...clean }, at: Date.now() },
    });
    set({ drafts: next });
    scheduleSaveDrafts(next);
  },
  clearFormDraft: (key): void => {
    if (!get().drafts[key]) return;
    const next = { ...get().drafts };
    delete next[key];
    set({ drafts: next });
    scheduleSaveDrafts(next);
  },
}));

/**
 * 폼 하나를 스코프(세션 탭 등)별 초안과 묶는다.
 *
 * 돌려주는 값은 `바탕값 ← 초안(건드린 칸만)` 병합 결과라, 사용자가 손대지 않은 칸은 서버
 * 스냅샷을 계속 따라가고 손댄 칸만 초안이 이긴다. `scopeId` 가 `null` 이면(대상 세션 없음)
 * 바탕값을 그대로 쓰고 쓰기는 무시한다.
 *
 * `base` 는 `useMemo` 로 안정화해 넘겨라 — 매 렌더 새 객체를 만들면 병합도 매번 새 객체가 된다.
 */
export function useSessionFormDraft<T extends FormDraftValues>(
  formId: string,
  scopeId: string | null,
  base: T,
): [T, (patch: Partial<T>) => void, () => void] {
  const key = scopeId ? sessionFormDraftKey(formId, scopeId) : null;
  const stored = useSessionFormDraftStore((s) => (key ? s.drafts[key]?.values : undefined));
  const patchFormDraft = useSessionFormDraftStore((s) => s.patchFormDraft);
  const clearFormDraft = useSessionFormDraftStore((s) => s.clearFormDraft);

  const values = useMemo(() => mergeFormDraft(base, stored), [base, stored]);

  const patch = useCallback(
    (next: Partial<T>): void => {
      // Partial<T> 의 undefined 칸은 sanitize 가 걸러내므로 그대로 넘겨도 안전하다.
      if (key) patchFormDraft(key, next as FormDraftValues);
    },
    [key, patchFormDraft],
  );

  const clear = useCallback((): void => {
    if (key) clearFormDraft(key);
  }, [key, clearFormDraft]);

  return [values, patch, clear];
}
