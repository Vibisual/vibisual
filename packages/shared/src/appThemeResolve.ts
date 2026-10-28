/**
 * §4 앱 테마 정규화·해석(순수). `normalizeAppThemeDefinition` 은 틀린 칸만 버리고 `AppThemeIssue` 로 남긴다(오타 하나로 테마 전체를 잃지 않게).
 * `resolveAppTheme` 는 `extends` 를 뿌리부터 적용해 최종 팔레트로 참조를 풀고 `cssVars` 를 낸다. 서버(창 바탕)·클라(화면)가 이 파일 하나로 같은 답을 낸다.
 */
import {
  APP_THEME_FAMILIES,
  APP_THEME_LIMITS,
  APP_THEME_SCHEMA_VERSION,
  APP_THEME_SHADES,
  APP_THEME_TOKEN_SPECS,
  CUSTOM_APP_THEME_PREFIX,
  DEFAULT_APP_THEME_ID,
  DEFAULT_LIGHT_APP_THEME_ID,
} from './constants.js';
import type {
  AppThemeChrome,
  AppThemeDefinition,
  AppThemeFamily,
  AppThemeIssue,
  AppThemeIssueCode,
  AppThemeKind,
  AppThemeRamp,
  AppThemeRampSpec,
  AppThemeShade,
  AppThemeToken,
  ResolvedAppTheme,
} from './types.js';
import {
  compositeThemeColor,
  formatThemeColor,
  normalizeThemeColor,
  parseThemeColor,
  themeColorToHex,
  withThemeAlpha,
  type ThemeColor,
} from './appThemeColor.js';
import {
  TAILWIND_DEFAULT_BLACK,
  TAILWIND_DEFAULT_WHITE,
  clonePalette,
  isAppThemeFamily,
  isAppThemeShade,
  mirrorColorString,
  mirrorRamp,
  tintRamp,
} from './appThemePalette.js';
import { BUILTIN_APP_THEMES } from './appThemeCatalog.js';

/** 의미 토큰 전부 — `APP_THEME_TOKEN_SPECS` 의 순서(= 견본 파일에 적히는 순서). */
export const APP_THEME_TOKENS: readonly AppThemeToken[] = Object.keys(APP_THEME_TOKEN_SPECS) as AppThemeToken[];
const TOKEN_SET: ReadonlySet<string> = new Set(APP_THEME_TOKENS);

/** 정확한 검정 — 참조가 끝내 안 풀릴 때의 마지막 바닥(화면이 투명해지는 것보다 낫다). */
const BLACK: ThemeColor = { space: 'srgb', r: 0, g: 0, b: 0, l: 0, c: 0, h: 0, alpha: 1 };

export function isAppThemeToken(v: unknown): v is AppThemeToken {
  return typeof v === 'string' && TOKEN_SET.has(v);
}

// ─── 팔레트 참조 `{gray.900}` · `{sky.400}/50` · `{white}` ─────────────────

const REF_RE = /^\{(white|black|[a-z]+\.(?:50|[1-9]00|950))\}(?:\/(\d{1,3}(?:\.\d+)?))?$/;

export interface AppThemeRef {
  /** `white` · `black` · `<계열>.<칸>` */
  key: string;
  /** 0~1. 없으면 팔레트 값의 불투명도 그대로. */
  alpha?: number;
}

/** 팔레트 참조인가 — 계열·칸 이름까지 확인한다(모르는 계열을 넘겨짚지 않는다). */
export function parseAppThemeRef(value: string): AppThemeRef | null {
  const m = REF_RE.exec(value.trim());
  if (!m) return null;
  const key = m[1] ?? '';
  if (key !== 'white' && key !== 'black') {
    const [family, shade] = key.split('.');
    if (!isAppThemeFamily(family) || !isAppThemeShade(shade)) return null;
  }
  if (m[2] === undefined) return { key };
  const pct = Number(m[2]);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  return { key, alpha: pct / 100 };
}

function formatRef(ref: AppThemeRef): string {
  return ref.alpha === undefined ? `{${ref.key}}` : `{${ref.key}}/${Math.round(ref.alpha * 1000) / 10}`;
}

