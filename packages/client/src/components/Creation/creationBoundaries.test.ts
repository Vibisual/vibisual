import { describe, expect, it } from 'vitest';
import en from '../../i18n/locales/en.json';
import { CREATION_ERROR_CODES, creationErrorKey } from './creationErrors.js';

/**
 * §5.13 (R-10) — the creation apps share code only through `components/Creation`: an app never imports another app's
 * internal files (Vibimage ↔ Vibi3D ↔ VideoStudio), and the shared folder imports no app.
 */
const sources = import.meta.glob(['../Vibimage/*.{ts,tsx}', '../Vibi3D/*.{ts,tsx}', '../VideoStudio/*.{ts,tsx}', './*.{ts,tsx}'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;
const APPS = ['Vibimage', 'Vibi3D', 'VideoStudio'] as const;
const owner = (file: string): string => file.startsWith('./') ? 'Creation' : file.split('/')[1]!;

describe('creation app boundaries', () => {
  it('no app imports another app, and the shared modules import no app', () => {
    const offenders: string[] = [];
    for (const [file, source] of Object.entries(sources)) {
      if (/\.test\.tsx?$/.test(file)) continue;
      const self = owner(file);
      // Lazy imports cross the same app boundary as static imports and re-exports.
      for (const match of source.matchAll(/\b(?:from\s+|import\s*\()\s*['"]\.\.\/(Vibimage|Vibi3D|VideoStudio)\//g)) if (match[1] !== self) offenders.push(`${file} → ${match[1]}`);
    }
    expect(Object.keys(sources).filter((file) => APPS.some((app) => file.includes(`/${app}/`))).length).toBeGreaterThan(30);
    expect(offenders).toEqual([]);
  });
});

describe('creation error sentences', () => {
  it('every code the screens can show has an English sentence (the other locales are checked by untranslatedCopy)', () => {
    const flat = (node: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> => {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object') flat(value, path, out); else if (typeof value === 'string') out[path] = value;
      }
      return out;
    };
    const keys = flat(en);
    const missing = [...CREATION_ERROR_CODES, 'unexpected'].map(creationErrorKey).filter((key) => !keys[key]);
    expect(missing).toEqual([]);
  });
});
