/**
 * §5.13 (V) 37-10 — **스타일 카드**의 순수 층: 프로젝트에서 찾은 후보(색·글꼴·로고)를 모양으로 묶고, 그중에서 한 벌을 제안한다.
 *
 * 찾기(파일 훑기)는 서버가 하고, 여기서는 문자열만 다룬다 — 색 정규화·밝기·채도, 제안 규칙. 사용자가 고르고 확정하면 그 한 벌이
 * 문서 `style` 로 적히고(같은 문서 = 같은 프레임), 런타임 심이 모든 컴포지션에 `--vibi-*` 변수로 넣는다.
 */
import type { DocStyle } from './types.js';

export interface ColorCandidate {
  /** `#rrggbb`(소문자). */
  readonly value: string;
  /** CSS 변수 이름·tailwind 열쇠 등(있으면). */
  readonly name?: string;
  readonly count: number;
  /** 처음 찾은 파일(프로젝트 기준). */
  readonly source: string;
}

export interface FontCandidate {
  readonly family: string;
  /** 글꼴 파일(프로젝트 기준) — `@font-face` 나 글꼴 파일에서 찾았을 때. */
  readonly file?: string;
  readonly count: number;
  readonly source: string;
}

export interface LogoCandidate {
  /** 프로젝트 기준 경로. */
  readonly path: string;
  readonly bytes: number;
}

export interface StyleCandidates {
  readonly colors: readonly ColorCandidate[];
  readonly fonts: readonly FontCandidate[];
  readonly logos: readonly LogoCandidate[];
  /** 훑은 파일 수·상한에 걸렸는가(사람에게 "일부만 봤다" 를 말한다). */
  readonly scannedFiles: number;
  readonly partial: boolean;
}

/** 확정된 프로젝트 스타일 파일(`.vibisual/video/style.json`). */
export interface StyleFile {
  readonly schemaVersion: 1;
  readonly style: DocStyle;
  readonly confirmedAt: number;
}

/** 아무것도 못 찾았을 때의 기본 한 벌(어두운 바탕 · 밝은 글 · 차분한 강조). 영상 그림 색이지 화면 테마가 아니다. */
export const DEFAULT_DOC_STYLE: DocStyle = { accent: '#6366F1', bg: '#0B1020', fg: '#F8FAFC', muted: '#94A3B8' };

/** `#abc`·`#aabbcc`·`#aabbccdd` → `#aabbcc`(소문자). 아니면 null. */
export function normalizeHex(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`;
  const m6 = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(v);
  return m6 ? `#${m6[1]}` : null;
}

/** 문서 스타일에 받아도 되는 색 글자(16진·rgb()·hsl()) — 스크립트·따옴표가 끼지 않게 좁힌다. */
export function isCssColor(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const v = raw.trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(v) || /^(?:rgb|rgba|hsl|hsla)\(\s*[\d.%\s,/+-]+\)$/.test(v);
}

/** 16진 → HSL(0~1). */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const n = normalizeHex(hex) ?? '#000000';
  const r = parseInt(n.slice(1, 3), 16) / 255;
  const g = parseInt(n.slice(3, 5), 16) / 255;
  const b = parseInt(n.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h / 6, s, l };
}

/**
 * 후보에서 한 벌을 제안한다 — 강조 = 가장 자주 쓰인 선명한 색(채도 0.35↑·밝기 0.3~0.7), 바탕 = 가장 자주 쓰인 어두운 색
 * (밝기 0.2↓), 글 = 가장 자주 쓰인 밝은 색(밝기 0.85↑), 흐린 글 = 채도 낮은 가운데 밝기. 없으면 기본 한 벌의 그 칸.
 * 글꼴 = 가장 자주 쓰인 이름(일반 글꼴군 이름은 건너뛴다), 로고 = svg 먼저, 짧은 경로 먼저.
 */
export function suggestStyle(c: Pick<StyleCandidates, 'colors' | 'fonts' | 'logos'>): DocStyle {
  const byCount = [...c.colors].sort((a, b) => b.count - a.count);
  const pick = (test: (hsl: { h: number; s: number; l: number }) => boolean): string | undefined =>
    byCount.find((x) => test(hexToHsl(x.value)))?.value;
  const accent = pick((x) => x.s >= 0.35 && x.l >= 0.3 && x.l <= 0.7) ?? DEFAULT_DOC_STYLE.accent;
  const bg = pick((x) => x.l <= 0.2) ?? DEFAULT_DOC_STYLE.bg;
  const fg = pick((x) => x.l >= 0.85) ?? DEFAULT_DOC_STYLE.fg;
  const muted = pick((x) => x.s <= 0.25 && x.l > 0.35 && x.l < 0.75) ?? DEFAULT_DOC_STYLE.muted;
  const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'system-ui', 'cursive', 'fantasy', 'inherit', 'initial', 'ui-sans-serif', 'ui-serif', 'ui-monospace', '-apple-system']);
  const font = [...c.fonts].sort((a, b) => (b.file ? 1 : 0) - (a.file ? 1 : 0) || b.count - a.count).find((f) => !GENERIC.has(f.family.toLowerCase()));
  const logo = [...c.logos].sort((a, b) => (a.path.endsWith('.svg') ? 0 : 1) - (b.path.endsWith('.svg') ? 0 : 1) || a.path.length - b.path.length)[0];
  return {
    accent, bg, fg, muted,
    ...(font ? { fontFamily: font.family } : {}),
    ...(font?.file ? { fontFile: font.file } : {}),
    ...(logo ? { logo: logo.path } : {}),
  };
}
