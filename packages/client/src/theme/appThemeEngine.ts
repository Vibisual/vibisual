/**
 * §4 앱 테마 — 해석된 테마를 **문서에 싣는** 자리(DOM 배선). 해석 자체는 shared `resolveAppTheme` 한 곳이다.
 *
 * 하는 일 셋:
 *  1. `<html>` 에 CSS 변수를 싣는다(`useReadingSettings` 와 같은 길 — 컴포넌트는 인라인 스타일을 들지
 *     않는다). Tailwind v4 의 색 클래스는 전부 `var(--color-…)` 라 이 한 번으로 앱 전체가 바뀐다.
 *  2. 마지막으로 칠한 값을 localStorage 에 **표시 캐시**로 둔다. 부팅 첫 줄에서 먼저 칠해 첫 화면이
 *     기본 테마로 깜빡이지 않게 하고, 스냅샷을 받지 않는 창(메뉴 팝업 등)이 storage 이벤트로 따라오게
 *     한다. 권위는 서버의 `UserDefaults.appearance.themeId` 다 — 이 캐시는 언제든 다시 계산되는 파생물이다.
 *  3. 어두운 판 고정 규칙(`[data-vb-theme-lock="dark"]`)을 한 번 심는다. 기본 테마의 변수 전부를 그
 *     요소에 다시 선언하므로, 조상이 라이트여도 그 안은 종전 화면 그대로 칠해진다.
 *
 * 값 안전: 변수 이름은 `--color-…` 꼴만, 값은 길이를 자르고 `setProperty` 로만 싣는다(선언 밖으로
 * 새지 않는다). 고정 규칙의 글자는 우리 해석기가 다시 쓴 값으로만 짓는다.
 */
import {
  APP_THEME_BOOT_CACHE_KEY,
  APP_THEME_LOCK_ATTR,
  DEFAULT_APP_THEME_ID,
  resolveAppTheme,
  type AppThemeKind,
  type ResolvedAppTheme,
} from '@vibisual/shared';

/** 캐시·적용에 쓰는 모양 — 화면을 칠하는 데 필요한 것만. */
export interface AppThemeVars {
  id: string;
  kind: AppThemeKind;
  vars: Record<string, string>;
}

interface BootCacheWire extends AppThemeVars {
  v: 1;
}

const VAR_NAME_RE = /^--color-[a-z0-9-]+$/;
/** 변수 값 길이 상한 — 우리 해석기가 내는 값은 이보다 한참 짧다. */
const VAR_VALUE_MAX = 120;
const LOCK_STYLE_ID = 'vb-theme-lock';

let appliedNames: string[] = [];
let appliedSignature = '';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** 변수 표를 걸러 낸다 — 이름 꼴이 틀리거나 값이 문자열이 아니면 버린다. */
function cleanVars(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof input !== 'object' || input === null) return out;
  for (const [name, value] of Object.entries(input)) {
    if (!VAR_NAME_RE.test(name) || typeof value !== 'string') continue;
    if (value.length === 0 || value.length > VAR_VALUE_MAX) continue;
    out[name] = value;
  }
  return out;
}

/**
 * 문서 뿌리(`<html>`)에 테마를 싣는다. 같은 값이면 아무것도 하지 않는다(스타일 재계산을 부르지 않게).
 * 미리보기 카드처럼 **한 요소에만** 싣는 일은 `useThemeScopeVars` 가 따로 맡는다(지운 변수 장부가 갈리게).
 */
