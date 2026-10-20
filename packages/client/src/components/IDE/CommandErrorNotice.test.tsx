import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SUPPORTED_UI_LOCALES } from '@vibisual/shared';
import en from '../../i18n/locales/en.json';
import ko from '../../i18n/locales/ko.json';
import { CommandErrorNotice } from './CommandErrorNotice.js';
import { parseStreamErrorContent } from './commandError.js';

let locale: 'ko' | 'en' = 'ko';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, params: Record<string, string | number> = {}) => {
    const value = key.split('.').reduce<unknown>((obj, part) => obj && typeof obj === 'object'
      ? (obj as Record<string, unknown>)[part] : undefined, locale === 'ko' ? ko : en);
    return typeof value === 'string' ? value.replace(/{{(\w+)}}/g, (_m, name: string) => String(params[name] ?? '')) : key;
  } }),
}));

describe('provider notices', () => {
  it.each(['ko', 'en'] as const)('shows the reported model error with a ChatGPT billing link in %s', (language) => {
    locale = language;
    const content = JSON.stringify({ type: 'error', status: 400, error: {
      type: 'invalid_request_error',
      message: "The 'gpt-6-astra' model is not supported when using Codex with a ChatGPT account.",
    } });
    const html = renderToStaticMarkup(<CommandErrorNotice error={parseStreamErrorContent(`[cli@codex] ${content}`)} />);
    const labels = (language === 'ko' ? ko : en).ide.providerNotice;
    expect(html).toContain(labels.modelAccess.title);
    expect(html).toContain(labels.modelAccess.explanation);
    expect(html).toContain(labels.modelAccess.action);
    expect(html).toContain(labels.chatgptBilling);
    expect(html).toContain('href="https://chatgpt.com/#pricing" target="_blank" rel="noopener noreferrer"');
    expect(html).not.toContain('platform.openai.com');
    expect(html).not.toContain('text-red');
    expect(html).not.toContain('ide.providerNotice.');
    expect(html).toContain('<details');
    expect(html).not.toContain('<details open');
    expect(html.indexOf('gpt-6-astra')).toBeGreaterThan(html.indexOf('<details'));
  });

  it.each(['ko', 'en'] as const)('shows capacity advice and official links with expandable original detail in %s', (language) => {
    locale = language;
    const content = 'Selected model is at capacity. Please try a different model.';
    const html = renderToStaticMarkup(<CommandErrorNotice error={parseStreamErrorContent(`[cli@codex] ${content}`)} />);
    const labels = (language === 'ko' ? ko : en).ide.providerNotice;
    expect(html).toContain(labels.capacity.title);
    expect(html).toContain(labels.capacity.explanation);
    expect(html).toContain(labels.capacity.action);
    expect(html).toContain('<details');
    expect(html).toContain(content);
    expect(html).toContain('href="https://status.openai.com/"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('text-red');
    expect(html).not.toContain('border-red');
    expect(html).not.toContain('<details open');
    expect(html).not.toContain('ide.providerNotice.');
  });

  it('shows the supplied reset time outside collapsed diagnostic details', () => {
    locale = 'ko';
    const html = renderToStaticMarkup(<CommandErrorNotice error={{ code: 'usageLimit', engine: 'claude', detail: "You've hit your session limit · resets 10pm (Asia/Seoul)" }} />);
    expect(html.indexOf('10pm (Asia/Seoul)')).toBeLessThan(html.indexOf('<details'));
  });

  it('keeps an unexplained internal failure visible as an error', () => {
    locale = 'ko';
    const html = renderToStaticMarkup(<CommandErrorNotice error={{ code: 'spawn', engine: 'codex', detail: 'spawn ENOENT' }} />);
    expect(html).toContain('text-red');
    expect(html).toContain('spawn ENOENT');
    expect(html).not.toContain('<details');
    expect(html).not.toContain('https://status.');
  });

  it('escapes CLI detail and never follows an untrusted diagnostic link', () => {
    const html = renderToStaticMarkup(<CommandErrorNotice error={{ code: 'cli', engine: 'codex', detail: 'Selected model is at capacity. <script>alert(1)</script> https://untrusted.example' }} />);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="https://untrusted.example');
  });

  it('has complete guidance in every supported language', () => {
    const bundles = import.meta.glob('../../i18n/locales/*.json', { eager: true, import: 'default' });
    for (const language of SUPPORTED_UI_LOCALES) {
      const bundle = bundles[`../../i18n/locales/${language}.json`] as typeof en;
      const notice = bundle.ide.providerNotice;
      for (const kind of ['capacity', 'rateLimit', 'usageLimit', 'authentication', 'context', 'billing', 'modelAccess', 'unavailable'] as const) {
        for (const field of ['title', 'explanation', 'action'] as const) expect(notice[kind][field].trim(), `${language}/${kind}/${field}`).not.toBe('');
      }
      for (const field of ['details', 'documentation', 'statusPage', 'resets', 'chatgptBilling'] as const) expect(notice[field].trim()).not.toBe('');
      expect(notice.resets).toContain('{{time}}');
    }
  });
});
