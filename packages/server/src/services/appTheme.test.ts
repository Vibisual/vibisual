/**
 * §4 앱 테마 — shared 색 문법·정규화·해석 계약(서버 창 바탕과 클라 화면이 이 한 벌을 쓴다): 색 문법은 엄격(새는 글자·이름 색·var() 거절) ·
 * 기본 테마 = 테마 이전 화면 · 라이트 = 팔레트 뒤집기 · 참조 토큰은 최종 팔레트에서 · 사용자 테마는 틀린 칸만 버리고 id 는 `custom:` ·
 * 못 찾은 id 는 기본 테마 + `fellBack` · [새로 만들기] 견본 왕복 · 기본 테마 9벌이 문제 없이 풀린다.
 */
import { describe, expect, it } from 'vitest';
import {
  APP_THEME_FAMILIES,
  APP_THEME_SHADES,
  APP_THEME_TOKENS,
  BUILTIN_APP_THEMES,
  DEFAULT_APP_THEME_ID,
  TAILWIND_DEFAULT_PALETTE,
  appThemeChrome,
  buildAppThemeTemplate,
  formatThemeColor,
  normalizeAppThemeDefinition,
  normalizeThemeColor,
  parseThemeColor,
  resolveAppTheme,
  themeColorToHex,
  type AppThemeDefinition,
} from '@vibisual/shared';

const lightness = (css: string | undefined): number => {
  const c = parseThemeColor(css);
  if (!c) throw new Error(`not a color: ${String(css)}`);
  return c.l;
};

const mk = (raw: unknown, file: string): AppThemeDefinition => {
  const r = normalizeAppThemeDefinition(raw, { file, fallbackId: file.replace(/\.json$/, '') });
  if (!r.theme) throw new Error(`fixture rejected: ${file}`);
  return r.theme;
};

describe('색 문법 — 엄격하게 받고, 다시 써서 내보낸다', () => {
  it('hex · rgb · hsl · oklch · transparent 를 받는다', () => {
    expect(normalizeThemeColor('#ABC')).toBe('#aabbcc');
    expect(normalizeThemeColor('#11223344')).toBe('rgb(17 34 51 / 0.267)');
    expect(normalizeThemeColor('rgb(255, 0, 0)')).toBe('#ff0000');
    expect(normalizeThemeColor('rgba(0, 0, 0, 0.5)')).toBe('rgb(0 0 0 / 0.5)');
    expect(normalizeThemeColor('rgb(255 255 255 / 6%)')).toBe('rgb(255 255 255 / 0.06)');
    expect(normalizeThemeColor('hsl(0 100% 50%)')).toBe('#ff0000');
    expect(normalizeThemeColor('oklch(13% 0.028 261.692)')).toBe('oklch(13% 0.028 261.692)');
    expect(normalizeThemeColor('transparent')).toBe('rgb(0 0 0 / 0)');
  });

  it('선언 밖으로 새는 글자 · 이름 색 · var() · 모양이 틀린 값은 거절한다', () => {
    const bad = ['red', 'var(--x)', '#fff; color: red', 'url(x)', 'rgb(1,2,3);}', '', '#12345', 'oklch(1 2)', 'rgb(1 2 3 / )', 'x'.repeat(200)];
    for (const v of bad) expect(normalizeThemeColor(v), v).toBeNull();
    expect(normalizeThemeColor(42)).toBeNull();
  });

  it('OKLCH → sRGB 는 Tailwind v4 가 알려 둔 hex 와 같다', () => {
    const hex = (s: string): string | null => {
      const c = parseThemeColor(s);
      return c ? themeColorToHex(c) : null;
    };
    expect(hex(TAILWIND_DEFAULT_PALETTE.gray['950'])).toBe('#030712');
    expect(hex(TAILWIND_DEFAULT_PALETTE.gray['900'])).toBe('#101828');
    expect(hex(TAILWIND_DEFAULT_PALETTE.blue['600'])).toBe('#155dfc');
  });
});

