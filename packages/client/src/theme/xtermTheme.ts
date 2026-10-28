/** §4 앱 테마 — 터미널(xterm) 색표. xterm 은 CSS 변수·oklch 를 못 읽어 터미널 토큰을 **sRGB hex(투명도 있으면 rgba)** 로 옮긴다. 기본 값은 Catppuccin Mocha. */
import { useMemo } from 'react';
import type { ITheme } from '@xterm/xterm';
import {
  APP_THEME_TOKEN_SPECS,
  parseThemeColor,
  themeColorToHex,
  themeColorToRgba,
  withThemeAlpha,
  type AppThemeToken,
  type ResolvedAppTheme,
} from '@vibisual/shared';
import { useActiveAppTheme } from './useAppTheme.js';

/** CSS 색 → xterm 이 읽는 표기. 해석이 안 되면 기본 테마 값. */
function xtermColor(css: string | undefined, fallback: string): string {
  const c = parseThemeColor(css) ?? parseThemeColor(fallback);
  if (!c) return fallback;
  return c.alpha < 1 ? themeColorToRgba(c) : themeColorToHex(c);
}

function token(theme: ResolvedAppTheme, name: AppThemeToken): string {
  return xtermColor(theme.tokens[name], APP_THEME_TOKEN_SPECS[name].default);
}

/** IDE 터미널(CMD 버블) — 의미 토큰 `terminal.*` 21칸. */
export function xtermThemeFrom(theme: ResolvedAppTheme): ITheme {
  return {
    background: token(theme, 'terminal.background'),
    foreground: token(theme, 'terminal.foreground'),
    cursor: token(theme, 'terminal.cursor'),
    cursorAccent: token(theme, 'terminal.cursorAccent'),
    selectionBackground: token(theme, 'terminal.selection'),
    black: token(theme, 'terminal.black'),
    red: token(theme, 'terminal.red'),
    green: token(theme, 'terminal.green'),
    yellow: token(theme, 'terminal.yellow'),
    blue: token(theme, 'terminal.blue'),
    magenta: token(theme, 'terminal.magenta'),
    cyan: token(theme, 'terminal.cyan'),
    white: token(theme, 'terminal.white'),
    brightBlack: token(theme, 'terminal.brightBlack'),
    brightRed: token(theme, 'terminal.brightRed'),
    brightGreen: token(theme, 'terminal.brightGreen'),
    brightYellow: token(theme, 'terminal.brightYellow'),
    brightBlue: token(theme, 'terminal.brightBlue'),
    brightMagenta: token(theme, 'terminal.brightMagenta'),
    brightCyan: token(theme, 'terminal.brightCyan'),
    brightWhite: token(theme, 'terminal.brightWhite'),
  };
}

/**
 * 로그인 팝업의 터미널 — 팝업 바탕에 녹아드는 최소 색(창 바탕 · 글자 gray-200 · 커서 violet-400 ·
 * 선택 violet-500 35%). 팔레트를 따르므로 라이트에서는 뒤집힌 사다리의 같은 자리가 된다.
 */
export function loginXtermThemeFrom(theme: ResolvedAppTheme): ITheme {
  const background = token(theme, 'window.background');
  const violet = parseThemeColor(theme.palette['violet-500']);
  return {
    background,
    foreground: xtermColor(theme.palette['gray-200'], '#e5e7eb'),
    cursor: xtermColor(theme.palette['violet-400'], '#a78bfa'),
    cursorAccent: background,
    selectionBackground: violet ? themeColorToRgba(withThemeAlpha(violet, 0.35)) : 'rgba(139, 92, 246, 0.35)',
  };
}

/** 지금 테마의 IDE 터미널 색표(테마가 바뀔 때만 새 객체). */
export function useXtermTheme(): ITheme {
  const theme = useActiveAppTheme();
  return useMemo(() => xtermThemeFrom(theme), [theme]);
}

/** 지금 테마의 로그인 터미널 색표. */
export function useLoginXtermTheme(): ITheme {
  const theme = useActiveAppTheme();
  return useMemo(() => loginXtermThemeFrom(theme), [theme]);
}
