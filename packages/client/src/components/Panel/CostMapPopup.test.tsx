import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyCostTotals, type CostPeriodTotals, type CostSessionEntry, type ProjectCostMap } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { CostMapPopup } from './CostMapPopup.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../hooks/usePopupDismiss.js', () => ({ useBackdropDismiss: () => ({}) }));
vi.mock('../ScrollFade.js', () => ({ ScrollFade: ({ children }: { children: ReactNode }) => children }));
vi.mock('../../stores/graphStore.js', async () => {
  const { create: makeStore } = await import('zustand');
  return { useGraphStore: makeStore(() => ({})) };
});

const now = new Date(2026, 8, 21, 12).getTime();
let view: ReactTestRenderer | undefined;

function periods(today: number, all: number): CostPeriodTotals {
  const total = (costUsd: number) => ({ ...emptyCostTotals(), inputTokens: 1000, costUsd });
  return { today: total(today), week: total(all), month: total(all), all: total(all) };
}

function session(provider: 'codex' | 'claude', costUsd: number): CostSessionEntry {
  return {
    ...emptyCostTotals(), costUsd, inputTokens: 1000, sessionId: `${provider}-session`,
    agentId: `${provider}-agent`, projectName: 'project', label: `${provider} session`, provider,
    model: provider === 'codex' ? 'gpt-5.4' : 'claude-sonnet-4-6',
    turns: 1, firstAt: now, lastAt: now, measured: true,
  };
}

function map(sessions: CostSessionEntry[]): ProjectCostMap {
  return {
    projectName: 'project', sessions, days: [], measured: true, updatedAt: now,
    // Deliberately differs from cumulative session costs: the UI must use server period totals.
    periods: periods(3, 17),
    agents: sessions.map((s) => ({
      ...emptyCostTotals(), costUsd: s.costUsd, agentId: s.agentId!, label: `${s.provider} agent`,
      provider: s.provider, model: s.model, sessions: 1, turns: 1, lastAt: now, measured: true,
      periods: periods(1, s.costUsd),
    })),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  useGraphStore.setState({ activeProject: 'project', costMaps: [], selectNode: vi.fn() });
});

afterEach(() => {
  act(() => { view?.unmount(); });
  view = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function render(costMap: ProjectCostMap): void {
  useGraphStore.setState({ costMaps: [costMap] });
  act(() => { view = create(createElement(CostMapPopup, { onClose: vi.fn() })); });
}

const text = () => JSON.stringify(view?.toJSON());

describe('CostMapPopup Codex costs', () => {
  it('shows Codex-only project costs, model, and estimate explanation', () => {
    render(map([session('codex', 12)]));
    expect(text()).toContain('Codex');
    expect(text()).toContain('gpt-5.4');
    expect(text()).toContain('$12.00');
    expect(text()).toContain('panel.cost.codexEstimateNote');
    expect(text()).not.toContain('panel.cost.emptyHint');
  });

  it('keeps both providers visible and switches to server period totals', () => {
    render(map([session('codex', 12), session('claude', 5)]));
    expect(text()).toContain('Codex');
    expect(text()).toContain('Claude');
    expect(text()).toContain('$3.00');
    const all = view!.root.findAllByType('button').find((b) => b.children.includes('panel.cost.periodAll'))!;
    act(() => { all.props.onClick(); });
    expect(text()).toContain('$17.00');
    expect(text()).not.toContain('$3.00');
  });

  it('preserves the unmeasured state instead of claiming a zero Codex cost', () => {
    render({ ...map([session('codex', 0)]), measured: false });
    expect(text()).toContain('panel.cost.emptyHint');
    expect(text()).not.toContain('$0.00');
  });

  it('keeps old Claude checkpoints readable without a provider field', () => {
    const old = session('claude', 5);
    delete old.provider;
    render(map([old]));
    expect(text()).toContain('$5.00');
    expect(text()).not.toContain('panel.cost.codexEstimateNote');
  });
});
