/**
 * §4 앱 테마 — 해석기 값 = 실제로 칠하는 값: `TAILWIND_DEFAULT_PALETTE` 는 싣는 tailwindcss `theme.css` 와(올리면 기본 색이 바뀐다),
 * client `index.css` `@theme static` 기본값은 기본 테마를 푼 값과 같아야 한다(어긋나면 부팅 순간 깜빡인다). CSS 원문은 Node 서버 시험만 읽는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  APP_THEME_FAMILIES,
  APP_THEME_SHADES,
  APP_THEME_TOKENS,
  APP_THEME_TOKEN_SPECS,
  DEFAULT_APP_THEME_ID,
  TAILWIND_DEFAULT_PALETTE,
  normalizeThemeColor,
  resolveAppTheme,
} from '@vibisual/shared';

const REPO = path.resolve(__dirname, '../../../..');
const fromClient = createRequire(path.join(REPO, 'packages/client/package.json'));

function tailwindThemeCss(): string {
  // tailwindcss 는 theme.css 를 exports 로 내보내지 않는다 — 진입점(dist/lib.js) 옆 폴더에서 찾는다.
  const entry = fromClient.resolve('tailwindcss');
  return fs.readFileSync(path.join(path.dirname(entry), '..', 'theme.css'), 'utf8');
}

describe('TAILWIND_DEFAULT_PALETTE ↔ 번들 tailwindcss theme.css', () => {
  it('모든 계열·칸이 글자 그대로 같다', () => {
    const css = tailwindThemeCss();
    const mismatched: string[] = [];
    for (const f of APP_THEME_FAMILIES) {
      for (const s of APP_THEME_SHADES) {
        const m = new RegExp(`--color-${f}-${s}:\\s*([^;]+);`).exec(css);
        if (!m || m[1]?.trim() !== TAILWIND_DEFAULT_PALETTE[f][s]) mismatched.push(`${f}-${s}`);
      }
    }
    expect(mismatched).toEqual([]);
  });
});

describe('index.css @theme static ↔ 기본 테마', () => {
  it('의미 토큰의 CSS 기본값이 기본 테마를 푼 값과 같다', () => {
    const css = fs.readFileSync(path.join(REPO, 'packages/client/src/index.css'), 'utf8');
    const start = css.indexOf('@theme static {');
    expect(start).toBeGreaterThanOrEqual(0);
    const block = css.slice(start, css.indexOf('}', start));
    const base = resolveAppTheme(DEFAULT_APP_THEME_ID);
    const problems: string[] = [];
    for (const token of APP_THEME_TOKENS) {
      const cssVar = APP_THEME_TOKEN_SPECS[token].cssVar;
      if (!cssVar) continue;
      const m = new RegExp(`${cssVar}:\\s*([^;]+);`).exec(block);
      if (!m) {
        problems.push(`${cssVar} 없음`);
        continue;
      }
      if (normalizeThemeColor(m[1]?.trim()) !== base.cssVars[cssVar]) problems.push(`${cssVar} = ${m[1]?.trim()}`);
    }
    expect(problems).toEqual([]);
  });
});
