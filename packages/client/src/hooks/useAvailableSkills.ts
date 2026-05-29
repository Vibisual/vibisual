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

let cache: SkillInfo[] | null = null;
let inflight: Promise<SkillInfo[]> | null = null;
const subscribers = new Set<(list: SkillInfo[]) => void>();

function loadAvailableSkills(): Promise<SkillInfo[]> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = fetch('/api/available-skills')
    .then((r) => r.json() as Promise<{ ok: boolean; skills: SkillInfo[] }>)
    .then((d) => {
      const list = d.ok && Array.isArray(d.skills) ? d.skills : [];
      cache = list;
      inflight = null;
      for (const cb of subscribers) cb(list);
      return list;
    })
    .catch(() => {
      inflight = null;
      cache = [];
      for (const cb of subscribers) cb([]);
      return [];
    });
  return inflight;
}

/**
 * 모듈 캐시를 공유하는 훅 — `TerminalInput` 슬래시 자동완성과 `SkillsView` 사이드바가 같은 데이터를 본다.
 * fetch 는 첫 호출 시 1회. cache 가 채워지면 모든 구독자가 즉시 동일 list 를 받는다.
 */
export function useAvailableSkills(): { skills: SkillInfo[]; loaded: boolean } {
  const [skills, setSkills] = useState<SkillInfo[]>(() => cache ?? []);
  const [loaded, setLoaded] = useState<boolean>(cache !== null);

  useEffect(() => {
    if (cache !== null) {
      setSkills(cache);
      setLoaded(true);
      return;
    }
    let cancelled = false;
    const cb = (list: SkillInfo[]) => {
      if (cancelled) return;
      setSkills(list);
      setLoaded(true);
    };
    subscribers.add(cb);
    void loadAvailableSkills();
    return () => {
      cancelled = true;
      subscribers.delete(cb);
    };
  }, []);

  return { skills, loaded };
}
