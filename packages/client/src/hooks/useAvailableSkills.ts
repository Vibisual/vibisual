import { useEffect, useState } from 'react';

import type { AvailableSkill } from '@vibisual/shared';

/**
 * §5.5 #17-2 v2.30 / #17-4 v2.32 — 프로젝트 + 플러그인 스킬 목록.
 * `GET /api/available-skills` 응답 shape 와 동치.
 *
 * §5.5 #17-33 ⑦ — 정의는 `@vibisual/shared` 의 `AvailableSkill` 하나로 모았다. 서버와 화면이
 * 각자 모양을 들고 있었기 때문에 `installed`/`enabled` 같은 새 칸이 한쪽에만 생길 수 있었다.
 */
export type SkillInfo = AvailableSkill;

/** §5.5 #17-4/#17-5 — 타입별 사용자 고정 순서 (드래그 재정렬). */
export interface SkillOrder {
  project: string[];
  global: string[];
  plugin: string[];
}

/**
 * §5.5 #17-2 — CLI 내장(built-in) 슬래시 명령. 서버가 Anthropic 공개 문서에서 뽑아 둔
 * 목록(`BUILTIN_SLASH_COMMANDS`)을 그대로 실어 보낸다. `/` 자동완성 전용 — Skills 사이드바엔
 * 안 나온다.
 */
export interface BuiltinCommandInfo {
  name: string;
  description: string;
  aliases: string[];
}

interface SkillsState {
  skills: SkillInfo[];
  /** §5.5 #17-2 v3.19 — CLI 내장 슬래시 명령(자동완성 전용). */
  builtins: BuiltinCommandInfo[];
  order: SkillOrder;
  /** §5.5 #17-4 v2.93 — 즐겨찾기 스킬명(별 누른 순서, 출처 무관). */
  favorites: string[];
  /**
   * §5.5 #17-2 (보강) — 이 프로젝트에서 슬래시 명령이 **살아 있는가**.
   *
   * 꺼져 있으면 위 `skills`·`builtins` 가 전부 거절된다(#17-28 ⑩). 목록은 그대로 두고
   * 화면이 그 사실만 말한다 — 무엇이 있었는지까지 지우면 사용자가 켠 뒤에 뭘 얻는지 모른다.
   * **모르면 켜진 것으로 본다**(네트워크 실패로 "다 안 됩니다"라고 겁주지 않게).
   */
  slashCommandsEnabled: boolean;
}

const EMPTY_ORDER: SkillOrder = { project: [], global: [], plugin: [] };
const EMPTY_STATE: SkillsState = { skills: [], builtins: [], order: EMPTY_ORDER, favorites: [], slashCommandsEnabled: true };

/**
 * §5.5 #17-2/#17-4 v2.59 — 프로젝트별 조회.
 * 캐시를 projectName 키로 분리한다(`''` = project 미지정 = 전 프로젝트 병합 fallback).
 * 같은 프로젝트를 보는 컴포넌트끼리만 캐시·구독을 공유 → 탭(프로젝트)마다 독립 목록.
 */
const caches = new Map<string, SkillsState>();
const inflights = new Map<string, Promise<SkillsState>>();
const subscribers = new Map<string, Set<(s: SkillsState) => void>>();

/**
 * 캐시·구독 키. agentId 가 있으면 그걸 권위 키로 쓴다(`agent:<id>`) — 클라가 짜맞춘
 * 표시명에 의존하지 않고, 서버가 그 에이전트의 소속 인스턴스에서 path 를 직접 해소한다.
 * agentId 없으면(TerminalInput 등) projectName 폴백, 그것도 없으면 `''`(전 프로젝트 병합).
 */
function keyOf(projectName?: string | null, agentId?: string | null): string {
  if (agentId) return `agent:${agentId}`;
  return projectName ?? '';
}

/** 캐시 키 → 조회 URL. (`''`=전체, `agent:<id>`=에이전트 권위, 그 외=프로젝트 표시명) */
function urlForKey(key: string): string {
  if (!key) return '/api/available-skills';
  if (key.startsWith('agent:')) {
    return `/api/available-skills?agent=${encodeURIComponent(key.slice('agent:'.length))}`;
  }
  return `/api/available-skills?project=${encodeURIComponent(key)}`;
}

function notify(key: string, s: SkillsState): void {
  const set = subscribers.get(key);
  if (!set) return;
  for (const cb of set) cb(s);
}

function normalizeOrder(raw: unknown): SkillOrder {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { project?: unknown; global?: unknown; plugin?: unknown };
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return { project: arr(r.project), global: arr(r.global), plugin: arr(r.plugin) };
}

