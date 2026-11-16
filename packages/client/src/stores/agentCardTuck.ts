import { create } from 'zustand';

/**
 * §5.4 #36 (A) — 말풍선이 원 안에 들어가 있는 노드. 판정은 노드(`AgentCardNode`)가, 사용은 선 끝점·가림 원이 해서 스토어에 두되
 * 순수 표시라 `graphStore` 밖. 비영속.
 */
interface AgentCardTuckState {
  tucked: ReadonlySet<string>;
  setTucked: (nodeId: string, tucked: boolean) => void;
}

export const useAgentCardTuckStore = create<AgentCardTuckState>((set) => ({
  tucked: new Set<string>(),
  setTucked: (nodeId, tucked) => set((state) => {
    if (state.tucked.has(nodeId) === tucked) return state;
    const next = new Set(state.tucked);
    if (tucked) next.add(nodeId); else next.delete(nodeId);
    return { tucked: next };
  }),
}));

/** 선마다 양 끝을 구독한다 — 글자 하나만 보므로 자기 노드가 바뀔 때만 깨어난다. */
export function useAgentCardTucked(nodeId: string): boolean {
  return useAgentCardTuckStore((state) => state.tucked.has(nodeId));
}
