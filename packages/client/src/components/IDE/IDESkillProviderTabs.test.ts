import { describe, expect, it } from 'vitest';
import {
  otherSkillProvider, resolveSkillProviderTab, skillProviderTabs, skillSharingCount,
} from './IDESkillProviderTabs.js';

/**
 * §5.5 #17-4 · §5.25 (M-1) — 스킬 칸 엔진 탭의 규칙.
 * 신고: 클로드 칸을 열면 공유 구역("Codex의 스킬")이 자기 스킬보다 위에 서서 남의 목록부터 보였다.
 */
describe('skill provider tabs', () => {
  it('always puts the agent’s own engine first', () => {
    expect(skillProviderTabs('claude')).toEqual(['claude', 'codex']);
    expect(skillProviderTabs('codex')).toEqual(['codex', 'claude']);
    expect(otherSkillProvider('claude')).toBe('codex');
    expect(otherSkillProvider('codex')).toBe('claude');
  });

  it('opens on the own tab until a tab is picked for this agent', () => {
    expect(resolveSkillProviderTab(undefined, 'agent-a', 'claude')).toBe('claude');
    expect(resolveSkillProviderTab({}, 'agent-a', 'claude')).toBe('claude');
    expect(resolveSkillProviderTab({ 'agent-a': 'codex' }, 'agent-a', 'claude')).toBe('codex');
  });

  it('does not carry a pick over to another agent', () => {
    expect(resolveSkillProviderTab({ 'agent-a': 'codex' }, 'agent-b', 'claude')).toBe('claude');
    expect(resolveSkillProviderTab({ 'agent-a': 'claude' }, 'agent-b', 'codex')).toBe('codex');
  });

  /*
   * 종전에는 칸 하나에 한 벌만 기억해, A 에서 Codex 탭을 고르고 B 에 다녀오면 B 에서 탭을 골랐는지에 따라
   * A 의 탭이 되살아나기도(안 고름) 사라지기도(고름) 했다. 이제 기억이 에이전트마다라 두 길이 같은 곳에 닿는다.
   */
  it('keeps an agent’s pick however the other agent was visited', () => {
    const visitedWithoutPick = { 'agent-a': 'codex' } as const;
    const visitedWithPick = { 'agent-a': 'codex', 'agent-b': 'codex' } as const;
    expect(resolveSkillProviderTab(visitedWithoutPick, 'agent-a', 'claude')).toBe('codex');
    expect(resolveSkillProviderTab(visitedWithPick, 'agent-a', 'claude')).toBe('codex');
    expect(resolveSkillProviderTab(visitedWithPick, 'agent-b', 'claude')).toBe('codex');
  });

  it('leaves the shared count blank while it is unknown instead of claiming zero', () => {
    expect(skillSharingCount({ loading: true, error: null, skills: [] })).toBeNull();
    expect(skillSharingCount({ loading: false, error: { action: 'load' }, skills: [] })).toBeNull();
    expect(skillSharingCount({ loading: false, error: null, skills: [] })).toBe(0);
    // 가져오기 한 줄이 실패해도 목록은 그대로 있다 — 개수는 여전히 사실이다.
    expect(skillSharingCount({ loading: false, error: { action: 'share' }, skills: [1, 2] })).toBe(2);
  });
});
