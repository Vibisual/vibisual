import { describe, expect, it } from 'vitest';
import {
  otherSkillProvider, resolveSkillProviderTab, skillProviderTabs, skillSharingCount,
} from './IDESkillProviderTabs.js';

/** §5.5 #17-4 · §5.25 (M-1) — 스킬 칸 엔진 탭: 자기 엔진 탭이 늘 첫째. */
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

  /* 고른 탭은 에이전트마다 — 다른 에이전트에 다녀와도 A 의 탭이 남는다. */
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
