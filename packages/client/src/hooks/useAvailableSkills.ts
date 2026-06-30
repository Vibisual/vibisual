import { useEffect, useState } from 'react';

/**
 * §5.5 #17-2 v2.30 / #17-4 v2.32 — 프로젝트 + 플러그인 스킬 목록.
 * `GET /api/available-skills` 응답 shape 와 동치.
 */
export interface SkillInfo {
  name: string;
  description: string;
  /** project = 프로젝트 `.claude`, global = 홈 `~/.claude`(전 프로젝트 공통), plugin = 설치 플러그인. */
  source: 'project' | 'global' | 'plugin';
  pluginName?: string;
}

/** §5.5 #17-4/#17-5 — 타입별 사용자 고정 순서 (드래그 재정렬). */
export interface SkillOrder {
  project: string[];
  global: string[];
  plugin: string[];
}

interface SkillsState {
  skills: SkillInfo[];
  order: SkillOrder;
  /** §5.5 #17-4 v2.93 — 즐겨찾기 스킬명(별 누른 순서, 출처 무관). */
  favorites: string[];
}

const EMPTY_ORDER: SkillOrder = { project: [], global: [], plugin: [] };
const EMPTY_STATE: SkillsState = { skills: [], order: EMPTY_ORDER, favorites: [] };

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

function fetchSkills(key: string): Promise<SkillsState> {
  return fetch(urlForKey(key))
    .then((r) => r.json() as Promise<{ ok: boolean; skills: SkillInfo[]; order?: unknown; favorites?: unknown }>)
    .then((d) => {
      const next: SkillsState = {
        skills: d.ok && Array.isArray(d.skills) ? d.skills : [],
        order: normalizeOrder(d.order),
        favorites: normalizeFavorites(d.favorites),
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
export function useAvailableSkills(projectName?: string | null, agentId?: string | null): { skills: SkillInfo[]; order: SkillOrder; favorites: string[]; loaded: boolean } {
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

  return { skills: state.skills, order: state.order, favorites: state.favorites, loaded };
}
