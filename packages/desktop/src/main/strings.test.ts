import { describe, expect, it } from 'vitest';
import { mainStrings } from './strings';

const LOCALES = ['en', 'ko', 'ja', 'zh-CN', 'es', 'es-419', 'fr', 'de', 'hi', 'id', 'it', 'pt-BR'] as const;
const RECOVERY_KEYS = ['crashTitle', 'crashMessage', 'crashReload', 'quitBtnCancel'] as const;

describe('native crash recovery strings', () => {
  it.each(LOCALES)('provides a complete usable recovery dialog for %s', (locale) => {
    const strings = mainStrings(locale);
    for (const key of RECOVERY_KEYS) {
      expect(strings[key].trim(), `${locale}.${key}`).not.toBe('');
      expect(strings[key], `${locale}.${key}`).not.toMatch(/\{[^}]+\}|\uFFFD/);
    }
    expect(strings.crashReload).not.toBe(strings.quitBtnCancel);
  });

  it.each(LOCALES.filter((locale) => locale !== 'en'))('uses translated recovery content for %s', (locale) => {
    const strings = mainStrings(locale);
    const english = mainStrings('en');
    for (const key of RECOVERY_KEYS) {
      expect(strings[key], `${locale}.${key}`).not.toBe(english[key]);
    }
  });

  it.each([undefined, null, '', 'unknown', 'en-US', 'KO', 'constructor', '__proto__'])(
    'falls back to English for unsupported or unavailable locale %s', (locale) => {
      expect(mainStrings(locale)).toBe(mainStrings('en'));
    },
  );
});
