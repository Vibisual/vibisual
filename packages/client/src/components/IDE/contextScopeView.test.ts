/**
 * §5.5 #17-28 ② — 층 셋의 화면 규칙 테스트.
 *
 * 여기서 못 박는 것은 사용자가 말한 두 문장 그대로다:
 *  ① "프로젝트에서 옵션을 바꾸면 아래 에이전트·세션도 다 자동 변경" (상속)
 *  ② "개별 변경을 한 게 있으면 아래로 갈수록 그게 우선" (오버라이드)
 *
 * 그리고 이 기능이 실제로 고장 나 있던 자리 — **아래층에서 위층과 다른 값으로 되돌리기** — 를
 * 회귀로 고정한다(종전에는 "기본값과 같다"는 이유로 그 명시값이 지워져 도로 위층 값으로 굴러떨어졌다).
 */
import { describe, it, expect } from 'vitest';
import type { ContextScopeLevel, ContextSourceItem } from '@vibisual/shared';
import {
  hasOwnOverride,
  inheritedAt,
  lowerOverrideLevels,
  nextOverrideValue,
  optimisticScopeChange,
  scopeSelectable,
  scopeStateOf,
  sumTokensAtScope,
} from './contextScopeView.js';

/** 서버가 준 한 줄을 흉내 낸다 — `scopeStates` 는 명시값을 위에서 아래로 흘려 만든 것과 같다. */
function item(
  overrides: Partial<Record<ContextScopeLevel, boolean>> = {},
  defaultEnabled = true,
  tokens = 100,
): ContextSourceItem {
  const states = {} as Record<ContextScopeLevel, boolean>;
  let inherited = defaultEnabled;
  for (const lv of ['project', 'agent', 'session'] as const) {
    const v = overrides[lv];
    states[lv] = typeof v === 'boolean' ? v : inherited;
    inherited = states[lv];
  }
  return {
    id: 'vibisual.goal',
    category: 'vibisual',
    title: 'Goal',
    chars: tokens * 4,
    tokens,
    control: 'session',
    defaultEnabled,
    enabled: states.session,
    scopeStates: states,
    ...(Object.keys(overrides).length > 0 ? { scopeOverrides: overrides } : {}),
  };
}

describe('층에서 본 값 — 위를 물려받는다', () => {
  it('아무 층도 안 정했으면 세 층 다 기본값이다', () => {
    const i = item();
    expect(scopeStateOf(i, 'project')).toBe(true);
    expect(scopeStateOf(i, 'agent')).toBe(true);
    expect(scopeStateOf(i, 'session')).toBe(true);
  });

  it('프로젝트에서 끄면 아래 두 층도 함께 꺼져 보인다 (자동 변경)', () => {
    const i = item({ project: false });
    expect(scopeStateOf(i, 'agent')).toBe(false);
    expect(scopeStateOf(i, 'session')).toBe(false);
    expect(hasOwnOverride(i, 'agent')).toBe(false); // 물려받는 중이라 자기 값은 없다
  });

  it('아래층이 자기 값을 들면 위층을 안 따라간다 (아래가 우선)', () => {
    const i = item({ project: false, session: true });
    expect(scopeStateOf(i, 'project')).toBe(false);
    expect(scopeStateOf(i, 'agent')).toBe(false);
    expect(scopeStateOf(i, 'session')).toBe(true);
    expect(i.enabled).toBe(true);
  });

  it('에이전트 층은 프로젝트와 세션 사이에 선다', () => {
    const i = item({ project: true, agent: false });
    expect(scopeStateOf(i, 'agent')).toBe(false);
    expect(scopeStateOf(i, 'session')).toBe(false); // 세션은 에이전트를 물려받는다
  });

  it('옛 서버 응답(층 정보 없음)이면 최종값으로 떨어진다', () => {
    const legacy = { ...item(), scopeStates: undefined, enabled: false } as ContextSourceItem;
    expect(scopeStateOf(legacy, 'project')).toBe(false);
  });
});