/** 토큰 값 하나 — 팔레트 참조거나 색. 받을 수 없으면 `null`. 둘 다 **우리가 다시 쓴** 문자열로 돌려준다. */
export function normalizeAppThemeTokenValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const ref = parseAppThemeRef(value);
  if (ref) return formatRef(ref);
  return normalizeThemeColor(value);
}

// ─── id ────────────────────────────────────────────────────────────────────

/**
 * id·파일 이름에 쓸 조각. 영문 소문자·숫자·하이픈만 남긴다(경로가 아니라 이름이라 접어도 된다).
 * 남는 글자가 없으면(한글만 쓴 이름 등) `theme`.
 */
export function appThemeSlug(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, APP_THEME_LIMITS.maxIdLength)
    .replace(/-+$/g, '');
  return s || 'theme';
}

export function customAppThemeId(slug: string): string {
  return `${CUSTOM_APP_THEME_PREFIX}${slug}`;
}

export function isCustomAppThemeId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(CUSTOM_APP_THEME_PREFIX);
}

// ─── 정규화(사용자 파일) ───────────────────────────────────────────────────

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

type Warn = (code: AppThemeIssueCode, detail?: string) => void;

export interface NormalizeAppThemeContext {
  /** 파일 이름(경로 아님) — 문제 목록에 그대로 실린다. */
  file: string;
  /** 파일에 `id`·`name` 이 없을 때 쓸 이름(보통 확장자를 뗀 파일 이름). */
  fallbackId: string;
}

export interface NormalizeAppThemeResult {
  /** `null` 이면 그 파일은 못 쓴다(이유는 `issues` 의 error). */
  theme: AppThemeDefinition | null;
  issues: AppThemeIssue[];
}

/**
 * 사용자 테마 파일 하나를 검증한다. `$` 로 시작하는 키(`$schema`·`$comment`)와 모르는 최상위 키는
 * 조용히 넘긴다 — 앞으로 형식이 자라도 옛 앱이 새 파일을 거절하지 않게.
 */
export function normalizeAppThemeDefinition(raw: unknown, ctx: NormalizeAppThemeContext): NormalizeAppThemeResult {
  const issues: AppThemeIssue[] = [];
  const push = (level: AppThemeIssue['level'], code: AppThemeIssueCode, detail?: string): void => {
    issues.push({
      file: ctx.file,
      level,
      code,
      ...(detail !== undefined ? { detail: clip(detail, APP_THEME_LIMITS.maxIssueDetailLength) } : {}),
    });
  };
  const warn: Warn = (code, detail) => push('warning', code, detail);

  if (!isPlainObject(raw)) {
    push('error', 'notObject');
    return { theme: null, issues };
  }
  const version = raw['schemaVersion'];
  if (version !== undefined
    && (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > APP_THEME_SCHEMA_VERSION)) {
    push('error', 'unsupportedVersion', String(version));
    return { theme: null, issues };
  }

  const rawId = typeof raw['id'] === 'string' ? raw['id'].trim() : '';
  const id = customAppThemeId(appThemeSlug(rawId || ctx.fallbackId));

  let name = typeof raw['name'] === 'string' ? raw['name'].trim() : '';
  if (!name) {
    warn('missingName');
    name = ctx.fallbackId;
  }
  const theme: AppThemeDefinition = {
    schemaVersion: APP_THEME_SCHEMA_VERSION,
    id,
    name: clip(name, APP_THEME_LIMITS.maxNameLength),
    file: ctx.file,
  };

  const kind = raw['kind'];
  if (kind !== undefined) {
    if (kind === 'dark' || kind === 'light') theme.kind = kind;
    else warn('invalidField', 'kind');
  }

  const ext = raw['extends'];
  if (ext !== undefined) {
    if (typeof ext === 'string' && ext.trim().length > 0 && ext.length <= APP_THEME_LIMITS.maxIdLength + CUSTOM_APP_THEME_PREFIX.length) {
      theme.extends = ext.trim();
    } else {
      warn('invalidField', 'extends');
    }
  }

  const description = raw['description'];
  if (description !== undefined) {
    if (typeof description === 'string') {
      const t = description.trim();
      if (t) theme.description = clip(t, APP_THEME_LIMITS.maxDescriptionLength);
    } else {
      warn('invalidField', 'description');
    }
  }

  const author = raw['author'];
  if (author !== undefined) {
    if (typeof author === 'string') {
      const t = author.trim();
      if (t) theme.author = clip(t, APP_THEME_LIMITS.maxAuthorLength);
    } else {
      warn('invalidField', 'author');
    }
  }

  const mirror = raw['mirrorPalette'];
  if (mirror !== undefined) {
    if (typeof mirror === 'boolean') {
      if (mirror) theme.mirrorPalette = true;
    } else {
      warn('invalidField', 'mirrorPalette');
    }
  }

  const palette = raw['palette'];
  if (palette !== undefined) {
    if (!isPlainObject(palette)) warn('invalidField', 'palette');
    else {
      const out = normalizePalette(palette, warn);
      if (Object.keys(out).length > 0) theme.palette = out;
    }
  }

  const colors = raw['colors'];
  if (colors !== undefined) {
    if (!isPlainObject(colors)) warn('invalidField', 'colors');
    else {
      const out = normalizeColors(colors, warn);
      if (Object.keys(out).length > 0) theme.colors = out;
    }
  }

  return { theme, issues };
}

