/**
 * §5.5 #17-28 ② — 주입원 통제 층 셋의 화면 규칙(순수, 최종 판정은 공용 `resolveContextEnabled`). 스위치는 최종값이 아니라 그 층에서 본 값을 그린다
 * (최종값이면 아래층 명시값이 걸린 줄이 위층에서 안 움직인다). 저장/삭제는 `defaultEnabled` 가 아니라 물려받을 값과 비교한다(아래층이 위층을 이겨야 한다).
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

/** 명시값을 지우면 물려받을 값 — 프로젝트 층은 기본값, 아래 층은 바로 위 층에서 본 값. */
export function inheritedAt(item: ContextSourceItem, level: ContextScopeLevel): boolean {
  const idx = CONTEXT_SCOPE_LEVELS.indexOf(level);
  if (idx <= 0) return item.defaultEnabled;
  return scopeStateOf(item, CONTEXT_SCOPE_LEVELS[idx - 1]!);
}

/** 서버에 보낼 값. 물려받을 값과 같아지면 `null`(명시값 삭제 → 위층을 따른다) — 되돌리기가 곧 삭제다. */
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

/** 아래에서 자기 값을 정해 둔 층들 — "여기를 바꿔도 아래는 안 따라온다"를 보여야 아래층의 다른 값이 고장으로 안 보인다. */
export function lowerOverrideLevels(item: ContextSourceItem, level: ContextScopeLevel): ContextScopeLevel[] {
  const from = CONTEXT_SCOPE_LEVELS.indexOf(level);
  return CONTEXT_SCOPE_LEVELS.slice(from + 1).filter((lv) => hasOwnOverride(item, lv));
}

/** 그 층을 지금 고를 수 있나 — 세션 층은 열린 세션 탭이 있어야 걸 자리가 있다. */
export function scopeSelectable(level: ContextScopeLevel, hasSession: boolean): boolean {
  return level !== 'session' || hasSession;
}

/** 그 층 기준 합계(켜진 것만) — 표는 층 기준인데 합계만 최종값이면 둘이 다른 말을 한다. */
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

/** 낙관 모습 — 저장 규칙과 같아야 한다(고른 층 `next`, 물려받을 값과 같으면 지움 · 자기 값 없는 아래층은 따라감 · 자기 값 든 층은 그대로). 틀리면 `refresh` 때 화면이 튄다. */
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
