import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../i18n/locales/en.json';
import { UsagePopup } from './UsagePopup.js';

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  codex: { usage: { windows: [], fetchedAt: 1000, credits: { hasCredits: true, unlimited: false, balance: '89' } }, busy: false },
}));
vi.mock('../../stores/graphStore.js', () => ({ useGraphStore: (select: (state: Record<string, unknown>) => unknown) => select(mocks.state) }));
vi.mock('../../hooks/useCodexUsage.js', () => ({ useCodexUsage: () => mocks.codex, refreshCodexUsage: vi.fn() }));
vi.mock('../ScrollFade.js', () => ({ ScrollFade: ({ children }: { children: ReactNode }) => createElement('div', { 'data-scroll': true }, children) }));
vi.mock('../Engine/ProviderTabs.js', () => ({ ProviderTabs: () => null }));
vi.mock('./CostPill.js', () => ({ CostPill: () => null }));
vi.mock('./LocalResourceSection.js', () => ({ LocalResourceSection: () => createElement('div', null, 'Local hardware') }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  i18n: { language: 'en' },
  t: (key: string, values: Record<string, unknown> = {}) => {
    const value = key.split('.').reduce<unknown>((current, part) => (current as Record<string, unknown>)?.[part], en);
    return String(value ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? ''));
  },
}) }));

const render = (): string => renderToStaticMarkup(createElement(UsagePopup, { onClose: () => undefined }));

beforeEach(() => {
  mocks.state = {
    userDefaults: { engineChoice: { kind: 'codex' } },
    codexAuth: { loggedIn: true, checkedAt: 1 },
    claudeAuth: { loggedIn: true, checkedAt: 1 },
    claudeUsage: { limits: [], extraCredits: { enabled: true, usedCredits: 5, monthlyLimit: 20, currency: 'USD' }, fetchedAt: 1000 },
    agents: [], agentProjects: {}, activeProject: null,
  };
});

describe('usage popup resource integration', () => {
  it('gives Codex the same credit pages as Claude: plan limits first, then personal and business credits', () => {
    const html = render();
    // §4 OpenAI 비즈니스 크레딧 — 코덱스 탭도 지갑마다 페이지. 클라우드 페이지는 Claude 판에만 있다.
    for (const tab of ['Plan limits', 'Personal credits', 'Business credits']) expect(html).toContain(tab);
    expect(html).not.toContain('Cloud credits');
    expect(html).toContain('Last updated ');
    expect(html).not.toContain('No usage data received yet');
    // 관리하는 곳은 페이지 설명 칸이 말한다 — 바닥 링크는 없다.
    expect(html).not.toContain('<a ');
    expect(html).toContain('https://chatgpt.com/codex/settings/usage');
    expect(html).toContain(en.panel.usage.creditPages.openai.subscription.what);
    // 개인 크레딧 금액은 자기 페이지에만 있다.
    expect(html).not.toContain('89 credits');
    expect(html).not.toContain('$15.00');
  });

  it('asks to sign in after logout while leaving the website entry available', () => {
    mocks.state.codexAuth = { loggedIn: false, checkedAt: 2 };
    const html = render();
    expect(html).not.toContain('89 credits');
    expect(html).toContain(en.providers.signIn);
    expect(html).toContain('https://chatgpt.com/codex/settings/usage');
  });

  it('uses the selected provider resources and omits billing entirely for local models', () => {
    mocks.state.userDefaults = { engineChoice: { kind: 'claude' } };
    const claude = render();
    // §4 API 크레딧 — Claude 탭은 구독 한도 페이지로 열리고 개인 크레딧 금액은 자기 페이지에만 있다.
    for (const tab of ['Plan limits', 'Personal credits', 'Business credits', 'Cloud credits']) expect(claude).toContain(tab);
    expect(claude).not.toContain('$15.00');
    expect(claude).toContain('https://claude.ai/settings/usage');
    expect(claude).not.toContain('89 credits');
    mocks.state.userDefaults = { engineChoice: { kind: 'local' } };
    const local = render();
    expect(local).toContain('Local hardware');
    expect(local).not.toContain('<a ');
    expect(local).not.toContain('Available extras');
  });
});

describe('usage popup — Claude plan limits follow what the CLI reports', () => {
  const NOW = Date.now();

  it('draws no 5-hour row for a plan without one (verified Ultra) and names the plan', () => {
    mocks.state.userDefaults = { engineChoice: { kind: 'claude' } };
    mocks.state.claudeUsage = {
      plan: 'Ultra',
      limits: [
        { kind: 'weekly_all', group: 'weekly', percent: 4, severity: 'normal', resetsAt: NOW + 72 * 3_600_000, isActive: true },
        { kind: 'weekly_scoped', group: 'weekly', percent: 0, severity: 'normal', resetsAt: NOW + 73 * 3_600_000, isActive: false, scopeLabel: 'Fable' },
      ],
      source: 'cli',
      fetchedAt: NOW,
    };
    const html = render();
    expect(html).toContain('Ultra');
    expect(html).not.toContain('>5-hour limit</span>');
    expect(html).toContain('Weekly limit (all models)');
    expect(html).toContain('Weekly limit (Fable)');
    expect(html.match(/Resets /g)?.length).toBe(2);
  });

  it('keeps the 5-hour row when the CLI reports one', () => {
    mocks.state.userDefaults = { engineChoice: { kind: 'claude' } };
    mocks.state.claudeUsage = {
      plan: 'Max',
      limits: [
        { kind: 'session', group: 'session', percent: 12, severity: 'normal', resetsAt: NOW + 3_600_000, isActive: true },
        { kind: 'weekly_all', group: 'weekly', percent: 40, severity: 'normal', isActive: true },
      ],
      source: 'cli',
      fetchedAt: NOW,
    };
    const html = render();
    expect(html).toContain('>5-hour limit</span>');
    expect(html).toContain('Weekly limit (all models)');
  });

  it('holds both places open only while nothing has been received yet', () => {
    mocks.state.userDefaults = { engineChoice: { kind: 'claude' } };
    mocks.state.claudeUsage = { limits: [], source: 'cli', fetchedAt: 0 };
    const html = render();
    expect(html).toContain('>5-hour limit</span>');
    expect(html).toContain('Weekly limit (all models)');
  });
});
