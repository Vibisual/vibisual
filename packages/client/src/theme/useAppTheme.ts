/**
 * §4 앱 테마 — 고른 테마를 읽고, 풀고, 문서에 싣는 훅들.
 *
 * 고른 id 의 우선순위: 방금 누른 것(낙관 반영) → 서버 저장값(`UserDefaults.appearance.themeId`) → 기본.
 * 해석은 shared `resolveAppTheme` 하나 — 서버가 창 바탕을 칠할 때와 같은 답이다.
 */
import { useEffect, useLayoutEffect, useMemo, type RefObject } from 'react';
import {
  APP_THEME_TOKEN_SPECS,
  DEFAULT_APP_THEME_ID,
  isCustomAppThemeId,
  parseThemeColor,
  resolveAppTheme,
  themeColorToHex,
  type AppThemeDefinition,
  type AppThemeToken,
  type ResolvedAppTheme,
} from '@vibisual/shared';
import { useGraphStore } from '../stores/graphStore.js';
import {
  applyResolvedTheme,
  applyThemeVars,
  readThemeBootCache,
  subscribeThemeBootCache,
  writeThemeBootCache,
} from './appThemeEngine.js';

/** 지금 고른 테마 id. */
export function useSelectedAppThemeId(): string {
  const pending = useGraphStore((s) => s.appThemePending);
  const saved = useGraphStore((s) => s.userDefaults?.appearance?.themeId);
  return pending ?? saved ?? DEFAULT_APP_THEME_ID;
}

/**
 * 마지막으로 푼 테마 — 터미널 칸·메모 카드처럼 여러 컴포넌트가 같은 테마를 동시에 묻는다. 같은
 * (id, 사용자 테마 목록 참조)면 한 번 푼 **같은 객체**를 돌려줘, 각자 다시 풀지도 않고 그 객체를 의존성으로
 * 둔 effect 가 헛돌지도 않게 한다.
 */
let lastResolved: { id: string; custom: readonly AppThemeDefinition[] | undefined; theme: ResolvedAppTheme } | null = null;

function resolveShared(id: string, custom: readonly AppThemeDefinition[] | undefined): ResolvedAppTheme {
  if (lastResolved && lastResolved.id === id && lastResolved.custom === custom) return lastResolved.theme;
  const theme = resolveAppTheme(id, custom ?? []);
  lastResolved = { id, custom, theme };
  return theme;
}

/** 지금 칠하는 테마(해석 끝). 사용자 테마 목록이 다시 읽히면 다시 푼다. */
export function useActiveAppTheme(): ResolvedAppTheme {
  const id = useSelectedAppThemeId();
  const custom = useGraphStore((s) => s.appThemes?.themes);
  return useMemo(() => resolveShared(id, custom), [id, custom]);
}

/**
 * 의미 토큰 하나를 불투명 sRGB `#rrggbb` 로 — JS 로 색을 섞는 자리(메모 카드의 바탕 합성 등)가 쓴다.
 * 투명도는 버린다(섞을 바탕이 필요한 자리라 불투명 색이 맞다).
 */
export function useAppThemeTokenHex(token: AppThemeToken): string {
  const theme = useActiveAppTheme();
  return useMemo(() => {
    const c = parseThemeColor(theme.tokens[token]) ?? parseThemeColor(APP_THEME_TOKEN_SPECS[token].default);
    return c ? themeColorToHex(c) : '#000000';
  }, [theme, token]);
}

/**
 * 창마다 한 번(`AppThemeHost`) — 고른 테마를 `<html>` 에 싣고 표시 캐시를 남긴다. 사용자 테마 목록을 아직 못 받았으면 **칠하지 않고 기다린다**
 * (기본 테마로 한 번 깜빡인다). 스냅샷을 안 받는 창만 storage 이벤트로 캐시를 따른다(옛 스냅샷을 든 창이 새 값을 되돌리지 못하게).
 */
export function useAppThemeSync(): void {
  const hasDefaults = useGraphStore((s) => s.userDefaults !== null);
  const id = useSelectedAppThemeId();
  const catalogLoaded = useGraphStore((s) => s.appThemes !== null);
  const loadAppThemes = useGraphStore((s) => s.loadAppThemes);
  const theme = useActiveAppTheme();
  const waitingForCatalog = isCustomAppThemeId(id) && !catalogLoaded;

  useEffect(() => {
    if (hasDefaults && waitingForCatalog) void loadAppThemes();
  }, [hasDefaults, waitingForCatalog, loadAppThemes]);

  useEffect(() => {
    if (!hasDefaults || waitingForCatalog) return;
    applyResolvedTheme(theme);
    writeThemeBootCache(theme);
  }, [theme, hasDefaults, waitingForCatalog]);

  useEffect(() => {
    if (hasDefaults) return undefined;
    const cached = readThemeBootCache();
    if (cached) applyThemeVars(cached);
    return subscribeThemeBootCache((next) => applyThemeVars(next));
  }, [hasDefaults]);
}

/**
 * 한 요소(미리보기 카드)에만 테마 변수를 싣는다 — 그 안의 Tailwind 클래스가 **그 테마로** 칠해진다.
 * 문서 뿌리와 장부를 따로 둔다(뿌리의 변수를 지우지 않게).
 */
export function useThemeScopeVars(ref: RefObject<HTMLElement>, theme: ResolvedAppTheme): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const names = Object.keys(theme.cssVars);
    for (const [name, value] of Object.entries(theme.cssVars)) el.style.setProperty(name, value);
    return () => {
      for (const name of names) el.style.removeProperty(name);
    };
  }, [ref, theme]);
}
