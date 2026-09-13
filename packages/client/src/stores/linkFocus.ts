import { create } from 'zustand';
import {
  computeLinkGroup,
  linkRoleOf,
  linkEdgeRoleOf,
  type LinkGroup,
  type LinkRole,
  type LinkEdgeRef,
  type LinkSatelliteRef,
} from '../components/BubbleMap/linkedBubbles.js';

/**
 * §5.4 **연결 무리 강조 + 동반 이동** — Ctrl/Cmd 를 누른 채 에이전트 버블을 잡으면
 * 그 버블에 매달린 것만 남기고 나머지가 뒤로 물러나며, 그대로 끌면 무리가 함께 움직인다.
 *
 * 상태를 여기 두는 이유는 **읽는 쪽이 흩어져 있어서**다 — 버블(`BubbleNode`)·활동 엣지
 * (`CurvedEdge`)·위임 엣지(`TaskEdgeComponent`)가 전부 React Flow 가 그리는 잎이라 prop 으로
 * 내려보낼 길이 없다(`canvasVisibility`·`captureSnapGuides` 가 같은 이유로 스토어에 산다).
 *
 * **`graphStore` 에 넣지 않는다.** 이건 손이 떠나면 사라지는 순수 표시 상태라 스냅샷·체크포인트와
 * 무관하고, 저쪽은 스냅샷 1건에 `set()` 이 수십 번 도는 자리라 여기 구독을 얹으면 hover 하나가
 * 그 통지에 묻어 매번 다시 계산된다.
 *
 * **비영속** — 새로고침하면 없다(§3.2 에 새 필드 ❌).
 */

/** 무리를 잡은 단계 — 세기가 다르다. */
export type LinkFocusPhase =
  /** 강조 없음. */
  | 'off'
  /** Ctrl 을 쥔 채 위에 올려만 둔 상태 — "끌면 이만큼 따라온다"는 미리보기. */
  | 'hover'
  /** 눌러서 확정 — 드래그가 끝날 때까지 유지된다. */
  | 'grab';

interface LinkFocusState {
  /** Ctrl(win/linux) 또는 Cmd(mac)가 지금 눌려 있는가. */
  modifierHeld: boolean;
  phase: LinkFocusPhase;
  /** 지금 잡힌 무리. `phase==='off'` 면 항상 null. */
  group: LinkGroup | null;

  setModifierHeld: (held: boolean) => void;
  /** 무리를 잡는다(미리보기 또는 확정). 같은 중심·같은 단계면 통지하지 않는다. */
  focus: (group: LinkGroup, phase: Exclude<LinkFocusPhase, 'off'>) => void;
  /**
   * 이미 잡아 둔 미리보기를 **확정으로 올린다** — 누르는 순간 세기가 한 단계 오른다.
   *
   * 무리를 여기서 다시 계산하지 않는 이유: 누르는 쪽(`BubbleNode`)은 화면에 그려진 엣지 목록을
   * 모른다. 올릴 것이 이미 그 버블의 미리보기로 잡혀 있을 때만 올리고, 아니면 아무것도 하지
   * 않는다(그 경우는 드래그 시작이 무리를 새로 잡는다).
   */
  promoteToGrab: (focusId: string) => void;
  /** 미리보기만 걷는다 — 확정(`grab`) 중이면 아무것도 하지 않는다. */
  clearHover: (focusId?: string) => void;
  /**
   * 드래그가 끝났을 때 — 수식 키를 아직 쥐고 있으면 **미리보기로 내려앉고**, 놓았으면 걷는다.
   * 손을 뗐다고 무조건 꺼 버리면 연달아 옮기려는 손이 매번 처음부터 다시 잡아야 한다.
   */
  releaseGrab: () => void;
  /** 전부 걷는다(ESC·창 blur·프로젝트 전환). */
  clear: () => void;
}

