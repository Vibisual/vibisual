import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ProviderUsage } from '@vibisual/shared';
import en from '../../i18n/locales/en.json';
import { LimitGauge } from './LimitGauge.js';
import { UsageManagement, UsageResources } from './UsageResources.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  i18n: { language: 'en' },
  t: (key: string, values: Record<string, unknown> = {}) => {
    const value = key.split('.').reduce<unknown>((current, part) => (current as Record<string, unknown>)?.[part], en);
    return String(value ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? ''));
  },
}) }));

const usage = (data: Partial<ProviderUsage>): ProviderUsage => ({ windows: [], fetchedAt: 1000, ...data });
const renderCodex = (data?: Partial<ProviderUsage>): string => renderToStaticMarkup(createElement(UsageResources, {
  provider: 'codex', codexUsage: data ? usage(data) : null,
}));

describe('usage resources', () => {
  it('shows the reported balance and authoritative pass count even when detail rows are capped', () => {
    const html = renderCodex({
      credits: { hasCredits: true, unlimited: false, balance: '120.50' },
      resetCredits: { availableCount: 3, credits: [
        { id: 'pass', resetType: 'codexRateLimits', status: 'available', title: 'Weekly reset', expiresAt: 2_000_000_000_000 },
        { id: 'used', resetType: 'codexRateLimits', status: 'redeemed', title: 'Already redeemed' },
      ] },
    });
    expect(html).toContain('120.50 credits');
    expect(html).toContain('3 available');
    expect(html).toContain('Weekly reset');
    expect(html).toContain('Expires ');
    expect(html).not.toContain('Already redeemed');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<a ');
  });

  it('distinguishes missing readings, zero balances, and zero passes', () => {
    const missing = renderCodex();
    expect(missing).toContain('Check on website');
    expect(missing).not.toContain('0 credits');
    expect(missing).not.toContain('0 available');
    const zero = renderCodex({ credits: { hasCredits: false, unlimited: false, balance: '0' }, resetCredits: { availableCount: 0 } });
    expect(zero).toContain('0 credits');
    expect(zero).toContain('0 available');
  });

  it('does not manufacture a balance from availability and gives unlimited precedence', () => {
    expect(renderCodex({ credits: { hasCredits: true, unlimited: false } })).toContain('Available · balance unknown');
    expect(renderCodex({ credits: { hasCredits: false, unlimited: false } })).toContain('No credits available');
    const unlimited = renderCodex({ credits: { hasCredits: true, unlimited: true, balance: '0' } });
    expect(unlimited).toContain('Unlimited');
    expect(unlimited).not.toContain('0 credits');
  });

  it('distinguishes no expiry from an unreported expiry', () => {
    const html = renderCodex({ resetCredits: { availableCount: 2, credits: [
      { id: 'forever', resetType: 'codexRateLimits', status: 'available', expiresAt: null },
      { id: 'unknown', resetType: 'codexRateLimits', status: 'available' },
    ] } });
    expect(html).toContain('No expiry');
    expect(html).toContain('Expiry not provided');
  });

  it('shows Claude remaining spending budget without presenting it as prepaid balance', () => {
    const html = renderToStaticMarkup(createElement(UsageResources, {
      provider: 'claude', claudeCredits: { enabled: true, usedCredits: 12.5, monthlyLimit: 50, currency: 'USD' },
    }));
    expect(html).toContain('$50.00');
    expect(html).toContain('$12.50');
    expect(html).toContain('$37.50');
    expect(html).toMatch(/Prepaid balance<\/dt><dd[^>]*>Check on website<\/dd>/);
    expect(html).toContain('Remaining budget is a spending limit, not your prepaid balance.');
  });

  it('does not infer a remaining budget from incomplete or invalid readings', () => {
    for (const usedCredits of [undefined, NaN, -1]) {
      const html = renderToStaticMarkup(createElement(UsageResources, {
        provider: 'claude', claudeCredits: { enabled: true, monthlyLimit: 50, usedCredits },
      }));
      expect(html).not.toContain('Remaining monthly budget');
      expect(html).not.toContain('NaN');
    }
  });

  it.each([
    ['codex', 'https://chatgpt.com/codex/settings/usage'],
    ['claude', 'https://claude.ai/settings/usage'],
  ] as const)('offers one external management action for %s', (provider, href) => {
    const html = renderToStaticMarkup(createElement(UsageManagement, { provider }));
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain(`href="${href}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<form');
  });
});

describe('account allowance gauges', () => {
  it('labels both used and remaining amounts without reversing the bar', () => {
    const html = renderToStaticMarkup(createElement(LimitGauge, { label: 'Weekly', used: 75, showRemaining: true }));
    expect(html).toContain('75% used');
    expect(html).toContain('25% remaining');
    expect(html).toContain('width:75%');
  });

  it('keeps missing usage unknown and preserves hardware meter labels', () => {
    const unknown = renderToStaticMarkup(createElement(LimitGauge, { label: 'Weekly', used: undefined, showRemaining: true }));
    expect(unknown).not.toContain('remaining');
    const hardware = renderToStaticMarkup(createElement(LimitGauge, { label: 'CPU', used: 25 }));
    expect(hardware).toContain('25%');
    expect(hardware).not.toContain('remaining');
    expect(hardware).not.toContain('25% used');
  });
});