describe('되돌리기 = 삭제 — 단, 기준은 기본값이 아니라 물려받을 값', () => {
  it('프로젝트 층은 기본값과 같아질 때 지운다', () => {
    const i = item({ project: false });
    expect(inheritedAt(i, 'project')).toBe(true);
    expect(nextOverrideValue(i, 'project', true)).toBeNull();
    expect(nextOverrideValue(i, 'project', false)).toBe(false);
  });

  it('프로젝트가 끈 줄을 세션에서 켜면 **저장**된다 (종전엔 지워져 도로 꺼졌다)', () => {
    const i = item({ project: false });
    expect(inheritedAt(i, 'session')).toBe(false); // 기본값(true)이 아니라 물려받을 값(false)
    expect(nextOverrideValue(i, 'session', true)).toBe(true);
  });

  it('세션이 위층과 같은 값으로 돌아오면 그때 지운다 (다시 따라가기)', () => {
    const i = item({ project: false, session: true });
    expect(nextOverrideValue(i, 'session', false)).toBeNull();
  });

  it('에이전트 층도 같은 규칙 — 기준은 바로 위(프로젝트)에서 본 값', () => {
    const i = item({ project: false });
    expect(inheritedAt(i, 'agent')).toBe(false);
    expect(nextOverrideValue(i, 'agent', true)).toBe(true);
    expect(nextOverrideValue(i, 'agent', false)).toBeNull();
  });
});

describe('아래층이 따로 정해 뒀다는 표시', () => {
  it('위층을 보는 동안 아래층의 명시값만 알려 준다', () => {
    const i = item({ project: false, session: true });
    expect(lowerOverrideLevels(i, 'project')).toEqual(['session']);
    expect(lowerOverrideLevels(i, 'agent')).toEqual(['session']);
    expect(lowerOverrideLevels(i, 'session')).toEqual([]);
  });

  it('아래층이 물려받는 중이면 표시하지 않는다', () => {
    expect(lowerOverrideLevels(item({ project: false }), 'project')).toEqual([]);
  });
});

describe('낙관 반영 — 서버 응답 전에 그리는 모습', () => {
  it('위층을 바꾸면 자기 값이 없는 아래층도 함께 움직인다', () => {
    const next = optimisticScopeChange(item(), 'project', false);
    expect(next.scopeStates).toEqual({ project: false, agent: false, session: false });
    expect(next.enabled).toBe(false);
    expect(next.overrideScope).toBe('project');
  });

  it('자기 값을 든 아래층은 그대로 버틴다', () => {
    const next = optimisticScopeChange(item({ session: true }), 'project', false);
    expect(next.scopeStates).toEqual({ project: false, agent: false, session: true });
    expect(next.enabled).toBe(true);
    expect(next.overrideScope).toBe('session');
  });

  it('아래층에서 위층과 다른 값으로 켜면 그 층만 켜진다', () => {
    const next = optimisticScopeChange(item({ project: false }), 'session', true);
    expect(next.scopeOverrides).toEqual({ project: false, session: true });
    expect(next.enabled).toBe(true);
  });

  it('위층과 같은 값으로 되돌리면 명시값이 사라져 다시 따라간다', () => {
    const next = optimisticScopeChange(item({ project: false, session: true }), 'session', false);
    expect(next.scopeOverrides).toEqual({ project: false });
    expect(next.scopeStates).toEqual({ project: false, agent: false, session: false });
  });

  it('마지막 명시값까지 지우면 층 배지가 사라진다', () => {
    const next = optimisticScopeChange(item({ project: false }), 'project', true);
    expect(next.scopeOverrides).toBeUndefined();
    expect(next.overrideScope).toBeUndefined();
    expect(next.enabled).toBe(true);
  });
});

describe('층 고르기와 합계', () => {
  it('세션 층은 열린 탭이 있어야 고를 수 있다', () => {
    expect(scopeSelectable('session', false)).toBe(false);
    expect(scopeSelectable('session', true)).toBe(true);
    expect(scopeSelectable('project', false)).toBe(true);
    expect(scopeSelectable('agent', false)).toBe(true);
  });

  it('합계도 그 층 기준으로 센다 — 표와 머리가 다른 말을 하지 않게', () => {
    const items = [item({ project: false }, true, 100), item({ session: false }, true, 40)];
    expect(sumTokensAtScope(items, 'project')).toEqual({ enabled: 40, total: 140 });
    expect(sumTokensAtScope(items, 'session')).toEqual({ enabled: 0, total: 140 });
  });
});
