/**
 * contextMenuSubmenu.ts — §5.25 (B-1) · §5.13 (M) —
 * **캔버스 우클릭 메뉴에서 옆으로 펼쳐지는 칸의 열림 상태 한 벌.**
 *
 * 종전에는 칸마다 상태가 따로 있었고(`engineOpen` · `appsOpen`) 규칙이 두 가지뿐이었다:
 * 마우스를 올리면 열리고, 벗어나면 닫힌다. 그래서 **클릭으로 연 칸도 손이 떠나는 순간 닫혔다** —
 * 서브메뉴 항목을 읽으려고 마우스를 잠깐 옆으로 뺀 것만으로 메뉴가 접히니, 클릭은 사실상
 * 아무 뜻이 없는 손짓이었다(호버가 이미 같은 일을 했다).
 *
 * 그래서 **고정(pin)** 을 축으로 세운다(사용자 지시 2026-09-11).
 *   - **클릭 = 고정.** 고정된 칸은 마우스가 벗어나도 열려 있다.
 *   - **다른 메뉴 항목 위로 가면 풀린다.** 종전 동작 그대로다 — 다른 칸에 올리면 그 칸으로
 *     넘어가고, 서브메뉴가 없는 항목(CMD·All Model·캡처·두뇌…)에 올리면 그냥 닫힌다.
 *   - **고정된 칸을 다시 클릭하면 닫힌다.** "클릭으로도 토글"(§5.25 (B-1))의 연장이다.
 *
 * 열려 있는 칸은 언제나 **하나뿐**이다(§5.25 (B-1) "두 서브메뉴가 같은 자리에 겹쳐 뜨면 어느 쪽을
 * 누르는지 모른다"). 종전처럼 상태를 칸마다 나눠 두면 그 불변식을 호출자가 매번 손으로 지켜야
 * 하므로(`setEngineOpen(...)` 옆에 `setAppsOpen(false)` 를 빠짐없이 붙이는 식), 여기 한 칸으로 합쳐
 * 구조가 규칙을 대신 지키게 한다.
 *
 * 상태 전이만 다루는 순수 모듈이다 — 화면·DOM·React 를 모르므로 그대로 단위 테스트된다.
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

/**
 * 그 칸 위로 마우스가 들어왔다.
 *
 * 이미 **그 칸이 고정**돼 있으면 아무것도 바꾸지 않는다(고정을 호버가 풀어 버리면, 고정한 칸의
 * 서브메뉴로 마우스를 옮기는 것만으로 고정이 사라진다). **다른 칸**에서 온 것이면 고정이 풀리고
 * 그 칸이 비고정으로 열린다 — 사용자가 말한 "다른 메뉴를 호버하면 풀린다"가 이 줄이다.
 *
 * 바뀔 것이 없으면 **받은 상태를 그대로 돌려준다** — 호출자가 `setState` 에 그대로 흘려도
 * 참조가 같아 리렌더가 일어나지 않는다.
 */
export function hoverSubmenu(state: SubmenuState, key: SubmenuKey): SubmenuState {
  if (state.open === key) return state;
  return { open: key, pinned: false };
}

/**
 * 그 칸(과 그 서브메뉴)에서 마우스가 빠져나갔다.
 *
 * **고정된 칸은 닫지 않는다** — 이것이 이번 변경의 핵심이다. 고정이 아니면 종전대로 닫는다.
 * 지금 열린 칸이 내가 아니면(이미 다른 칸으로 넘어간 뒤 늦게 도착한 `mouseleave`) 건드리지 않는다.
 */
export function leaveSubmenu(state: SubmenuState, key: SubmenuKey): SubmenuState {
  if (state.open !== key) return state;
  if (state.pinned) return state;
  return SUBMENU_CLOSED;
}

/**
 * 그 칸을 클릭했다 = **고정 토글.**
 *
 * 고정돼 있던 그 칸이면 닫고(§5.25 (B-1) "클릭으로도 토글"), 아니면 그 칸을 열어 고정한다.
 * 호버로 이미 열려 있던 칸을 클릭한 경우가 후자다 — 화면은 그대로지만 이제 손이 떠나도 남는다.
 */
export function toggleSubmenuPin(state: SubmenuState, key: SubmenuKey): SubmenuState {
  if (state.open === key && state.pinned) return SUBMENU_CLOSED;
  return { open: key, pinned: true };
}

/**
 * 서브메뉴가 없는 항목(CMD·All Model·캡처·플레이·두뇌…) 위로 마우스가 들어왔다 → **고정도 풀린다.**
 *
 * 종전에는 이 처리가 필요 없었다 — 칸을 벗어나는 순간 `mouseleave` 가 닫았기 때문이다.
 * 고정이 생긴 뒤로는 "다른 메뉴를 호버하면 풀린다"를 이 손잡이가 직접 맡아야 한다.
 */
export function hoverPlainItem(state: SubmenuState): SubmenuState {
  if (state.open === null && !state.pinned) return state;
  return SUBMENU_CLOSED;
}
