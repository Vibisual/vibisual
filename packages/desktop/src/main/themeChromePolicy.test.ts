/** §4 앱 테마 — 창 색을 OS 에 넘기는 판정(세 OS). 플랫폼을 인자로 받아 Windows 개발기에서도 mac·linux 가지가 돈다. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_THEME_ID, appThemeChrome, resolveAppTheme } from '@vibisual/shared';
import { FALLBACK_APP_THEME_CHROME, titleBarOverlayFor } from './themeChromePolicy';

describe('titleBarOverlayFor', () => {
  it('Windows · Linux 는 제목줄 단추 색을 받는다', () => {
    for (const platform of ['win32', 'linux'] as const) {
      expect(titleBarOverlayFor(FALLBACK_APP_THEME_CHROME, platform)).toEqual({ color: '#334155', symbolColor: '#cbd5e1' });
    }
  });

  it('macOS 는 신호등이라 색을 칠하지 않는다', () => {
    expect(titleBarOverlayFor(FALLBACK_APP_THEME_CHROME, 'darwin')).toBeNull();
  });
});

describe('FALLBACK_APP_THEME_CHROME', () => {
  it('기본 테마를 푼 창 색과 같다(서버가 답하지 못할 때도 종전 화면 그대로)', () => {
    expect(FALLBACK_APP_THEME_CHROME).toEqual(appThemeChrome(resolveAppTheme(DEFAULT_APP_THEME_ID)));
  });
});