function normalizePalette(src: Record<string, unknown>, warn: Warn): NonNullable<AppThemeDefinition['palette']> {
  const out: NonNullable<AppThemeDefinition['palette']> = {};
  for (const [key, value] of Object.entries(src)) {
    if (key.startsWith('$')) continue;
    if (key === 'white' || key === 'black') {
      const c = normalizeThemeColor(value);
      if (c) out[key] = c;
      else warn('invalidColor', `palette.${key}`);
      continue;
    }
    if (!isAppThemeFamily(key)) {
      warn('unknownFamily', key);
      continue;
    }
    if (typeof value === 'string') {
      // 문자열은 별칭뿐이다 — 계열 하나를 한 색으로 칠하면 11칸 사다리가 무너진다.
      if (isAppThemeFamily(value)) out[key] = value;
      else warn('invalidRamp', `palette.${key}`);
      continue;
    }
    if (!isPlainObject(value)) {
      warn('invalidRamp', `palette.${key}`);
      continue;
    }
    const spec = normalizeRampSpec(key, value, warn);
    if (spec) out[key] = spec;
  }
  return out;
}

function normalizeRampSpec(family: AppThemeFamily, src: Record<string, unknown>, warn: Warn): AppThemeRampSpec | null {
  const spec: AppThemeRampSpec = {};
  const shades: Partial<Record<AppThemeShade, string>> = {};
  const inRange = (v: unknown, lo: number, hi: number): number | null =>
    (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
  const addShade = (shade: string, value: unknown): void => {
    if (!isAppThemeShade(shade)) {
      warn('invalidRamp', `palette.${family}.${shade}`);
      return;
    }
    const c = normalizeThemeColor(value);
    if (c) shades[shade] = c;
    else warn('invalidColor', `palette.${family}.${shade}`);
  };

  for (const [key, value] of Object.entries(src)) {
    if (key.startsWith('$')) continue;
    switch (key) {
      case 'from':
        if (isAppThemeFamily(value)) spec.from = value;
        else warn('invalidRamp', `palette.${family}.from`);
        break;
      case 'mirror':
        if (typeof value === 'boolean') {
          if (value) spec.mirror = true;
        } else {
          warn('invalidRamp', `palette.${family}.mirror`);
        }
        break;
      case 'hue': {
        const n = inRange(value, 0, 360);
        if (n !== null) spec.hue = n;
        else warn('invalidRamp', `palette.${family}.hue`);
        break;
      }
      case 'chroma': {
        const n = inRange(value, 0, 0.4);
        if (n !== null) spec.chroma = n;
        else warn('invalidRamp', `palette.${family}.chroma`);
        break;
      }
      case 'chromaScale': {
        const n = inRange(value, 0, 4);
        if (n !== null) spec.chromaScale = n;
        else warn('invalidRamp', `palette.${family}.chromaScale`);
        break;
      }
      case 'shades':
        if (isPlainObject(value)) {
          for (const [shade, c] of Object.entries(value)) addShade(shade, c);
        } else {
          warn('invalidRamp', `palette.${family}.shades`);
        }
        break;
      default:
        // `{"500": "#7c3aed"}` 처럼 칸을 바로 적은 것 — `shades` 로 감싸지 않아도 받는다.
        addShade(key, value);
    }
  }
  if (Object.keys(shades).length > 0) spec.shades = shades;
  return Object.keys(spec).length > 0 ? spec : null;
}

function normalizeColors(src: Record<string, unknown>, warn: Warn): Partial<Record<AppThemeToken, string>> {
  const out: Partial<Record<AppThemeToken, string>> = {};
  for (const [key, value] of Object.entries(src)) {
    if (key.startsWith('$')) continue;
    if (!isAppThemeToken(key)) {
      warn('unknownToken', key);
      continue;
    }
    const v = normalizeAppThemeTokenValue(value);
    if (v) out[key] = v;
    else warn('invalidColor', `colors.${key}`);
  }
  return out;
}

// ─── 목록 ──────────────────────────────────────────────────────────────────

/** 기본 테마(표시 순서 그대로) 뒤에 사용자 테마. */
export function listAppThemes(custom: readonly AppThemeDefinition[] = []): AppThemeDefinition[] {
  return [...BUILTIN_APP_THEMES, ...custom];
}

export function findAppTheme(id: string | null | undefined, custom: readonly AppThemeDefinition[] = []): AppThemeDefinition | undefined {
  if (typeof id !== 'string' || id.length === 0) return undefined;
  return BUILTIN_APP_THEMES.find((t) => t.id === id) ?? custom.find((t) => t.id === id);
}

export function isBuiltinAppThemeId(id: string | null | undefined): boolean {
  return typeof id === 'string' && BUILTIN_APP_THEMES.some((t) => t.id === id);
}

function defaultDefinition(): AppThemeDefinition {
  return findAppTheme(DEFAULT_APP_THEME_ID) ?? { schemaVersion: APP_THEME_SCHEMA_VERSION, id: DEFAULT_APP_THEME_ID, name: 'Vibisual Dark', kind: 'dark' };
}

// ─── 해석 ──────────────────────────────────────────────────────────────────

interface WorkState {
  palette: Record<AppThemeFamily, AppThemeRamp>;
  white: string;
  black: string;
  /** 풀기 전 원문(참조 또는 색). */
  tokens: Record<AppThemeToken, string>;
  kind: AppThemeKind;
}

/** 뿌리 — Tailwind 기본 팔레트 + 종전 화면의 토큰 값. 기본 테마(Vibisual Dark)가 곧 이 상태다. */
function rootState(): WorkState {
  const tokens = {} as Record<AppThemeToken, string>;
  for (const t of APP_THEME_TOKENS) tokens[t] = APP_THEME_TOKEN_SPECS[t].default;
  return { palette: clonePalette(), white: TAILWIND_DEFAULT_WHITE, black: TAILWIND_DEFAULT_BLACK, tokens, kind: 'dark' };
}

/** 정의가 이어받는 테마 id. 뿌리면 `null`. */
function baseIdOf(d: AppThemeDefinition): string | null {
  if (d.id === DEFAULT_APP_THEME_ID) return null;
  if (d.extends) return d.extends;
  if (d.kind === 'light' && d.id !== DEFAULT_LIGHT_APP_THEME_ID) return DEFAULT_LIGHT_APP_THEME_ID;
  return DEFAULT_APP_THEME_ID;
}

/** 뿌리 쪽부터의 사슬. 순환·없는 출발점은 거기서 끊고 문제로 남긴다(그 위는 뿌리에서 출발한다). */
function lineage(target: AppThemeDefinition, custom: readonly AppThemeDefinition[], issues: AppThemeIssue[]): AppThemeDefinition[] {
  const chain: AppThemeDefinition[] = [target];
  const seen = new Set<string>([target.id]);
  const label = target.file ?? target.id;
  let cur = target;
  for (let depth = 0; depth < APP_THEME_LIMITS.maxExtendsDepth; depth++) {
    const baseId = baseIdOf(cur);
    if (baseId === null) break;
    if (seen.has(baseId)) {
      issues.push({ file: label, level: 'warning', code: 'extendsCycle', detail: clip(baseId, APP_THEME_LIMITS.maxIssueDetailLength) });
      break;
    }
    const base = findAppTheme(baseId, custom);
    if (!base) {
      issues.push({ file: label, level: 'warning', code: 'unknownBase', detail: clip(baseId, APP_THEME_LIMITS.maxIssueDetailLength) });
      break;
    }
    chain.push(base);
    seen.add(baseId);
    cur = base;
  }
  return chain.reverse();
}

function buildRamp(inherited: Record<AppThemeFamily, AppThemeRamp>, family: AppThemeFamily, entry: string | AppThemeRampSpec): AppThemeRamp {
  if (typeof entry === 'string') return { ...inherited[isAppThemeFamily(entry) ? entry : family] };
  let ramp: AppThemeRamp = { ...inherited[entry.from ?? family] };
  if (entry.mirror) ramp = mirrorRamp(ramp);
  if (entry.hue !== undefined || entry.chroma !== undefined || entry.chromaScale !== undefined) {
    ramp = tintRamp(ramp, { hue: entry.hue, chroma: entry.chroma, chromaScale: entry.chromaScale });
  }
  for (const s of APP_THEME_SHADES) {
    const c = entry.shades?.[s];
    if (typeof c === 'string') ramp[s] = c;
  }
  return ramp;
}

function applyDefinition(state: WorkState, d: AppThemeDefinition): void {
  if (d.mirrorPalette) {
    for (const f of APP_THEME_FAMILIES) state.palette[f] = mirrorRamp(state.palette[f]);
    // 참조 토큰은 뒤집힌 팔레트를 따라 저절로 뒤집힌다. 리터럴만 명도를 뒤집어 같은 방향으로 옮긴다.
    for (const t of APP_THEME_TOKENS) {
      const raw = state.tokens[t];
      if (!parseAppThemeRef(raw)) state.tokens[t] = mirrorColorString(raw);
    }
  }
  // 별칭·`from` 은 **이어받은 값**을 본다 — 같은 정의 안에서 `gray: "slate", slate: {...}` 처럼 둘을
  // 함께 바꿔도 gray 가 바뀐 slate 를 따라가지 않는다(적는 순서에 결과가 매이지 않게).
  const inherited = clonePalette(state.palette);
  const palette: NonNullable<AppThemeDefinition['palette']> = d.palette ?? {};
  for (const f of APP_THEME_FAMILIES) {
    const entry = palette[f];
    if (entry !== undefined) state.palette[f] = buildRamp(inherited, f, entry);
  }
  if (typeof palette.white === 'string') state.white = palette.white;
  if (typeof palette.black === 'string') state.black = palette.black;
  for (const t of APP_THEME_TOKENS) {
    const v = d.colors?.[t];
    if (typeof v === 'string') state.tokens[t] = v;
  }
  if (d.kind) state.kind = d.kind;
}

function resolveTokenColor(raw: string, palette: Record<string, string>): ThemeColor | null {
  const ref = parseAppThemeRef(raw);
  if (!ref) return parseThemeColor(raw);
  const base = palette[ref.key.replace('.', '-')];
  const c = base !== undefined ? parseThemeColor(base) : null;
  if (!c) return null;
  return ref.alpha !== undefined ? withThemeAlpha(c, ref.alpha) : c;
}

/**
 * 테마 하나를 푼다. `id` 를 못 찾으면 기본 테마로 칠하고 `fellBack` 을 세운다 — 저장값은 건드리지 않는다
 * (사용자 테마 파일을 잠깐 치웠다 되돌려 놓으면 그대로 돌아와야 한다).
 */
export function resolveAppTheme(id: string | null | undefined, custom: readonly AppThemeDefinition[] = []): ResolvedAppTheme {
  const wanted = findAppTheme(id, custom);
  const fellBack = typeof id === 'string' && id.length > 0 && !wanted;
  const target = wanted ?? defaultDefinition();
  const issues: AppThemeIssue[] = [];
  const state = rootState();
  for (const d of lineage(target, custom, issues)) applyDefinition(state, d);
  return finish(target, state, issues, fellBack);
}

function finish(target: AppThemeDefinition, state: WorkState, issues: AppThemeIssue[], fellBack: boolean): ResolvedAppTheme {
  const root = rootState();
  const label = target.file ?? target.id;
  const colorOf = (value: string, fallback: string, detail: string): ThemeColor => {
    const c = parseThemeColor(value);
    if (c) return c;
    issues.push({ file: label, level: 'warning', code: 'invalidColor', detail });
    return parseThemeColor(fallback) ?? BLACK;
  };

  const palette: Record<string, string> = {};
  const cssVars: Record<string, string> = {};
  for (const f of APP_THEME_FAMILIES) {
    for (const s of APP_THEME_SHADES) {
      const css = formatThemeColor(colorOf(state.palette[f][s], root.palette[f][s], `palette.${f}.${s}`));
      palette[`${f}-${s}`] = css;
      cssVars[`--color-${f}-${s}`] = css;
    }
  }
  const white = formatThemeColor(colorOf(state.white, TAILWIND_DEFAULT_WHITE, 'palette.white'));
  const black = formatThemeColor(colorOf(state.black, TAILWIND_DEFAULT_BLACK, 'palette.black'));
  palette['white'] = white;
  palette['black'] = black;
  cssVars['--color-white'] = white;
  cssVars['--color-black'] = black;

  const tokens = {} as Record<AppThemeToken, string>;
  const tokenSources = {} as Record<AppThemeToken, string>;
  for (const t of APP_THEME_TOKENS) {
    const raw = state.tokens[t];
    let c = resolveTokenColor(raw, palette);
    if (!c) {
      issues.push({ file: label, level: 'warning', code: 'invalidColor', detail: `colors.${t}` });
      c = resolveTokenColor(root.tokens[t], palette) ?? BLACK;
    }
    tokenSources[t] = raw;
    tokens[t] = formatThemeColor(c);
    const cssVar = APP_THEME_TOKEN_SPECS[t].cssVar;
    if (cssVar) cssVars[cssVar] = tokens[t];
  }

  return {
    id: target.id,
    fellBack,
    name: target.name,
    kind: state.kind,
    source: isCustomAppThemeId(target.id) ? 'custom' : 'builtin',
    ...(target.i18nKey ? { i18nKey: target.i18nKey } : {}),
    ...(target.description ? { description: target.description } : {}),
    ...(target.author ? { author: target.author } : {}),
    ...(target.file ? { file: target.file } : {}),
    palette,
    tokens,
    tokenSources,
    cssVars,
    issues,
  };
}

// ─── 데스크톱 창 ───────────────────────────────────────────────────────────

/**
 * 창 바탕·제목줄 버튼 색. Electron 은 투명도·oklch 를 다 못 받으므로 **불투명 `#rrggbb`** 로 준다 —
 * 투명한 토큰은 그 아래 층(창 바탕 → 제목줄) 위에 얹어 굳힌다.
 */
export function appThemeChrome(theme: ResolvedAppTheme): AppThemeChrome {
  const bg = compositeThemeColor(parseThemeColor(theme.tokens['window.background']) ?? BLACK, BLACK);
  const bar = compositeThemeColor(parseThemeColor(theme.tokens['titleBar.background']) ?? bg, bg);
  const symbol = compositeThemeColor(parseThemeColor(theme.tokens['titleBar.foreground']) ?? bar, bar);
  return {
    themeId: theme.id,
    kind: theme.kind,
    background: themeColorToHex(bg),
    titleBar: themeColorToHex(bar),
    titleBarSymbol: themeColorToHex(symbol),
  };
}

// ─── 새 테마 견본 ──────────────────────────────────────────────────────────

/**
 * "지금 테마로 새로 만들기"가 쓰는 파일 내용. `extends` 로 지금 테마를 잇고 의미 토큰을 **전부** 적어
 * 둔다 — 고칠 수 있는 칸이 무엇인지 파일만 열어도 보이게. 토큰은 풀기 전 원문(참조 그대로)이라
 * 사용자가 팔레트만 바꿔도 참조 칸이 따라온다.
 */
export function buildAppThemeTemplate(base: ResolvedAppTheme, opts: { slug: string; name: string }): Record<string, unknown> {
  return {
    schemaVersion: APP_THEME_SCHEMA_VERSION,
    id: opts.slug,
    name: clip(opts.name, APP_THEME_LIMITS.maxNameLength),
    kind: base.kind,
    extends: base.id,
    description: '',
    palette: {},
    colors: { ...base.tokenSources },
  };
}
