/**
 * §4 앱 테마 색 문법·변환(순수). 사용자 입력이 CSS 변수로 화면 전체에 실리므로 엄격한 문법만 받는다(hex·rgb·hsl·oklch·transparent — `;`·`{}`·url()·var() 자리 없음).
 * 원문을 내보내지 않고 해석한 숫자로 새로 짓는다(`formatThemeColor`). CSS 색을 다 못 읽는 곳(Electron 창 바탕·제목줄·xterm)엔 sRGB 로.
 * OKLCH ↔ sRGB 는 Björn Ottosson 의 공개 OKLab 수식(Tailwind v4 팔레트가 OKLCH). 디스크·시각·`process.platform` 을 읽지 않는다.
 */

/** 해석된 색 한 개. sRGB·OKLCH 를 둘 다 들고 있어 어느 쪽 변환이든 다시 계산하지 않는다. */
export interface ThemeColor {
  /** 받은 공간 — oklch 로 받은 색은 oklch 로 다시 써서 넓은 색역(P3)을 잃지 않는다. */
  space: 'srgb' | 'oklch';
  /** 감마 sRGB 0~1. oklch 에서 온 값은 색역 밖이면 0~1 을 벗어날 수 있다(내보낼 때 자른다). */
  r: number;
  g: number;
  b: number;
  /** OKLCH — 명도 0~1, 채도 ≥ 0, 색상각 0~360. */
  l: number;
  c: number;
  h: number;
  /** 불투명도 0~1. */
  alpha: number;
}

/** 원문 길이 상한 — 정상적인 색 표기는 이보다 한참 짧다(길이로 먼저 걸러 정규식이 오래 돌지 않게). */
export const THEME_COLOR_MAX_LENGTH = 96;

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FN_RE = /^(rgba?|hsla?|oklch)\(([^()]*)\)$/i;
/** 함수 표기 안에 올 수 있는 글자 전부 — 숫자·단위(deg·%)·구분자뿐이다. */
const FN_BODY_RE = /^[0-9a-z.,%/\s+-]*$/i;
const NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round = (v: number, digits: number): number => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};
const wrapHue = (h: number): number => ((h % 360) + 360) % 360;

// ─── OKLab ↔ sRGB ──────────────────────────────────────────────────────────

function toLinear(x: number): number {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  return s * (a <= 0.04045 ? a / 12.92 : ((a + 0.055) / 1.055) ** 2.4);
}

function toGamma(x: number): number {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  return s * (a >= 0.0031308 ? 1.055 * a ** (1 / 2.4) - 0.055 : 12.92 * a);
}

/** OKLCH → 감마 sRGB(자르지 않음). */
export function oklchToSrgb(l: number, c: number, h: number): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  return [
    toGamma(4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S),
    toGamma(-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S),
    toGamma(-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S),
  ];
}

/** 감마 sRGB → OKLCH. 무채색(채도≈0)의 색상각은 0 으로 둔다(어느 값이어도 같은 색이다). */
export function srgbToOklch(r: number, g: number, b: number): [number, number, number] {
  const R = toLinear(r);
  const G = toLinear(g);
  const B = toLinear(b);
  const l_ = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m_ = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s_ = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const Bv = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const C = Math.sqrt(A * A + Bv * Bv);
  const H = C < 1e-4 ? 0 : wrapHue((Math.atan2(Bv, A) * 180) / Math.PI);
  return [L, C, H];
}

function fromSrgb(r: number, g: number, b: number, alpha: number): ThemeColor {
  const [l, c, h] = srgbToOklch(r, g, b);
  return { space: 'srgb', r, g, b, l, c, h, alpha };
}

function fromOklch(l: number, c: number, h: number, alpha: number): ThemeColor {
  const [r, g, b] = oklchToSrgb(l, c, h);
  return { space: 'oklch', r, g, b, l, c, h, alpha };
}

// ─── 해석 ──────────────────────────────────────────────────────────────────

/** `12` · `12.5%` · `120deg` 를 숫자로. 단위가 기대와 다르면 null. */
function readNumber(token: string, unit: 'none' | 'percent' | 'angle'): { value: number; percent: boolean } | null {
  let t = token.toLowerCase();
  if (t === 'none') return { value: 0, percent: false };
  let percent = false;
  if (t.endsWith('%')) {
    if (unit === 'angle') return null;
    percent = true;
    t = t.slice(0, -1);
  } else if (t.endsWith('deg')) {
    if (unit !== 'angle') return null;
    t = t.slice(0, -3);
  }
  if (!NUM_RE.test(t)) return null;
  const value = Number(t);
  if (!Number.isFinite(value)) return null;
  return { value, percent };
}

