/**
 * §5.5 #17-52 — 이번 실행 중에 닫았고 아직 「이전 세션」 목록에서 보지 않은 세션.
 * 화면 전용 휘발 상태다 — 영속화하지 않고, 목록의 권위는 여전히 서버 아카이브다.
 */
import { create } from 'zustand';

/** 부모 에이전트당 기억하는 건수 — 넘으면 오래 닫은 것부터 버린다. */
export const RECENTLY_CLOSED_SESSIONS_MAX = 50;

const NONE: readonly string[] = [];

interface RecentlyClosedSessionsState {
  /** agentId → subAgentId[] (가장 최근에 닫은 것이 앞). */
  byAgent: Record<string, readonly string[]>;
  noteClosed: (agentId: string, subAgentId: string) => void;
  /** 본 것·복원한 것의 표시를 푼다. */
  forget: (agentId: string, subAgentIds: readonly string[]) => void;
}

export function addRecentlyClosed(
  list: readonly string[],
  subAgentId: string,
  max: number = RECENTLY_CLOSED_SESSIONS_MAX,
): readonly string[] {
  return [subAgentId, ...list.filter((id) => id !== subAgentId)].slice(0, max);
}

/** 방금 닫은 것을 닫은 역순으로 앞에 세우고, 나머지는 받은 순서를 지킨다. */
export function orderRecentlyClosedFirst<T extends { subAgentId: string }>(
  items: readonly T[],
  recentIds: readonly string[],
): T[] {
  if (recentIds.length === 0) return [...items];
  const byId = new Map(items.map((it) => [it.subAgentId, it]));
  const recent = new Set(recentIds);
  const head = recentIds.flatMap((id) => {
    const it = byId.get(id);
    return it ? [it] : [];
  });
  return [...head, ...items.filter((it) => !recent.has(it.subAgentId))];
}

export const useRecentlyClosedSessionsStore = create<RecentlyClosedSessionsState>((set) => ({
  byAgent: {},
  noteClosed: (agentId, subAgentId) =>
    set((s) => ({ byAgent: { ...s.byAgent, [agentId]: addRecentlyClosed(s.byAgent[agentId] ?? NONE, subAgentId) } })),
  forget: (agentId, subAgentIds) =>
    set((s) => {
      const prev = s.byAgent[agentId];
      if (!prev || subAgentIds.length === 0) return s;
      const drop = new Set(subAgentIds);
      const next = prev.filter((id) => !drop.has(id));
      if (next.length === prev.length) return s;
      const byAgent = { ...s.byAgent };
      if (next.length === 0) delete byAgent[agentId];
      else byAgent[agentId] = next;
      return { byAgent };
    }),
}));

/** 셀렉터용 — 없을 때 같은 빈 배열을 돌려 리렌더를 만들지 않는다. */
export function selectRecentlyClosed(agentId: string | null | undefined) {
  return (s: RecentlyClosedSessionsState): readonly string[] => (agentId ? s.byAgent[agentId] ?? NONE : NONE);
}