export function applyThemeVars(theme: AppThemeVars): void {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  const signature = `${theme.id}|${theme.kind}|${JSON.stringify(theme.vars)}`;
  if (signature === appliedSignature) return;
  const next = theme.vars;
  for (const name of appliedNames) {
    if (!(name in next)) el.style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(next)) el.style.setProperty(name, value);
  // `color-scheme` 은 일부러 건드리지 않는다 — 실으면 기본 테마에서도 체크박스·선택 목록 같은 네이티브
  // 컨트롤의 모양이 바뀌고(종전 화면이 아니게 된다), 투명 위젯 창의 바탕까지 칠할 수 있다.
  // 밝기 계열은 속성으로만 남겨 CSS 가 필요할 때 고를 수 있게 한다.
  el.setAttribute('data-vb-theme', theme.id);
  el.setAttribute('data-vb-theme-kind', theme.kind);
  appliedNames = Object.keys(next);
  appliedSignature = signature;
}

export function applyResolvedTheme(theme: ResolvedAppTheme): void {
  applyThemeVars({ id: theme.id, kind: theme.kind, vars: theme.cssVars });
}

function parseBootCache(text: string | null): AppThemeVars | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as Partial<BootCacheWire> | null;
    if (!raw || raw.v !== 1 || typeof raw.id !== 'string') return null;
    if (raw.kind !== 'dark' && raw.kind !== 'light') return null;
    const vars = cleanVars(raw.vars);
    if (Object.keys(vars).length === 0) return null;
    return { id: raw.id, kind: raw.kind, vars };
  } catch {
    return null;
  }
}

export function readThemeBootCache(): AppThemeVars | null {
  return parseBootCache(storage()?.getItem(APP_THEME_BOOT_CACHE_KEY) ?? null);
}

/** 캐시를 쓴다 — 같은 내용이면 쓰지 않는다(다른 창에 storage 이벤트를 헛되이 뿌리지 않게). */
export function writeThemeBootCache(theme: ResolvedAppTheme): void {
  const s = storage();
  if (!s) return;
  const wire: BootCacheWire = { v: 1, id: theme.id, kind: theme.kind, vars: theme.cssVars };
  const text = JSON.stringify(wire);
  try {
    if (s.getItem(APP_THEME_BOOT_CACHE_KEY) !== text) s.setItem(APP_THEME_BOOT_CACHE_KEY, text);
  } catch {
    // 저장소가 가득 찼거나 막혀 있다 — 다음 부팅의 첫 칠만 기본 테마가 된다(권위는 서버).
  }
}

/** 다른 창이 캐시를 바꾸면 알린다(같은 창이 쓴 것은 브라우저가 알리지 않는다). */
export function subscribeThemeBootCache(cb: (theme: AppThemeVars) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onStorage = (e: StorageEvent): void => {
    if (e.key !== APP_THEME_BOOT_CACHE_KEY) return;
    const theme = parseBootCache(e.newValue);
    if (theme) cb(theme);
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

/**
 * 어두운 판 고정 규칙을 한 번 심는다. 기본 테마의 변수 전부를 그 요소에 다시 선언한다 — 고정 어두운
 * 바탕을 전제로 칠한 화면(내부 앱 화면·캔버스 미디어 무대)이 라이트 테마에서 글자만 뒤집혀 사라지지 않게.
 */
export function installThemeLockStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(LOCK_STYLE_ID)) return;
  const base = resolveAppTheme(DEFAULT_APP_THEME_ID);
  const decls = Object.entries(base.cssVars).map(([name, value]) => `${name}:${value}`).join(';');
  const el = document.createElement('style');
  el.id = LOCK_STYLE_ID;
  el.textContent = `[${APP_THEME_LOCK_ATTR}="dark"]{${decls}}`;
  document.head.appendChild(el);
}

/**
 * 부팅 첫 줄 — React 가 그리기 전에 부른다. 지난번에 칠한 테마가 있으면 그것으로 먼저 칠하고,
 * 고정 규칙을 심는다. 실패해도 첫 화면은 index.css 의 기본 테마 값으로 선다.
 */
export function bootAppTheme(): void {
  try {
    installThemeLockStyles();
    const cached = readThemeBootCache();
    if (cached) applyThemeVars(cached);
  } catch {
    // 첫 칠만 기본 테마가 된다 — 스냅샷이 오면 고른 테마로 다시 칠한다.
  }
}
