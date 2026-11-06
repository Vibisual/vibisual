import { describe, expect, it } from 'vitest';
import type { LocalPlanSummary, SessionLoop } from '@vibisual/shared';
import { currentPresetOf, planActions, planDisplayState } from './localAssistViewModel.js';

/** §5.19 (J) ④ — 끝까지 돕기 패널의 표시 판정: 서버 상태 둘(계획·루프)을 그대로 읽어 그리기만 한다. */

const plan = (state: LocalPlanSummary['state'], done = 1, total = 3): LocalPlanSummary => ({
  state, file: '.vibisual/relay/s.md', done, total, items: [],
});
const loop = (enabled: boolean): SessionLoop => ({
  agentId: 'a', subAgentId: 's', command: 'x', mode: 'count', total: 4, completed: 1, enabled,
  intervalMs: 0, stopOnError: false, contextMode: 'clear', spentCostUsd: 0, spentTokens: 0,
  oneTaskPerRound: false, commitEachRound: false, stopWhenChecklistDone: true,
  status: enabled ? 'running' : 'stopped', createdAt: 1, updatedAt: 1,
});

describe('계획 표시 상태', () => {
  it('릴레이 루프가 실제로 켜져 있을 때만 running, 꺼졌으면 paused', () => {
    expect(planDisplayState(plan('running'), loop(true))).toBe('running');
    expect(planDisplayState(plan('running'), loop(false))).toBe('paused');
    expect(planDisplayState(plan('running'), undefined)).toBe('paused');
    expect(planDisplayState(plan('proposed'), undefined)).toBe('proposed');
  });

  it('남은 항목이 없으면 시작 손잡이를 내지 않는다', () => {
    expect(planActions('proposed', 2)).toEqual(['approve', 'reset']);
    expect(planActions('paused', 2)).toEqual(['resume', 'reset']);
    expect(planActions('approved', 0)).toEqual(['reset']);
    expect(planActions('running', 2)).toEqual(['reset']);
    expect(planActions('done', 0)).toEqual(['reset']);
  });
});

describe('프리셋 이름', () => {
  it('비면 off, 이름이 없는데 칸이 있으면 custom', () => {
    expect(currentPresetOf(undefined)).toBe('off');
    expect(currentPresetOf({})).toBe('off');
    expect(currentPresetOf({ tidyAt: 80 })).toBe('custom');
    expect(currentPresetOf({ tidyAt: 80, preset: 'balanced' })).toBe('balanced');
  });
});
