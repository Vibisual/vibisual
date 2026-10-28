/**
 * §5.25 (B-1) · §5.13 (M) — 우클릭 메뉴 서브메뉴의 열림 상태 한 벌. 호버로 열고 클릭으로 고정한다(호버만이면 클릭이 뜻이 없다).
 * 고정은 다른 메뉴 항목에 올리거나 같은 칸을 다시 누르면 풀린다. 열린 칸은 하나뿐 — 칸마다 상태를 나누면 호출자가 매번 지켜야 해 한 칸으로 합친다.
 */

/** 옆으로 펼쳐지는 칸. 늘어나면 여기에 값 하나만 추가한다. */
export type SubmenuKey = 'claude' | 'codex' | 'apps';

export interface SubmenuState {
  /** 지금 펼쳐진 칸. 하나뿐이고, 없으면 `null`. */
  open: SubmenuKey | null;
  /** 클릭으로 고정됐는가. 고정된 칸은 마우스가 벗어나도 닫히지 않는다. */
  pinned: boolean;
}

/** 아무 칸도 펼쳐지지 않은 상태(메뉴가 막 뜬 자리). */
export const SUBMENU_CLOSED: SubmenuState = { open: null, pinned: false };

/** 그 칸이 지금 펼쳐져 있는가. `aria-expanded` 와 렌더 조건이 같은 답을 쓰게 하는 한 곳. */
export function isSubmenuOpen(state: SubmenuState, key: SubmenuKey): boolean {
  return state.open === key;
}

/** 그 칸이 이미 고정이면 그대로(호버가 풀면 서브메뉴로 옮기기만 해도 풀린다). 다른 칸에서 왔으면 비고정으로 연다. 바뀔 게 없으면 같은 참조를 돌려줘 리렌더가 없다. */
export function hoverSubmenu(state: SubmenuState, key: SubmenuKey): SubmenuState {
  if (state.open === key) return state;
  return { open: key, pinned: false };
}

/** 고정된 칸은 닫지 않는다. 열린 칸이 내가 아니면(넘어간 뒤 늦게 온 `mouseleave`) 건드리지 않는다. */
export function leaveSubmenu(state: SubmenuState, key: SubmenuKey): SubmenuState {
  if (state.open !== key) return state;
  if (state.pinned) return state;
  return SUBMENU_CLOSED;
}

/** 고정된 그 칸이면 닫고, 아니면 열어 고정한다(호버로 열린 칸을 누르면 화면은 같지만 손이 떠나도 남는다). */
export function toggleSubmenuPin(state: SubmenuState, key: SubmenuKey): SubmenuState {
  if (state.open === key && state.pinned) return SUBMENU_CLOSED;
  return { open: key, pinned: true };
}

/** 서브메뉴 없는 항목 위 → 고정도 푼다. 고정 칸은 `mouseleave` 로 안 닫히므로 이 손잡이가 맡는다. */
export function hoverPlainItem(state: SubmenuState): SubmenuState {
  if (state.open === null && !state.pinned) return state;
  return SUBMENU_CLOSED;
}
