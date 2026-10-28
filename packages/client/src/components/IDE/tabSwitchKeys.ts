/**
 * §5.5 #17-37 세션 탭 전환 "어느 탭으로 갈까" 한 곳(순수). ⚠ **키는 여기서 읽지 않는다** — §6 레지스트리(`shared/keymap.ts`)와 `useCommand` 가 정한다.
 * 여기선 명령 → 뜻(`tabSwitchIntentOf`) → 탭 순서 적용(`applyTabSwitch`)만 한다.
 */

import type { CommandId } from '@vibisual/shared';

/** 탭 하나를 가리키는 값. `null` = 메인(에이전트 전체) 탭 — 훅 에이전트에만 있다. */
export type TabKey = string | null;

/** 키가 말한 뜻. `cycle` = 옆으로 한 칸, `index` = N번째(0-based), `last` = 마지막 탭. */
export type TabSwitchIntent =
  | { kind: 'cycle'; delta: 1 | -1 }
  | { kind: 'index'; index: number }
  | { kind: 'last' };

/** 이 모듈이 아는 탭 전환 명령. `COMMANDS` 표의 `ide.tab*` 다섯이다. */
export type TabSwitchCommandId = Extract<CommandId, `ide.tab${string}`>;

/**
 * 명령 → 뜻. `ide.tabNth` 만 눌린 숫자가 필요하다(호출부가 `keyTokenFromCode` 로 넘긴다).
 * ⚠ **`9` 는 마지막 탭**이다(브라우저·VS Code 관례). 그 자리를 다른 숫자로 바꿔도 마지막 숫자가 이 규칙을 따른다.
 */
export function tabSwitchIntentOf(
  id: TabSwitchCommandId,
  digit?: number,
): TabSwitchIntent | null {
  switch (id) {
    case 'ide.tabNext':
    case 'ide.tabNextAlt':
      return { kind: 'cycle', delta: 1 };
    case 'ide.tabPrev':
    case 'ide.tabPrevAlt':
      return { kind: 'cycle', delta: -1 };
    case 'ide.tabNth': {
      if (digit === undefined || !Number.isInteger(digit) || digit < 1 || digit > 9) return null;
      return digit === 9 ? { kind: 'last' } : { kind: 'index', index: digit - 1 };
    }
    default:
      return null;
  }
}

/** 뜻 + 탭 순서 → 갈 탭. 갈 곳이 없거나 제자리면 `null`. 감싼 객체로 돌려준다 — `TabKey` 그대로면 메인 탭(`null`)과 "갈 곳 없음"이 같아진다. */
export function applyTabSwitch(
  order: readonly TabKey[],
  current: TabKey,
  intent: TabSwitchIntent,
): { target: TabKey } | null {
  if (order.length === 0) return null;

  let target: TabKey;
  if (intent.kind === 'cycle') {
    // 탭이 하나뿐이면 순환은 제자리다 — 아래 "제자리면 no-op" 에도 걸리지만 뜻을 먼저 밝혀 둔다.
    if (order.length < 2) return null;
    const at = order.indexOf(current);
    // 지금 탭이 목록에 없으면(닫히는 중 등) 끝에서 시작한다 — 다음은 첫 탭, 이전은 마지막 탭.
    const from = at < 0 ? (intent.delta > 0 ? -1 : 0) : at;
    const next = (from + intent.delta + order.length) % order.length;
    target = order[next] as TabKey;
  } else if (intent.kind === 'last') {
    target = order[order.length - 1] as TabKey;
  } else {
    // 없는 자리로의 직행은 아무 일도 하지 않는다 — 탭이 셋인데 `Ctrl+5` 를 눌러도 화면은 그대로.
    if (intent.index >= order.length) return null;
    target = order[intent.index] as TabKey;
  }

  if (target === current) return null;
  return { target };
}