describe('기본 테마 = 종전 화면', () => {
  const base = resolveAppTheme(DEFAULT_APP_THEME_ID);

  it('팔레트는 Tailwind 기본 값 그대로다', () => {
    for (const f of APP_THEME_FAMILIES) {
      for (const s of APP_THEME_SHADES) {
        expect(base.cssVars[`--color-${f}-${s}`], `${f}-${s}`).toBe(normalizeThemeColor(TAILWIND_DEFAULT_PALETTE[f][s]));
      }
    }
    expect(base.cssVars['--color-white']).toBe('#ffffff');
    expect(base.cssVars['--color-black']).toBe('#000000');
  });

  it('의미 토큰은 화면에 박혀 있던 값 그대로다', () => {
    expect(base.tokens['titleBar.background']).toBe('#334155');
    expect(base.tokens['surface.raised']).toBe('#1f2937');
    expect(base.tokens['ide.titleBar']).toBe('#1a2236');
    expect(base.tokens['terminal.background']).toBe('#11111b');
    expect(base.tokens['code.border']).toBe('rgb(255 255 255 / 0.06)');
    expect(base.cssVars['--color-vb-titlebar']).toBe('#334155');
  });

  it('창 색은 종전 창 생성부의 값이다', () => {
    expect(appThemeChrome(base)).toEqual({
      themeId: 'vibisual-dark',
      kind: 'dark',
      background: '#030712',
      titleBar: '#334155',
      titleBarSymbol: '#cbd5e1',
    });
  });
});

describe('기본 테마 목록', () => {
  it('9벌 전부가 문제 없이 풀리고, 토큰은 전부 색이다', () => {
    expect(BUILTIN_APP_THEMES).toHaveLength(9);
    for (const def of BUILTIN_APP_THEMES) {
      const r = resolveAppTheme(def.id);
      expect(r.issues, def.id).toEqual([]);
      expect(r.id).toBe(def.id);
      expect(r.fellBack).toBe(false);
      for (const t of APP_THEME_TOKENS) expect(parseThemeColor(r.tokens[t]), `${def.id} ${t}`).not.toBeNull();
    }
  });

  it('id 는 겹치지 않고, 첫 칸이 기본 테마다', () => {
    const ids = BUILTIN_APP_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe(DEFAULT_APP_THEME_ID);
  });

  it('밝기 계열이 이름과 맞다 — 다크는 바탕이 어둡고 라이트는 밝다', () => {
    for (const def of BUILTIN_APP_THEMES) {
      const r = resolveAppTheme(def.id);
      const bg = lightness(r.tokens['window.background']);
      if (r.kind === 'dark') expect(bg, def.id).toBeLessThan(0.3);
      else expect(bg, def.id).toBeGreaterThan(0.85);
    }
  });
});

describe('라이트 = 팔레트 뒤집기', () => {
  const light = resolveAppTheme('light');
  const base = resolveAppTheme(DEFAULT_APP_THEME_ID);

  it('바탕 칸은 밝아지고 앞쪽 글자(white)는 어두워진다', () => {
    expect(light.kind).toBe('light');
    expect(lightness(light.cssVars['--color-gray-950'])).toBeGreaterThan(0.9);
    expect(lightness(light.cssVars['--color-white'])).toBeLessThan(0.3);
  });

  it('gray-950 자리에는 기본 테마의 gray-50 이 온다(500 은 제자리)', () => {
    expect(light.cssVars['--color-gray-950']).toBe(base.cssVars['--color-gray-50']);
    expect(light.cssVars['--color-gray-500']).toBe(base.cssVars['--color-gray-500']);
  });

  it('참조 토큰은 뒤집힌 팔레트에서 풀린다', () => {
    expect(light.tokens['window.background']).toBe(light.cssVars['--color-gray-950']);
  });

  it('창 바탕도 밝다', () => {
    const chrome = appThemeChrome(light);
    expect(chrome.kind).toBe('light');
    expect(lightness(chrome.background)).toBeGreaterThan(0.9);
  });
});

