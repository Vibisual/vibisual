import { describe, it, expect } from 'vitest';
import { BUILTIN_APP_THEMES, SUPPORTED_UI_LOCALES, type AppThemeIssueCode } from '@vibisual/shared';

/** §4 앱 테마 — **테마 목록·문제 코드와 번역이 한 벌인가.** 동적 키(`…theme.builtin.<i18nKey>.name` · `…theme.issue.<code>`)라 번역을 잊으면 빌드는 멀쩡한 채 키가 뜬다. */

type Dict = Record<string, unknown>;

const localeSources = import.meta.glob('./locales/*.json', { eager: true });

function localeDict(loc: string): Dict {
  const mod = localeSources[`./locales/${loc}.json`] as { default?: Dict } | undefined;
  if (!mod) throw new Error(`로케일 파일이 없다: ${loc}.json`);
  return (mod.default ?? mod) as Dict;
}

function themeStrings(locale: Dict): Dict {
  const panel = locale.panel as Dict | undefined;
  const options = panel?.options as Dict | undefined;
  return (options?.theme ?? {}) as Dict;
}

/** 문제 코드 전부 — `Record` 라 코드가 하나 늘면 여기서 타입 오류가 나 표를 고치게 된다. */
const ISSUE_CODES: Record<AppThemeIssueCode, true> = {
  tooMany: true,
  tooLarge: true,
  readFailed: true,
  invalidJson: true,
  notObject: true,
  unsupportedVersion: true,
  missingName: true,
  duplicateId: true,
  unknownBase: true,
  extendsCycle: true,
  invalidColor: true,
  unknownToken: true,
  unknownFamily: true,
  invalidRamp: true,
  invalidField: true,
};

const nonEmpty = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;

describe('앱 테마 ↔ 번역', () => {
  for (const loc of SUPPORTED_UI_LOCALES) {
    const theme = themeStrings(localeDict(loc));

    it(`${loc}: 기본 테마마다 이름·설명이 있다`, () => {
      const builtin = (theme.builtin ?? {}) as Record<string, Dict | undefined>;
      const missing = BUILTIN_APP_THEMES
        .filter((t) => t.i18nKey && (!nonEmpty(builtin[t.i18nKey]?.name) || !nonEmpty(builtin[t.i18nKey]?.desc)))
        .map((t) => t.id);
      expect(missing).toEqual([]);
    });

    it(`${loc}: 문제 코드마다 문장이 있다`, () => {
      const issue = (theme.issue ?? {}) as Record<string, unknown>;
      const missing = Object.keys(ISSUE_CODES).filter((code) => !nonEmpty(issue[code]));
      expect(missing).toEqual([]);
    });
  }

  it('기본 테마는 모두 번역 키를 갖는다', () => {
    expect(BUILTIN_APP_THEMES.filter((t) => !t.i18nKey).map((t) => t.id)).toEqual([]);
  });
});
