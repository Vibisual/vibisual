/**
 * §5.5 #17-28 ② — 주입원 통제 **층 셋**(프로젝트 전체 · 이 에이전트 버블 · 이 세션)의 화면 쪽 규칙.
 *
 * 여기 있는 것은 전부 순수 함수다 — 화면은 이 답을 그리기만 한다. 판정 자체(무엇이 최종인가)는
 * 서버·클라가 함께 쓰는 `resolveContextEnabled` 한 곳이고, 이 파일은 그 결과에서 **"지금 보고 있는
 * 층에서는 어떻게 보이고, 여기서 누르면 무엇을 저장해야 하는가"** 만 계산한다.
 *
 * 이 파일이 생긴 이유(= 종전 결함):
 *  · 화면이 어느 층을 골랐든 **최종값 하나**(`item.enabled`)만 그렸다 → 아래층에 명시값이 걸린 줄은
 *    위층에서 아무리 눌러도 스위치가 안 움직였다.
 *  · 저장할지 지울지를 **`defaultEnabled` 와 비교**해 정했다 → 프로젝트에서 끈 줄을 세션에서 다시
 *    켜면 "기본값과 같다"는 이유로 세션 명시값이 지워져 도로 꺼졌다(아래층이 위층을 못 이겼다).
 */
import type { ContextScopeLevel, ContextSourceItem } from '@vibisual/shared';
import { CONTEXT_SCOPE_LEVELS } from '@vibisual/shared';

/** 층 버튼의 i18n 키 — 배지(`ide.context.scope.*`)와 **따로 둔다**(버튼은 길고 배지는 짧아야 한다). */
export const CONTEXT_SCOPE_TAB_KEY: Record<ContextScopeLevel, string> = {
  project: 'ide.context.scopeTab.project',
  agent: 'ide.context.scopeTab.agent',
  session: 'ide.context.scopeTab.session',
};

/** 그 층에서 본 이 줄의 상태 — 위에서 물려받은 값까지 반영. 옛 서버 응답이면 최종값으로 떨어진다. */
export function scopeStateOf(item: ContextSourceItem, level: ContextScopeLevel): boolean {
  return item.scopeStates?.[level] ?? item.enabled;
}

/**
 * 이 층에서 명시값을 지웠을 때 **물려받게 될 값**.
 *
 * 프로젝트 층 위에는 기본값뿐이고, 그 아래 층들은 바로 위 층에서 본 값을 물려받는다.
 */
export function inheritedAt(item: ContextSourceItem, level: ContextScopeLevel): boolean {
  const idx = CONTEXT_SCOPE_LEVELS.indexOf(level);
  if (idx <= 0) return item.defaultEnabled;
  return scopeStateOf(item, CONTEXT_SCOPE_LEVELS[idx - 1]!);
}

/**
 * 이 층에서 스위치를 `next` 로 옮겼을 때 서버에 보낼 값.
 * 물려받을 값과 같아지면 `null`(= 명시값 삭제, 다시 위층을 따라간다) — 되돌리기가 곧 삭제다.
 */
export function nextOverrideValue(
  item: ContextSourceItem,
  level: ContextScopeLevel,
  next: boolean,
): boolean | null {
  return next === inheritedAt(item, level) ? null : next;
}

/** 이 층에 **명시값**이 걸려 있나(= 위층을 따라가지 않는 상태인가). */
export function hasOwnOverride(item: ContextSourceItem, level: ContextScopeLevel): boolean {
  return typeof item.scopeOverrides?.[level] === 'boolean';
}

/**
 * 지금 보고 있는 층보다 **아래에서** 자기 값을 따로 정해 둔 층들.
 *
 * 위층을 누르는 사용자에게 "여기를 바꿔도 저 아래는 안 따라온다"를 알려 주는 근거다. 이걸 안 보여
 * 주면 프로젝트에서 끈 줄이 세션에서는 켜져 있는 것이 **고장으로 보인다** — 실은 사용자가 그렇게
 * 정해 둔 것인데도.
 */
export function lowerOverrideLevels(item: ContextSourceItem, level: ContextScopeLevel): ContextScopeLevel[] {
  const from = CONTEXT_SCOPE_LEVELS.indexOf(level);
  return CONTEXT_SCOPE_LEVELS.slice(from + 1).filter((lv) => hasOwnOverride(item, lv));
}

/** 그 층을 지금 고를 수 있나 — 세션 층은 열린 세션 탭이 있어야 걸 자리가 있다. */
export function scopeSelectable(level: ContextScopeLevel, hasSession: boolean): boolean {
  return level !== 'session' || hasSession;
}

/**
 * 이 층에서 본 합계(켜진 것만) — 층을 바꾸면 머리의 숫자도 그 층 기준으로 움직여야 한다.
 * 표는 그대로인데 합계만 최종값 기준이면 둘이 서로 다른 말을 하게 된다.
 */
export function sumTokensAtScope(
  items: readonly ContextSourceItem[],
  level: ContextScopeLevel,
): { enabled: number; total: number } {
  let enabled = 0;
  let total = 0;
  for (const i of items) {
    total += i.tokens;
    if (scopeStateOf(i, level)) enabled += i.tokens;
  }
  return { enabled, total };
}

/**
 * 누른 직후 화면에 바로 반영할 모습 — 서버 응답을 기다리지 않고 그린다.
 *
 * 규칙은 저장 규칙과 **같아야** 한다: 고른 층의 명시값을 `next` 로 두되 물려받을 값과 같아지면 지우고,
 * **자기 값이 없는 아래층들은 함께 따라 움직인다**(그것이 사용자가 말한 "아래도 다 자동 변경"이다).
 * 자기 값을 든 아래층은 건드리지 않는다. 곧이어 오는 실측(`refresh`)이 이 모습을 덮어쓰므로, 여기서
 * 틀리면 화면이 한 번 튀는 것으로 드러난다 — 그래서 두 규칙을 한 파일에 붙여 둔다.
 */
export function optimisticScopeChange(
  item: ContextSourceItem,
  level: ContextScopeLevel,
  next: boolean,
): ContextSourceItem {
  const own = nextOverrideValue(item, level, next);
  const overrides: Partial<Record<ContextScopeLevel, boolean>> = { ...(item.scopeOverrides ?? {}) };
  if (own === null) delete overrides[level];
  else overrides[level] = own;

  // 위에서 아래로 한 번 훑으며 각 층의 값을 다시 잡는다 — 명시값이 있으면 그것, 없으면 위층 값.
  const states = {} as Record<ContextScopeLevel, boolean>;
  let inherited = item.defaultEnabled;
  for (const lv of CONTEXT_SCOPE_LEVELS) {
    const explicit = overrides[lv];
    const value = typeof explicit === 'boolean' ? explicit : inherited;
    states[lv] = value;
    inherited = value;
  }

  const decided = [...CONTEXT_SCOPE_LEVELS].reverse().find((lv) => typeof overrides[lv] === 'boolean');
  return {
    ...item,
    enabled: states.session,
    ...(decided ? { overrideScope: decided } : { overrideScope: undefined }),
    scopeStates: states,
    ...(Object.keys(overrides).length > 0 ? { scopeOverrides: overrides } : { scopeOverrides: undefined }),
  };
}