describe('사용자 테마 정규화 — 틀린 칸만 버린다', () => {
  it('맞는 칸은 살리고, 틀린 칸은 문제 코드로 남긴다', () => {
    const { theme, issues } = normalizeAppThemeDefinition({
      name: 'Mine',
      extends: 'midnight',
      palette: { gray: 'zinc', blue: { '500': '#7c3aed', '600': 'nope' }, nope: 'gray', white: '#f8f8f2' },
      colors: { 'titleBar.background': '{gray.800}', 'canvas.background': 'red', 'bogus.token': '#000', $comment: 'hi' },
    }, { file: 'mine.json', fallbackId: 'mine' });
    expect(theme?.id).toBe('custom:mine');
    expect(theme?.palette?.gray).toBe('zinc');
    expect(theme?.palette?.blue).toEqual({ shades: { '500': '#7c3aed' } });
    expect(theme?.palette?.white).toBe('#f8f8f2');
    expect(theme?.colors).toEqual({ 'titleBar.background': '{gray.800}' });
    expect(issues.map((i) => i.code).sort()).toEqual(['invalidColor', 'invalidColor', 'unknownFamily', 'unknownToken']);
    expect(issues.every((i) => i.level === 'warning' && i.file === 'mine.json')).toBe(true);
  });

  it('객체가 아니거나 미래 판수면 그 파일을 못 쓴다', () => {
    const ctx = { file: 'x.json', fallbackId: 'x' };
    expect(normalizeAppThemeDefinition([], ctx).theme).toBeNull();
    const future = normalizeAppThemeDefinition({ schemaVersion: 99, name: 'x' }, ctx);
    expect(future.theme).toBeNull();
    expect(future.issues[0]?.code).toBe('unsupportedVersion');
  });

  it('이름이 없으면 파일 이름을 쓴다', () => {
    const r = normalizeAppThemeDefinition({}, { file: 'blue-ish.json', fallbackId: 'blue-ish' });
    expect(r.theme?.name).toBe('blue-ish');
    expect(r.issues.map((i) => i.code)).toEqual(['missingName']);
  });

  it('최상위 칸의 모양이 틀리면 그 칸만 버린다', () => {
    const r = normalizeAppThemeDefinition({ name: 'Odd', kind: 'sepia', palette: 'gray', mirrorPalette: 'yes' }, { file: 'odd.json', fallbackId: 'odd' });
    expect(r.theme?.kind).toBeUndefined();
    expect(r.theme?.palette).toBeUndefined();
    expect(r.issues.map((i) => i.code)).toEqual(['invalidField', 'invalidField', 'invalidField']);
  });
});

