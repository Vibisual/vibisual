import { useEffect, useState } from 'react';

/**
 * §5.5 #17-2 v2.30 / #17-4 v2.32 — 프로젝트 + 플러그인 스킬 목록.
 * `GET /api/available-skills` 응답 shape 와 동치.
 */
export interface SkillInfo {
  name: string;
  description: string;
  source: 'project' | 'plugin';
  pluginName?: string;
}

/** §5.5 #17-4 — 타입별 사용자 고정 순서 (드래그 재정렬). */
export interface SkillOrder {
  project: string[];
  plugin: string[];
}

interface SkillsState {
  skills: SkillInfo[];
  order: SkillOrder;
}

const EMPTY_ORDER: SkillOrder = { project: [], plugin: [] };

let cache: SkillsState | null = null;
let inflight: Promise<SkillsState> | null = null;
const subscribers = new Set<(s: SkillsState) => void>();

function notify(s: SkillsState): void {
  for (const cb of subscribers) cb(s);
}

function normalizeOrder(raw: unknown): SkillOrder {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { project?: unknown; plugin?: unknown };
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return { project: arr(r.project), plugin: arr(r.plugin) };
}

function fetchSkills(): Promise<SkillsState> {
  return fetch('/api/available-skills')
    .then((r) => r.json() as Promise<{ ok: boolean; skills: SkillInfo[]; order?: unknown }>)
    .then((d) => {
      const next: SkillsState = {
        skills: d.ok && Array.isArray(d.skills) ? d.skills : [],
        order: normalizeOrder(d.order),
      };
      cache = next;
      return next;
    })
    .catch(() => {
      const next: SkillsState = { skills: [], order: EMPTY_ORDER };
      cache = next;
      return next;
    });
}

function loadAvailableSkills(): Promise<SkillsState> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = fetchSkills().then((s) => {
    inflight = null;
    notify(s);
    return s;
  });
  return inflight;
}

/** 캐시 무효화 + 재조회 후 모든 구독자에 통지 (삭제/재정렬 직후 호출). */
export function refreshAvailableSkills(): Promise<SkillsState> {
  cache = null;
  inflight = null;
  return fetchSkills().then((s) => {
    notify(s);
    return s;
  });
}

/** 프로젝트 스킬을 디스크에서 삭제. 성공 시 목록 재조회. */
export async function deleteSkill(name: string, source: 'project' | 'plugin'): Promise<boolean> {
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

/** 한 타입의 고정 순서를 저장. 낙관적으로 캐시를 갱신하고 서버에도 반영. */
export async function persistSkillOrder(type: 'project' | 'plugin', order: string[]): Promise<void> {
  // 낙관적 캐시 갱신 — 즉시 재렌더되도록.
  if (cache) {
    const nextOrder: SkillOrder = { ...cache.order, [type]: order };
    cache = { ...cache, order: nextOrder };
    notify(cache);
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
 * 모듈 캐시를 공유하는 훅 — `TerminalInput` 슬래시 자동완성과 `SkillsView` 사이드바가 같은 데이터를 본다.
 * fetch 는 첫 호출 시 1회. cache 가 채워지면 모든 구독자가 즉시 동일 데이터를 받는다.
 */
export function useAvailableSkills(): { skills: SkillInfo[]; order: SkillOrder; loaded: boolean } {
  const [state, setState] = useState<SkillsState>(() => cache ?? { skills: [], order: EMPTY_ORDER });
  const [loaded, setLoaded] = useState<boolean>(cache !== null);

  useEffect(() => {
    if (cache !== null) {
      setState(cache);
      setLoaded(true);
    }
    let cancelled = false;
    const cb = (s: SkillsState) => {
      if (cancelled) return;
      setState(s);
      setLoaded(true);
    };
    subscribers.add(cb);
    if (cache === null) void loadAvailableSkills();
    return () => {
      cancelled = true;
      subscribers.delete(cb);
    };
  }, []);

  return { skills: state.skills, order: state.order, loaded };
}