export const useLinkFocusStore = create<LinkFocusState>((set) => ({
  modifierHeld: false,
  phase: 'off',
  group: null,

  setModifierHeld: (held): void => {
    set((s) => {
      if (s.modifierHeld === held) return s;
      // 키를 놓으면 미리보기는 사라진다. 다만 **끌고 있는 중이면 놓지 않는다** —
      // 드래그 도중 손가락이 Ctrl 에서 미끄러졌다고 무리가 흩어지면 옮기던 것이 흩뿌려진다.
      if (!held && s.phase === 'hover') return { modifierHeld: false, phase: 'off', group: null };
      return { modifierHeld: held };
    });
  },

  focus: (group, phase): void => {
    set((s) => {
      if (s.phase === phase && s.group?.focusId === group.focusId) return s;
      return { phase, group };
    });
  },

  promoteToGrab: (focusId): void => {
    set((s) => {
      if (s.phase !== 'hover' || s.group?.focusId !== focusId) return s;
      return { phase: 'grab' };
    });
  },

  clearHover: (focusId): void => {
    set((s) => {
      if (s.phase !== 'hover') return s;
      // 다른 버블로 옮겨 간 뒤 도착한 늦은 leave 는 무시한다(hover 가 깜빡이지 않게).
      if (focusId !== undefined && s.group?.focusId !== focusId) return s;
      return { phase: 'off', group: null };
    });
  },

  releaseGrab: (): void => {
    set((s) => {
      if (s.phase !== 'grab') return s;
      if (s.modifierHeld) return { phase: 'hover' };
      return { phase: 'off', group: null };
    });
  },

  clear: (): void => {
    set((s) => (s.phase === 'off' && s.group === null ? s : { phase: 'off', group: null }));
  },
}));

// ─── 훅 밖에서 쓰는 즉시 조회·명령 (드래그 핸들러·키 리스너용) ───

/** 지금 수식 키가 눌려 있는가 — 구독 없이 값만 본다. */
export function isLinkModifierHeld(): boolean {
  return useLinkFocusStore.getState().modifierHeld;
}

/** 지금 잡힌 무리(없으면 null) — 드래그 시작 시 동반 이동 대상을 여기서 받는다. */
export function currentLinkGroup(): LinkGroup | null {
  return useLinkFocusStore.getState().group;
}

/** 엣지·위성으로부터 무리를 계산해 그대로 잡는다. */
export function focusLinkGroup(
  focusId: string,
  edges: readonly LinkEdgeRef[],
  satellites: readonly LinkSatelliteRef[],
  phase: Exclude<LinkFocusPhase, 'off'>,
): LinkGroup {
  const group = computeLinkGroup(focusId, edges, satellites);
  useLinkFocusStore.getState().focus(group, phase);
  return group;
}

export function clearLinkFocus(): void {
  useLinkFocusStore.getState().clear();
}

/** 드래그 종료 — 수식 키를 쥐고 있으면 미리보기로 내려앉는다. */
export function releaseLinkGrab(): void {
  useLinkFocusStore.getState().releaseGrab();
}

/** 누르는 순간 미리보기를 확정으로 — 잡혀 있는 무리가 그 버블의 것일 때만 오른다. */
export function promoteLinkGrab(focusId: string): void {
  useLinkFocusStore.getState().promoteToGrab(focusId);
}

/** 지금 단계 — 구독 없이 값만 본다(드래그 핸들러용). */
export function currentLinkPhase(): LinkFocusPhase {
  return useLinkFocusStore.getState().phase;
}

export function clearLinkHover(focusId?: string): void {
  useLinkFocusStore.getState().clearHover(focusId);
}

export function setLinkModifierHeld(held: boolean): void {
  useLinkFocusStore.getState().setModifierHeld(held);
}

// ─── 컴포넌트용 구독 (전부 원시값 — 자기 자리가 바뀔 때만 깨어난다) ───

/**
 * 이 버블이 무리에서 맡은 자리.
 *
 * §9 "버블은 자기 것만 구독한다" — 무리 객체가 아니라 **판정 결과 한 글자**를 구독하므로,
 * 무리가 바뀌어도 자기 자리가 그대로인 버블은 리렌더되지 않는다.
 */
export function useLinkRole(nodeId: string): LinkRole {
  return useLinkFocusStore((s) => linkRoleOf(s.group, nodeId));
}

/** 이 엣지가 무리 안쪽 선인가. */
export function useLinkEdgeRole(edgeId: string): 'off' | 'linked' | 'dim' {
  return useLinkFocusStore((s) => linkEdgeRoleOf(s.group, edgeId));
}

/** 지금 단계 — 미리보기와 확정의 세기를 가르는 데 쓴다. */
export function useLinkFocusPhase(): LinkFocusPhase {
  return useLinkFocusStore((s) => s.phase);
}

/** 무리에 몇 개가 매달렸나(중심 제외) — 안내 알약의 숫자. */
export function useLinkedCount(): number {
  return useLinkFocusStore((s) => s.group?.nodeIds.size ?? 0);
}