describe('사용자 테마 해석', () => {
  it('extends 로 이어받고 쓴 칸만 바뀐다', () => {
    const mine = mk({ name: 'Mine', extends: 'midnight', colors: { 'titleBar.background': '#ff0000' } }, 'mine.json');
    const r = resolveAppTheme(mine.id, [mine]);
    const midnight = resolveAppTheme('midnight');
    expect(r.source).toBe('custom');
    expect(r.tokens['titleBar.background']).toBe('#ff0000');
    expect(r.cssVars['--color-gray-950']).toBe(midnight.cssVars['--color-gray-950']);
  });

  it('없는 출발점은 기본 테마에서 출발하고 문제로 남긴다', () => {
    const orphan = mk({ name: 'Orphan', extends: 'nowhere' }, 'orphan.json');
    const r = resolveAppTheme(orphan.id, [orphan]);
    expect(r.issues.map((i) => i.code)).toContain('unknownBase');
    expect(r.cssVars['--color-gray-950']).toBe(resolveAppTheme(DEFAULT_APP_THEME_ID).cssVars['--color-gray-950']);
  });

  it('서로를 잇는 순환은 끊는다', () => {
    const a = mk({ id: 'a', name: 'A', extends: 'custom:b' }, 'a.json');
    const b = mk({ id: 'b', name: 'B', extends: 'custom:a' }, 'b.json');
    expect(resolveAppTheme('custom:a', [a, b]).issues.map((i) => i.code)).toContain('extendsCycle');
  });

  it('kind: light 이고 extends 가 없으면 라이트에서 출발한다', () => {
    const lt = mk({ name: 'L', kind: 'light' }, 'l.json');
    expect(resolveAppTheme(lt.id, [lt]).cssVars).toEqual(resolveAppTheme('light').cssVars);
  });

  it('mirrorPalette 는 팔레트 밖 리터럴 토큰도 같은 방향으로 옮긴다', () => {
    const m = mk({ name: 'M', mirrorPalette: true }, 'm.json');
    expect(lightness(resolveAppTheme(m.id, [m]).tokens['titleBar.background'])).toBeGreaterThan(0.5);
  });

  it('별칭은 이어받은 값을 본다 — 같은 정의 안의 다른 변경을 따라가지 않는다', () => {
    const t = mk({ name: 'T', palette: { gray: 'slate', slate: { hue: 0 } } }, 't.json');
    const r = resolveAppTheme(t.id, [t]);
    const base = resolveAppTheme(DEFAULT_APP_THEME_ID);
    expect(r.cssVars['--color-gray-500']).toBe(base.cssVars['--color-slate-500']);
    expect(r.cssVars['--color-slate-500']).not.toBe(base.cssVars['--color-slate-500']);
  });

  it('고른 id 를 못 찾으면 기본 테마로 칠하고 fellBack 을 세운다', () => {
    const r = resolveAppTheme('custom:gone', []);
    expect(r.id).toBe(DEFAULT_APP_THEME_ID);
    expect(r.fellBack).toBe(true);
    expect(resolveAppTheme(undefined).fellBack).toBe(false);
  });

  it('참조에 붙인 /NN 은 그 팔레트 색의 불투명도다', () => {
    const t = mk({ name: 'A', colors: { 'canvas.dots': '{sky.400}/50' } }, 'alpha.json');
    const r = resolveAppTheme(t.id, [t]);
    const dots = parseThemeColor(r.tokens['canvas.dots']);
    expect(dots?.alpha).toBe(0.5);
    expect(formatThemeColor({ ...(parseThemeColor(r.palette['sky-400']) ?? dots!), alpha: 0.5 })).toBe(r.tokens['canvas.dots']);
  });
});

describe('[새로 만들기] 견본', () => {
  it('견본을 그대로 다시 읽으면 바탕 테마와 같은 색을 낸다', () => {
    const base = resolveAppTheme('midnight');
    const raw: unknown = JSON.parse(JSON.stringify(buildAppThemeTemplate(base, { slug: 'my-midnight', name: 'My Midnight' })));
    const { theme, issues } = normalizeAppThemeDefinition(raw, { file: 'my-midnight.json', fallbackId: 'my-midnight' });
    expect(issues).toEqual([]);
    if (!theme) throw new Error('template rejected');
    const r = resolveAppTheme(theme.id, [theme]);
    expect(r.id).toBe('custom:my-midnight');
    expect(r.cssVars).toEqual(base.cssVars);
  });

  it('견본은 의미 토큰을 빠짐없이 적는다(참조는 참조 그대로)', () => {
    const base = resolveAppTheme('light');
    const tpl = buildAppThemeTemplate(base, { slug: 'x', name: 'X' }) as { colors: Record<string, string>; extends: string };
    expect(Object.keys(tpl.colors).sort()).toEqual([...APP_THEME_TOKENS].sort());
    expect(tpl.colors['window.background']).toBe('{gray.950}');
    expect(tpl.extends).toBe('light');
  });
});