function normalizeFavorites(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== 'string' || !x || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function normalizeBuiltins(raw: unknown): BuiltinCommandInfo[] {
  if (!Array.isArray(raw)) return [];
  const out: BuiltinCommandInfo[] = [];
  for (const x of raw) {
    const r = x as { name?: unknown; description?: unknown; aliases?: unknown };
    if (typeof r?.name !== 'string' || !r.name) continue;
    out.push({
      name: r.name,
      description: typeof r.description === 'string' ? r.description : '',
      aliases: Array.isArray(r.aliases) ? r.aliases.filter((a): a is string => typeof a === 'string') : [],
    });
  }
  return out;
}

function fetchSkills(key: string): Promise<SkillsState> {
  return fetch(urlForKey(key))
    .then((r) => r.json() as Promise<{ ok: boolean; skills: SkillInfo[]; builtins?: unknown; order?: unknown; favorites?: unknown; slashCommandsEnabled?: unknown }>)
    .then((d) => {
      const next: SkillsState = {
        skills: d.ok && Array.isArray(d.skills) ? d.skills : [],
        builtins: d.ok ? normalizeBuiltins(d.builtins) : [],
        order: normalizeOrder(d.order),
        favorites: normalizeFavorites(d.favorites),
        // 명시적으로 `false` 일 때만 꺼진 것 — 옛 서버(이 칸이 없다)는 켜진 것으로 읽는다.
        slashCommandsEnabled: d.slashCommandsEnabled !== false,
      };
      caches.set(key, next);
      return next;
    })
    .catch(() => {
      const next: SkillsState = { ...EMPTY_STATE };
      caches.set(key, next);
      return next;
    });
}

function loadAvailableSkills(key: string): Promise<SkillsState> {
  const cached = caches.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = inflights.get(key);
  if (pending) return pending;
  const p = fetchSkills(key).then((s) => {
    inflights.delete(key);
    notify(key, s);
    return s;
  });
  inflights.set(key, p);
  return p;
}

/**
 * 캐시 무효화 + 재조회 후 모든 구독자에 통지 (삭제/재정렬 직후 호출).
 * 캐시된 모든 프로젝트 키를 재조회한다 — 삭제·재정렬이 어느 프로젝트에 영향을 줬는지
 * 호출부가 알 필요 없게.
 */
export function refreshAvailableSkills(): Promise<void> {
  const keys = new Set<string>([...caches.keys(), ...subscribers.keys()]);
  caches.clear();
  inflights.clear();
  return Promise.all(
    [...keys].map((key) => fetchSkills(key).then((s) => notify(key, s))),
  ).then(() => undefined);
}

/**
 * §5.5 #17-33 ⑦ — 목록에서 고른 플러그인 스킬을 **그 자리에서 깐다**.
 *
 * 왜 필요한가: 종전 목록은 마켓 클론 폴더를 훑어 **안 깔린 스킬까지** 실었고, 고르면 프롬프트 앞에
 * `/이름` 만 붙어 나가 CLI 가 그것을 풀지 못했다. 이제 목록이 `installed:false` 를 말해 주므로,
 * 사용자를 터미널로 내보내는 대신 여기서 `claude plugin install --scope user --yes` 를 대신 부른다.
 *
 * **범위는 `user` 고정이다.** 이 사용자가 겪은 병목의 절반이 "프로젝트마다 다시 깔아야 한다" 였고
 * (실측: 공식 플러그인 4개가 `project` 범위로 한 프로젝트에만 매여 있었다), 스킬 목록에서 고르는
 * 행위의 뜻은 "이걸 쓰겠다" 이지 "이 프로젝트에서만 쓰겠다" 가 아니다. 범위를 고르고 싶은 사용자는
 * 플러그인 창(#17-33 ⑤)에 그 자리가 이미 있다.
 *
 * `root` 는 그 프로젝트 경로 — CLI 가 `cwd` 로 범위를 해석하므로 필요하다.
 */
export async function installPluginSkill(
  root: string,
  pluginId: string,
  /** 안 깔렸으면 `install`, 깔렸는데 꺼져 있으면 `enable` — 둘은 다른 상태다(#17-33 ③). */
  action: 'install' | 'enable' = 'install',
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/claude-plugins/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, action, id: pluginId, scope: 'user' }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) return { ok: false, ...(data.error ? { error: data.error } : {}) };
    // 깔았으면 목록이 말하는 상태도 달라진다 — 재조회하지 않으면 칩이 "미설치" 로 남는다.
    await refreshAvailableSkills();
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** 프로젝트 스킬을 디스크에서 삭제. 성공 시 목록 재조회. */
export async function deleteSkill(name: string, source: 'project' | 'global' | 'plugin'): Promise<boolean> {
  try {
    const res = await fetch('/api/skill', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, source }),
    });
    if (!res.ok) return false;
    await refreshAvailableSkills();
    return true;
  } catch {
    return false;
  }
}

/**
 * §5.5 #17-4 — 복사 대상 하나의 결과.
 * `exists` = 이미 있어 **덮지 않고 멈춤**(사용자 승인 후 overwrite 재전송), `same` = 원본과 같은 자리.
 */
export type SkillCopyStatus = 'copied' | 'overwritten' | 'exists' | 'same' | 'error';

export interface SkillCopyResult {
  /** 보낸 대상 ref 그대로 — `'global'` 또는 프로젝트 path. */
  target: string;
  status: SkillCopyStatus;
  error?: string;
}

