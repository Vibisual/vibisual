/**
 * §3.7 · §9 「시작 화면(스플래시)」 — 스플래시 문구 표. 렌더러 i18next 가 뜨기 전에 그리므로 main 이 표를 든다.
 * 표는 `@vibisual/shared` 를 부르지 않는다(시작 진입점 청크가 가벼워야 한다) — 그래서 로케일 목록이 앱과 같은지는 여기서 본다.
 */
import { describe, expect, it } from 'vitest';
import { SUPPORTED_UI_LOCALES } from '@vibisual/shared';
import { fillSplash, isSplashLocale, SPLASH_LOCALES, splashStrings } from './splashStrings';
import { CONSENT_LANGUAGES } from './consentStrings';

const PICTOGRAPH = /\p{Extended_Pictographic}/u;

describe('스플래시 문구 표', () => {
  it('로케일 목록이 앱의 UI 로케일과 같다(동의 창과도)', () => {
    expect([...SPLASH_LOCALES].sort()).toEqual([...SUPPORTED_UI_LOCALES].sort());
    expect([...SPLASH_LOCALES].sort()).toEqual(CONSENT_LANGUAGES.map((l) => l.locale).sort());
  });

  it('모든 언어가 모든 칸을 채웠고, 이모지가 없다', () => {
    const keys = Object.keys(splashStrings('en'));
    for (const locale of SPLASH_LOCALES) {
      const s = splashStrings(locale) as unknown as Record<string, string>;
      expect(Object.keys(s).sort(), locale).toEqual([...keys].sort());
      for (const key of keys) {
        expect(s[key]?.trim().length, `${locale}.${key}`).toBeGreaterThan(0);
        expect(PICTOGRAPH.test(s[key] ?? ''), `${locale}.${key} 에 이모지`).toBe(false);
      }
      expect(s['projects'], `${locale}.projects`).toContain('{done}');
      expect(s['projects'], `${locale}.projects`).toContain('{total}');
    }
  });

  it('번역이 영어를 그대로 들고 있지 않다(로딩 문구) — 영어권 밖 사용자가 읽을 수 있어야 한다', () => {
    const en = splashStrings('en');
    for (const locale of SPLASH_LOCALES.filter((l) => l !== 'en')) {
      expect(splashStrings(locale).loading, locale).not.toBe(en.loading);
      expect(splashStrings(locale).workspace, locale).not.toBe(en.workspace);
    }
  });

  it('모르는 언어는 영어로 — 침묵보다 영어가 낫다', () => {
    expect(splashStrings('xx')).toBe(splashStrings('en'));
    expect(splashStrings(null)).toBe(splashStrings('en'));
    expect(isSplashLocale('ko')).toBe(true);
    expect(isSplashLocale('ko-KR')).toBe(false);
  });

  it('자리표시자를 채운다 — 값이 없는 자리는 그대로 둔다', () => {
    expect(fillSplash('({done}/{total})', { done: 2, total: 5 })).toBe('(2/5)');
    expect(fillSplash('({done}/{missing})', { done: 2 })).toBe('(2/{missing})');
  });
});
