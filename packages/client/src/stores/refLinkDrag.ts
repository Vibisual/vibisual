import { create } from 'zustand';
import { AGENT_CARD } from '@vibisual/shared';

/**
 * §5.4 #36 (B) — 말풍선의 궤도 위성에서 끄는 **위성줄 한 가닥**. 누르는 쪽(`AgentCardNode`)과 받는 쪽(`BubbleMap`)이 갈라져 스토어에 두되
 * 순수 표시라 `graphStore` 밖. 비영속.
 */

/** 손 아래의 앱 노드(화면 상자) — 줄 끝이 이 테두리에 붙고, 놓으면 이 노드에 잇는다. */
export interface RefLinkTarget {
  id: string;
  cx: number;
  cy: number;
  halfW: number;
  halfH: number;
}

export interface RefLinkDrag {
  /** 출발 에이전트 id. */
  agentId: string;
  /** 누른 자리(화면 좌표) — 끌기 문턱은 여기서 잰다. */
  downX: number;
  downY: number;
  /** 줄이 나오는 원(화면 좌표 — 원 중심·궤도 반지름). 줄은 위성이 아니라 에이전트에서 나온다. */
  originX: number;
  originY: number;
  originR: number;
  /** 지금 손 위치(화면 좌표). */
  mouseX: number;
  mouseY: number;
  /** 문턱(`AGENT_CARD.handleDragThreshold`)을 넘었는가 — 못 넘고 놓으면 "누름"이다. */
  moved: boolean;
  /** 줄 색(에이전트 색). */
  color: string;
  /** 지금 손 아래의 앱 노드. 없으면 null. */
  target: RefLinkTarget | null;
}

interface RefLinkDragState {
  drag: RefLinkDrag | null;
  start: (input: {
    agentId: string;
    downX: number;
    downY: number;
    originX: number;
    originY: number;
    originR: number;
    color: string;
  }) => void;
  move: (x: number, y: number, target: RefLinkTarget | null) => void;
  end: () => void;
}

export const useRefLinkDragStore = create<RefLinkDragState>((set) => ({
  drag: null,
  start: (input) => set({
    drag: { ...input, mouseX: input.downX, mouseY: input.downY, moved: false, target: null },
  }),
  move: (x, y, target) => set((s) => {
    if (!s.drag) return s;
    const moved = s.drag.moved
      || Math.hypot(x - s.drag.downX, y - s.drag.downY) >= AGENT_CARD.handleDragThreshold;
    return { drag: { ...s.drag, mouseX: x, mouseY: y, moved, target: moved ? target : null } };
  }),
  end: () => set((s) => (s.drag ? { drag: null } : s)),
}));