/**
 * §5.5 #17-4 — 스킬(폴더) 또는 슬래시 커맨드(.md)를 다른 프로젝트·전역으로 복사.
 * 원본 프로젝트는 `agentId` 로 서버가 직접 해소한다(표시명 의존 ❌ — 목록 조회와 같은 규약).
 * 한 곳이라도 실제로 쓰였으면 목록을 재조회해 대상 탭에서 즉시 보이게 한다.
 */
export async function copySkill(params: {
  name: string;
  source: SkillInfo['source'];
  agentId?: string | null;
  targets: string[];
  overwrite?: boolean;
}): Promise<SkillCopyResult[]> {
  const failAll = (error?: string): SkillCopyResult[] =>
    params.targets.map((target) => ({ target, status: 'error' as const, ...(error ? { error } : {}) }));
  try {
    const res = await fetch('/api/skill/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: params.name,
        source: params.source,
        agentId: params.agentId ?? undefined,
        targets: params.targets,
        overwrite: params.overwrite === true,
      }),
    });
    const data = (await res.json()) as { ok?: boolean; results?: unknown; error?: string };
    if (!res.ok || data.ok !== true || !Array.isArray(data.results)) return failAll(data.error);
    const results = data.results as SkillCopyResult[];
    if (results.some((r) => r.status === 'copied' || r.status === 'overwritten')) {
      await refreshAvailableSkills();
    }
    return results;
  } catch {
    return failAll();
  }
}

/**
 * 한 타입의 고정 순서를 저장. 낙관적으로 캐시를 갱신하고 서버에도 반영.
 * order 는 전역 appState 라 캐시된 모든 프로젝트 키에 동일하게 반영한다.
 */
export async function persistSkillOrder(type: 'project' | 'global' | 'plugin', order: string[]): Promise<void> {
  // 낙관적 캐시 갱신 — 즉시 재렌더되도록. (전 키 공통)
  for (const [key, state] of caches) {
    const nextOrder: SkillOrder = { ...state.order, [type]: order };
    const next: SkillsState = { ...state, order: nextOrder };
    caches.set(key, next);
    notify(key, next);
  }
  try {
    await fetch('/api/skill-order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, order }),
    });
  } catch {
    /* 네트워크 실패 시 다음 fetch 가 서버값으로 복원 */
  }
}

/**
 * §5.5 #17-4 v2.93 — 즐겨찾기 목록(전체)을 저장. 낙관적으로 캐시를 갱신하고 서버에도 반영.
 * favorites 는 전역 appState 라 캐시된 모든 프로젝트 키에 동일하게 반영한다.
 */
export async function persistSkillFavorites(favorites: string[]): Promise<void> {
  for (const [key, state] of caches) {
    const next: SkillsState = { ...state, favorites };
    caches.set(key, next);
    notify(key, next);
  }
  try {
    await fetch('/api/skill-favorites', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorites }),
    });
  } catch {
    /* 네트워크 실패 시 다음 fetch 가 서버값으로 복원 */
  }
}

/**
 * 모듈 캐시를 공유하는 훅 — `TerminalInput` 슬래시 자동완성과 `SkillsView` 사이드바가
 * 같은 프로젝트를 볼 때 같은 데이터를 본다. v2.59 부터 캐시는 projectName 키로 분리되어
 * 탭(프로젝트)마다 독립 목록을 반환한다. fetch 는 프로젝트 키별 첫 호출 시 1회.
 */
export function useAvailableSkills(projectName?: string | null, agentId?: string | null): { skills: SkillInfo[]; builtins: BuiltinCommandInfo[]; order: SkillOrder; favorites: string[]; slashCommandsEnabled: boolean; loaded: boolean } {
  const key = keyOf(projectName, agentId);
  const [state, setState] = useState<SkillsState>(() => caches.get(key) ?? EMPTY_STATE);
  const [loaded, setLoaded] = useState<boolean>(caches.has(key));

  useEffect(() => {
    const cached = caches.get(key);
    if (cached) {
      setState(cached);
      setLoaded(true);
    } else {
      // 프로젝트 전환 시 이전 키 데이터가 잠깐 남지 않도록 초기화
      setState(EMPTY_STATE);
      setLoaded(false);
    }
    let cancelled = false;
    const cb = (s: SkillsState) => {
      if (cancelled) return;
      setState(s);
      setLoaded(true);
    };
    let set = subscribers.get(key);
    if (!set) {
      set = new Set();
      subscribers.set(key, set);
    }
    set.add(cb);
    if (!caches.has(key)) void loadAvailableSkills(key);
    return () => {
      cancelled = true;
      const s = subscribers.get(key);
      if (s) {
        s.delete(cb);
        if (s.size === 0) subscribers.delete(key);
      }
    };
  }, [key]);

  return { skills: state.skills, builtins: state.builtins, order: state.order, favorites: state.favorites, slashCommandsEnabled: state.slashCommandsEnabled, loaded };
}