function readAlpha(token: string | undefined): number | null {
  if (token === undefined) return 1;
  const n = readNumber(token, 'percent');
  if (!n) return null;
  return clamp(n.percent ? n.value / 100 : n.value, 0, 1);
}

function parseHex(hex: string): ThemeColor {
  const body = hex.slice(1);
  const full = body.length <= 4 ? body.split('').map((ch) => ch + ch).join('') : body;
  const byte = (i: number): number => parseInt(full.slice(i, i + 2), 16) / 255;
  const alpha = full.length === 8 ? byte(6) : 1;
  return fromSrgb(byte(0), byte(2), byte(4), alpha);
}

function parseFunction(fn: string, body: string): ThemeColor | null {
  if (!FN_BODY_RE.test(body)) return null;
  const slash = body.split('/');
  if (slash.length > 2) return null;
  const main = (slash[0] ?? '').split(/[\s,]+/).filter(Boolean);
  let alphaToken = slash[1]?.trim();
  if (slash.length === 2 && !alphaToken) return null;
  // 옛 표기 `rgba(1, 2, 3, 0.5)` — 슬래시 없이 네 번째 값이 불투명도다.
  if (alphaToken === undefined && main.length === 4) alphaToken = main.pop();
  if (main.length !== 3) return null;
  const alpha = readAlpha(alphaToken);
  if (alpha === null) return null;
  const [t0, t1, t2] = main as [string, string, string];

  if (fn.startsWith('rgb')) {
    const ch = (t: string): number | null => {
      const n = readNumber(t, 'percent');
      if (!n) return null;
      return clamp(n.percent ? n.value / 100 : n.value / 255, 0, 1);
    };
    const r = ch(t0);
    const g = ch(t1);
    const b = ch(t2);
    if (r === null || g === null || b === null) return null;
    return fromSrgb(r, g, b, alpha);
  }

  if (fn.startsWith('hsl')) {
    const hn = readNumber(t0, 'angle');
    const sn = readNumber(t1, 'percent');
    const ln = readNumber(t2, 'percent');
    if (!hn || !sn || !ln) return null;
    const h = wrapHue(hn.value);
    const s = clamp(sn.value / 100, 0, 1);
    const l = clamp(ln.value / 100, 0, 1);
    // CSS Color 4 의 hsl → rgb 정의 그대로.
    const f = (n: number): number => {
      const k = (n + h / 30) % 12;
      return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return fromSrgb(f(0), f(8), f(4), alpha);
  }

  // oklch(L C H) — L 은 0~1 또는 %, C 는 숫자 또는 %(100% = 0.4), H 는 각도.
  const ln = readNumber(t0, 'percent');
  const cn = readNumber(t1, 'percent');
  const hn = readNumber(t2, 'angle');
  if (!ln || !cn || !hn) return null;
  const l = clamp(ln.percent ? ln.value / 100 : ln.value, 0, 1);
  const c = clamp(cn.percent ? (cn.value / 100) * 0.4 : cn.value, 0, 0.5);
  return fromOklch(l, c, wrapHue(hn.value), alpha);
}

/**
 * 색 원문 하나를 해석한다. 문법 밖이면 `null` — **모르는 것을 넘겨짚어 칠하지 않는다.**
 * 이름 색(`red` 등)은 받지 않는다(`transparent` 만 예외) — 표가 길고, 테마 파일에 쓸 이유가 없다.
 */
export function parseThemeColor(input: unknown): ThemeColor | null {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (s.length === 0 || s.length > THEME_COLOR_MAX_LENGTH) return null;
  if (s.toLowerCase() === 'transparent') return fromSrgb(0, 0, 0, 0);
  if (HEX_RE.test(s)) return parseHex(s);
  const m = FN_RE.exec(s);
  if (!m) return null;
  return parseFunction((m[1] ?? '').toLowerCase(), m[2] ?? '');
}

// ─── 내보내기 ──────────────────────────────────────────────────────────────

const byteHex = (v: number): string => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');

/** sRGB hex — 색역 밖은 채널마다 자른다. `withAlpha` 면 8자리. */
export function themeColorToHex(c: ThemeColor, withAlpha = false): string {
  const base = `#${byteHex(c.r)}${byteHex(c.g)}${byteHex(c.b)}`;
  return withAlpha && c.alpha < 1 ? `${base}${byteHex(c.alpha)}` : base;
}

/** `rgba(r, g, b, a)` — 옛 표기만 읽는 소비자(xterm 선택 영역 등)에 넘길 때. */
export function themeColorToRgba(c: ThemeColor): string {
  const ch = (v: number): number => Math.round(clamp(v, 0, 1) * 255);
  return `rgba(${ch(c.r)}, ${ch(c.g)}, ${ch(c.b)}, ${round(c.alpha, 3)})`;
}

/**
 * CSS 값으로 다시 쓴다 — **원문을 그대로 내보내지 않는다.** oklch 로 받은 것은 oklch 로(넓은 색역 보존),
 * 나머지는 불투명이면 hex, 투명도가 있으면 `rgb(r g b / a)`.
 */
export function formatThemeColor(c: ThemeColor): string {
  const a = c.alpha < 1 ? ` / ${round(c.alpha, 3)}` : '';
  if (c.space === 'oklch') {
    return `oklch(${round(c.l * 100, 3)}% ${round(c.c, 4)} ${round(c.h, 3)}${a})`;
  }
  if (c.alpha >= 1) return themeColorToHex(c);
  const ch = (v: number): number => Math.round(clamp(v, 0, 1) * 255);
  return `rgb(${ch(c.r)} ${ch(c.g)} ${ch(c.b)}${a})`;
}

/** 불투명도만 바꾼다(곱하지 않고 **바꾼다** — `{gray.900}/40` 은 "40% 짜리 gray-900"이다). */
export function withThemeAlpha(c: ThemeColor, alpha: number): ThemeColor {
  return { ...c, alpha: clamp(alpha, 0, 1) };
}

/**
 * 명도를 뒤집는다(L → 1 − L). 다크 테마를 라이트로 옮길 때 팔레트 밖의 색(코드 블록 바탕 같은
 * 리터럴)을 같은 방향으로 옮기는 근사다 — 색조·채도는 그대로 둔다.
 */
export function mirrorThemeColor(c: ThemeColor): ThemeColor {
  return fromOklchKeepingSpace(clamp(1 - c.l, 0, 1), c.c, c.h, c.alpha, c.space);
}

/** 색조·채도 이동. `chroma` 가 있으면 그 값으로, 없으면 `chromaScale` 을 곱한다. */
export function tintThemeColor(
  c: ThemeColor,
  shift: { hue?: number; chroma?: number; chromaScale?: number },
): ThemeColor {
  const h = shift.hue !== undefined ? wrapHue(shift.hue) : c.h;
  const chroma = shift.chroma !== undefined
    ? clamp(shift.chroma, 0, 0.5)
    : clamp(c.c * (shift.chromaScale ?? 1), 0, 0.5);
  return fromOklchKeepingSpace(c.l, chroma, h, c.alpha, 'oklch');
}

function fromOklchKeepingSpace(l: number, c: number, h: number, alpha: number, space: ThemeColor['space']): ThemeColor {
  const out = fromOklch(l, c, h, alpha);
  return space === 'srgb' ? { ...out, space: 'srgb' } : out;
}

/**
 * `fg` 를 `bg` 위에 얹은 불투명 색 — 투명도를 못 받는 곳(창 바탕·제목줄 버튼)에 줄 때.
 * `bg` 가 투명하면 검정 위로 본다(창 바탕은 언제나 불투명이어야 한다).
 */
export function compositeThemeColor(fg: ThemeColor, bg: ThemeColor): ThemeColor {
  const base = bg.alpha >= 1 ? bg : compositeThemeColor(bg, fromSrgb(0, 0, 0, 1));
  const a = fg.alpha;
  return fromSrgb(
    clamp(fg.r, 0, 1) * a + clamp(base.r, 0, 1) * (1 - a),
    clamp(fg.g, 0, 1) * a + clamp(base.g, 0, 1) * (1 - a),
    clamp(fg.b, 0, 1) * a + clamp(base.b, 0, 1) * (1 - a),
    1,
  );
}

/** 문법 검사 + 다시 쓰기를 한 번에. 받을 수 없는 값이면 `null`. */
export function normalizeThemeColor(input: unknown): string | null {
  const c = parseThemeColor(input);
  return c ? formatThemeColor(c) : null;
}
