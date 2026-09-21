import { describe, expect, it } from 'vitest';
import en from '../../i18n/locales/en.json';
const locales = import.meta.glob('../../i18n/locales/*.json', { eager: true, import: 'default' }) as Record<string, typeof en>;
const flatten = (object: object): string[] => Object.values(object).flatMap((value) => typeof value === 'string' ? [value] : flatten(value));
describe('verification UI translations', () => {
  for (const [path, locale] of Object.entries(locales)) it(`${path} includes translated controls and all placeholders`, () => {
    for (const section of ['tabs', 'connection', 'execution', 'operation', 'error'] as const) {
      expect(Object.keys(locale.ide.verify[section]).sort()).toEqual(Object.keys(en.ide.verify[section]).sort());
      for (const [key, value] of Object.entries(en.ide.verify[section])) {
        const translated = (locale.ide.verify[section] as Record<string, string>)[key]!;
        expect(translated.trim()).not.toBe('');
        expect((translated.match(/\{\{\w+\}\}/g) ?? []).sort()).toEqual((value.match(/\{\{\w+\}\}/g) ?? []).sort());
      }
    }
    if (!path.endsWith('/en.json')) {
      expect(locale.ide.verify.about).not.toBe(en.ide.verify.about);
      expect(locale.ide.verify.connection.browserHint).not.toBe(en.ide.verify.connection.browserHint);
      expect(locale.ide.verify.demo.browserEvidenceOnly).not.toBe(en.ide.verify.demo.browserEvidenceOnly);
      expect(locale.ide.verify.demo.recordRunNeedsMatchingTarget).not.toBe(en.ide.verify.demo.recordRunNeedsMatchingTarget);
    }
    expect(locale.ide.verify.demo.browserEvidenceOnly.trim()).not.toBe('');
    expect(locale.ide.verify.demo.recordRunNeedsMatchingTarget.trim()).not.toBe('');
    expect(flatten(locale.ide.verify).every((value) => !value.includes('undefined'))).toBe(true);
  });
});
