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
  it('shows credits-only measurements with their timestamp and one management link', () => {
    const html = render();
    expect(html).toContain('89 credits');
    expect(html).toContain('Last updated ');
    expect(html).not.toContain('No usage data received yet');
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('https://chatgpt.com/codex/settings/usage');
    expect(html).not.toContain('$15.00');
  });

  it('hides cached credits after logout while leaving the website entry available', () => {
    mocks.state.codexAuth = { loggedIn: false, checkedAt: 2 };
    const html = render();
    expect(html).not.toContain('89 credits');
    expect(html).toContain('Check on website');
    expect(html).toContain('https://chatgpt.com/codex/settings/usage');
  });

  it('uses the selected provider resources and omits billing entirely for local models', () => {
    mocks.state.userDefaults = { engineChoice: { kind: 'claude' } };
    const claude = render();
    expect(claude).toContain('$15.00');
    expect(claude).toContain('https://claude.ai/settings/usage');
    expect(claude).not.toContain('89 credits');
    mocks.state.userDefaults = { engineChoice: { kind: 'local' } };
    const local = render();
    expect(local).toContain('Local hardware');
    expect(local).not.toContain('<a ');
    expect(local).not.toContain('Available extras');
  });
});
