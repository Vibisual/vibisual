import { create } from 'zustand';
import { AGENT_CARD } from '@vibisual/shared';

/**
 * §5.4 #36 (B) — 카드의 `+` 에서 끄는 **참조선 한 가닥**.
 *
 * 누르는 쪽(`AgentCardNode` — React Flow 가 그리는 잎)과 받는 쪽(`BubbleMap` 의 놓기 판정·미리보기)이
 * 갈라져 있어 prop 으로 잇지 못한다. 손이 떠나면 사라지는 순수 표시 상태라 `graphStore` 에 넣지 않는다
 * (`linkFocus`·`captureSnapGuides` 선례 — 저쪽은 스냅샷 1건에 `set()` 이 수십 번 돈다).
 *
 * **비영속** — 새 영속 필드 ❌(§3.2).
 */
export interface RefLinkDrag {
  /** 출발 에이전트(카드) id. */
  agentId: string;
  /** 손잡이 가운데(화면 좌표) — 선이 여기서 나간다. */
  startX: number;
  startY: number;
  /** 지금 손 위치(화면 좌표). */
  mouseX: number;
  mouseY: number;
  /** 문턱(`AGENT_CARD.handleDragThreshold`)을 넘었는가 — 못 넘고 놓으면 "누름"이다. */
  moved: boolean;
  /** 선 색(에이전트 색). */
  color: string;
}

interface RefLinkDragState {
  drag: RefLinkDrag | null;
  start: (input: { agentId: string; startX: number; startY: number; color: string }) => void;
  move: (x: number, y: number) => void;
  end: () => void;
}

export const useRefLinkDragStore = create<RefLinkDragState>((set) => ({
  drag: null,
  start: ({ agentId, startX, startY, color }) => set({
    drag: { agentId, startX, startY, mouseX: startX, mouseY: startY, moved: false, color },
  }),
  move: (x, y) => set((s) => {
    if (!s.drag) return s;
    const moved = s.drag.moved
      || Math.hypot(x - s.drag.startX, y - s.drag.startY) >= AGENT_CARD.handleDragThreshold;
    return { drag: { ...s.drag, mouseX: x, mouseY: y, moved } };
  }),
  end: () => set((s) => (s.drag ? { drag: null } : s)),
}));
