import { SUPPORTED_UI_LOCALES } from '@vibisual/shared';
import { describe, expect, it } from 'vitest';

interface RecoveryLocale {
  common: { appError: Record<string, string> };
}

const locales = import.meta.glob<RecoveryLocale>('../../i18n/locales/*.json', { eager: true, import: 'default' });
const english = locales['../../i18n/locales/en.json']?.common.appError;

describe('AppErrorBoundary recovery copy', (): void => {
  it.each(SUPPORTED_UI_LOCALES)('provides complete recovery controls in %s', (locale: string): void => {
    const copy = locales[`../../i18n/locales/${locale}.json`]?.common.appError;
    expect(copy).toBeDefined();
    expect(Object.keys(copy ?? {}).sort()).toEqual(['description', 'retry', 'title']);
    for (const key of ['title', 'description', 'retry']) {
      expect(copy?.[key]?.trim().length).toBeGreaterThan(0);
      if (locale !== 'en') expect(copy?.[key]).not.toEqual(english?.[key]);
    }
  });
});
