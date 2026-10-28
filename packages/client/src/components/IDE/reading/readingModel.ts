/**
 * §5.5 — IDE 읽기 설정 순수 모델(DOM·store 모름). `ideStreamDensity`·`ideTextZoom` 과 같은 꼴 — graphStore + localStorage 에만 살고 서버·체크포인트에 가지 않는다.
 * 값의 근거(가독성 연구)는 상수 옆에. UI 는 이 표를 그대로 그리므로 새 축은 여기만 고친다.
 */

import type { StreamDensity } from '@vibisual/shared';

/**
 * 폭 상태(`data-ide-layout`) — 고르는 축이 아니라 `resolveReading` 의 파생값(②). `full` = 제한 없음(무제한·좁은 창),
 * `breakout` = 산문만 칼럼 안, 코드·diff·도구 상자·표는 칼럼 밖(코드를 칼럼에 가두는 상태는 두지 않는다).
 */
export const READING_LAYOUTS = ['full', 'breakout'] as const;
export type ReadingLayout = (typeof READING_LAYOUTS)[number];

/** 글꼴 출처 — `preset`(우리가 고른 무료·상업 사용 허용 목록) / `custom`(사용자 컴퓨터에 설치된 글꼴 이름을 CSS 에 옮길 뿐). */
export const READING_FONT_SOURCES = ['preset', 'custom'] as const;
export type ReadingFontSource = (typeof READING_FONT_SOURCES)[number];

/**
 * 폭 프리셋 — Dyson & Haselgrove(2001)가 측정한 세 지점.
 * 속도·이해·선호가 서로 다른 폭을 가리키므로 "하나의 정답 폭"은 없다. 그래서 고르게 한다.
 * 값은 `ch`(0 글리프 폭) 단위이고 라틴 CPL 환산은 `estimateCharsPerLine` 참조.
 */
export const READING_MEASURE_PRESETS = [
  /** 이해 우선 — 35 CPL 에서 서사문 이해도가 가장 높았다. */
  { id: 'comprehension', ch: 32 },
  /** 균형 — 55 CPL 이 속도·이해의 균형점(기본값). */
  { id: 'balanced', ch: 50 },
  /** 속도 우선 — 95 CPL 에서 읽기 속도가 가장 빨랐다. */
  { id: 'speed', ch: 86 },
  /** 전체 — 폭 제한 없음(②). */
  { id: 'full', ch: 0 },
] as const;
export type ReadingMeasurePresetId = (typeof READING_MEASURE_PRESETS)[number]['id'];

/** `ch === 0` 은 "제한 없음"을 뜻한다(CSS 에서 100% 로 번역). */
export const MEASURE_UNLIMITED = 0;

export const MEASURE_MIN_CH = 24;
export const MEASURE_MAX_CH = 160;

/**
 * 내용 폭(#17-22 ⑩, 창 폭 대비 %) — 글줄만 좁히는 `measureCh` 와 달리 카드·도구 상자·코드·표까지 본문 전체를 좁힌다. 100 = 제한 없음.
 * 방향은 대화 정렬(⑨): 켜면 말하는 쪽 끝에 붙어 반대쪽만, 끄면 가운데로. 바닥 10(⑩-1) — 0 이면 본문이 사라져 되돌릴 슬라이더조차 안 보인다.
 */
export const CONTENT_WIDTH_MIN_PCT = 10;
export const CONTENT_WIDTH_MAX_PCT = 100;

/**
 * ch → 글자 수 환산 계수.
 * 비례 sans 에서 `0` 글리프는 약 0.55em, 라틴 평균 자폭은 약 0.5em, CJK 는 전각(1em)이다.
 * 따라서 라틴 CPL ≈ ch × 1.1, CJK 글자 수 ≈ ch × 0.55.
 */
export const LATIN_CHARS_PER_CH = 1.1;
export const CJK_CHARS_PER_CH = 0.55;

/** WCAG 2.2 SC 1.4.8(AAA) 한 줄 상한 — 비CJK 80자 / CJK 40자. */
export const WCAG_MAX_CPL_LATIN = 80;
export const WCAG_MAX_CPL_CJK = 40;

/** 행간 — Rello et al.(CHI 2016)은 극단(0.8·1.8)이 해롭다고 봤고, CJK 조판 권장은 1.7 이다. */
export const LINE_HEIGHT_MIN = 1.3;
export const LINE_HEIGHT_MAX = 2.0;
export const LINE_HEIGHT_DEFAULT = 1.7;
/** WCAG 2.2 SC 1.4.12 가 "덮어써도 깨지지 않아야 한다"고 요구하는 최소 행간. */
export const LINE_HEIGHT_WCAG = 1.5;

/** 자간 — SC 1.4.12 상한 0.12em. 음수는 조밀하게 보고 싶은 사용자를 위한 여유. */
export const LETTER_SPACING_MIN = -0.02;
export const LETTER_SPACING_MAX = 0.12;
export const LETTER_SPACING_DEFAULT = 0;

/** 어간 — SC 1.4.12 상한 0.16em. */
export const WORD_SPACING_MIN = 0;
export const WORD_SPACING_MAX = 0.16;
export const WORD_SPACING_DEFAULT = 0;

/** 문단 간격(em) — SC 1.4.12 는 글자 크기의 2배까지 지원할 것을 요구한다. */
export const PARAGRAPH_SPACING_MIN = 0.4;
export const PARAGRAPH_SPACING_MAX = 2.0;
export const PARAGRAPH_SPACING_DEFAULT = 0.9;

/** 본문 좌우 여백(px) — 칼럼 밖으로 나간 요소가 창에 딱 붙지 않게 한다. */
export const READING_GUTTER_PX = 16;
export const READING_GUTTER_MOBILE_PX = 6;

/**
 * 글자 크기 축은 새로 만들지 않고 이미 있는 `ideTextZoom`(Ctrl+휠)을 패널에서 함께 조절한다.
 * 기준 크기는 본문에 걸린 Tailwind `prose-sm` 의 14px 이다.
 */
export const IDE_BASE_FONT_PX = 14;
/**
 * Rello, Pielot & Marcos(CHI 2016)는 10~26pt 를 아이트래킹으로 비교해 **18pt 까지** 가독성과
 * 이해도가 계속 좋아졌다고 봤다. 96dpi 에서 18pt = 24px 이므로 그 지점을 권장 눈금으로 둔다.
 */
export const RESEARCH_FONT_PX = 24;
export const RESEARCH_TEXT_ZOOM = RESEARCH_FONT_PX / IDE_BASE_FONT_PX;

/** 줌 배율 → 실제 본문 픽셀(패널이 "지금 몇 px 인지"를 그대로 보여준다). */
export function effectiveFontPx(textZoom: number): number {
  return Math.round(IDE_BASE_FONT_PX * textZoom);
}

/**
 * 모바일 자동 변형 임계 — Tailwind `md`(768px)와 같은 자리.
 * 이 아래에서는 폭 제한이 의미가 없다(창 자체가 이미 읽기 폭보다 좁다). 여백만 먹으므로 푼다.
 */
export const READING_MOBILE_MAX_WIDTH = 768;
/** 좁은 화면에서 행간을 조금 올린다 — 짧은 줄이 연달아 붙으면 줄을 놓치기 쉽다. */
export const READING_MOBILE_LINE_HEIGHT_BONUS = 0.08;

export interface ReadingSettings {
  /** 읽기 폭(ch). `MEASURE_UNLIMITED`(0) = 제한 없음 — 폭 축은 이것 하나다(②). */
  measureCh: number;
  /** 행간 배수. */
  lineHeight: number;
  /** 자간(em). */
  letterSpacing: number;
  /** 어간(em). */
  wordSpacing: number;
  /** 문단 뒤 간격(em). */
  paragraphSpacing: number;
  /** 글꼴 출처 — 제공 목록(상업 사용 허용 글꼴만)과 사용자 컴퓨터의 커스텀 글꼴은 법적 경계가 달라 둘로 나눈다. */
  fontSource: ReadingFontSource;
  /** 제공 글꼴 목록에서 고른 id(`readingFonts.ts` 의 레지스트리 키). `fontSource === 'preset'` 일 때 쓰인다. */
  fontId: string;
  /** 사용자가 직접 적은 글꼴 패밀리 이름. `fontSource === 'custom'` 일 때 쓰인다. */
  customFontFamily: string;
  /** 좁은 화면에서 폭 제한을 자동으로 푸는가. */
  autoMobile: boolean;
  /** 대화 정렬 — 켜면 메신저처럼 내 말은 오른쪽, AI 말은 왼쪽. */
  chatAlign: boolean;
  /** 내용 폭(창 폭 대비 %) — 본문 상자 전체 최대 폭, `measureCh` 와 직교. 100 = 제한 없음. */
  contentWidthPct: number;
}

/** 기본값 — 폭 제한 없음 + CJK 권장 행간. 기본을 좁은 칼럼으로 두지 마라 — 손댄 적 없는 화면이 갑자기 좁아진다(좁히기는 사용자 선택, `setIdeReading` 이 저장). */
export const DEFAULT_READING_SETTINGS: ReadingSettings = {
  measureCh: MEASURE_UNLIMITED,
  lineHeight: LINE_HEIGHT_DEFAULT,
  letterSpacing: LETTER_SPACING_DEFAULT,
  wordSpacing: WORD_SPACING_DEFAULT,
  paragraphSpacing: PARAGRAPH_SPACING_DEFAULT,
  fontSource: 'preset',
  fontId: 'system',
  // 빈 문자열 = 아직 고르지 않음. 커스텀으로 바꿔도 이름을 적기 전까지는 기본 글꼴이 그대로 쓰인다.
  customFontFamily: '',
  autoMobile: true,
  // 대화 정렬도 기본은 꺼짐 — 폭 안과 같은 이유로, 설정을 만진 적 없는 사용자의 화면은 그대로여야 한다.
  chatAlign: false,
  // 내용 폭도 같은 규율 — 100%(제한 없음)가 손대기 전 화면이다.
  contentWidthPct: CONTENT_WIDTH_MAX_PCT,
};

/** 패널이 함께 조절하는 기존 두 축(글자 크기·스트림 밀도)의 기본값 — graphStore 초기 폴백과 같은 값을 여기 한 곳에 둔다("이 항목만 되돌리기"용). */
export const DEFAULT_IDE_TEXT_ZOOM = 1;
export const DEFAULT_IDE_STREAM_DENSITY: StreamDensity = 'standard';

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** 커스텀 글꼴 이름 길이 상한 — 실제 패밀리 이름은 이보다 한참 짧다. */
export const CUSTOM_FONT_NAME_MAX = 64;

/**
 * 커스텀 글꼴 이름 소독 — `--ide-reading-font` 로 CSS 에 그대로 들어가므로 따옴표·세미콜론·괄호·중괄호를 지운다(선언 밖으로 샌다).
 * 어느 언어 이름이든 통과하게 금지 목록 방식.
 */
export function sanitizeFontFamily(raw: string): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/["'`;{}()<>\\/*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CUSTOM_FONT_NAME_MAX);
}

/** 폭은 0(제한 없음)이거나 [MIN, MAX] 범위의 값이다 — 그 사이 값은 최솟값으로 끌어올린다. */
export function clampMeasureCh(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return MEASURE_UNLIMITED;
  // 위 가드가 비유한수를 이미 걷어냈으므로 폴백은 닿지 않는다 — 범위 안 값을 둬 읽는 사람이 헷갈리지 않게 한다.
  return Math.round(clamp(value, MEASURE_MIN_CH, MEASURE_MAX_CH, MEASURE_MIN_CH));
}

/** 내용 폭은 언제나 [MIN, MAX] 안의 정수 % 다 — 슬라이더 밖의 값(구버전·손상)이 들어와도 화면이 깨지지 않게. */
export function clampContentWidthPct(value: number): number {
  return Math.round(clamp(
    Number(value),
    CONTENT_WIDTH_MIN_PCT,
    CONTENT_WIDTH_MAX_PCT,
    DEFAULT_READING_SETTINGS.contentWidthPct,
  ));
}

/**
 * 저장값(구버전·손상 포함) → 늘 유효한 설정. 옛 `layout` 마이그레이션(②): `full` 이었으면 제한 없음으로(그 `measureCh` 는 화면에 안 걸리던 값이라
 * 이어받으면 켜자마자 글이 좁아진다), 칼럼 계열이면 저장된 `measureCh` 그대로.
 */
export function normalizeReadingSettings(raw: unknown): ReadingSettings {
  const d = DEFAULT_READING_SETTINGS;
  if (typeof raw !== 'object' || raw === null) return { ...d };
  const r = raw as Partial<Record<keyof ReadingSettings, unknown>> & { layout?: unknown };
  const wasUnconstrained = r.layout === 'full';
  return {
    measureCh: wasUnconstrained
      ? MEASURE_UNLIMITED
      : clampMeasureCh(typeof r.measureCh === 'number' ? r.measureCh : d.measureCh),
    lineHeight: clamp(Number(r.lineHeight), LINE_HEIGHT_MIN, LINE_HEIGHT_MAX, d.lineHeight),
    letterSpacing: clamp(Number(r.letterSpacing), LETTER_SPACING_MIN, LETTER_SPACING_MAX, d.letterSpacing),
    wordSpacing: clamp(Number(r.wordSpacing), WORD_SPACING_MIN, WORD_SPACING_MAX, d.wordSpacing),
    paragraphSpacing: clamp(Number(r.paragraphSpacing), PARAGRAPH_SPACING_MIN, PARAGRAPH_SPACING_MAX, d.paragraphSpacing),
    fontSource: READING_FONT_SOURCES.includes(r.fontSource as ReadingFontSource)
      ? (r.fontSource as ReadingFontSource)
      : d.fontSource,
    fontId: typeof r.fontId === 'string' && r.fontId ? r.fontId : d.fontId,
    customFontFamily: sanitizeFontFamily(typeof r.customFontFamily === 'string' ? r.customFontFamily : d.customFontFamily),
    autoMobile: typeof r.autoMobile === 'boolean' ? r.autoMobile : d.autoMobile,
    chatAlign: typeof r.chatAlign === 'boolean' ? r.chatAlign : d.chatAlign,
    contentWidthPct: clampContentWidthPct(
      typeof r.contentWidthPct === 'number' ? r.contentWidthPct : d.contentWidthPct,
    ),
  };
}

/** 줄당 글자 수 추정 — 폭 제한이 없으면 null(창 폭에 따라 달라지므로 단정하지 않는다). */
export function estimateCharsPerLine(measureCh: number): { latin: number; cjk: number } | null {
  if (measureCh === MEASURE_UNLIMITED) return null;
  return {
    latin: Math.round(measureCh * LATIN_CHARS_PER_CH),
    cjk: Math.round(measureCh * CJK_CHARS_PER_CH),
  };
}

export type ReadingVerdict = 'ok' | 'warn' | 'over';

/**
 * 현재 폭이 WCAG CJK 상한(40자)에 견줘 어디쯤인지.
 * 한글은 전각이라 라틴 상한(80자)보다 CJK 상한이 먼저 걸린다 — 우리 UI 언어 기준으로 그쪽을 본다.
 */
export function judgeMeasure(measureCh: number): ReadingVerdict {
  const est = estimateCharsPerLine(measureCh);
  if (!est) return 'over';
  if (est.cjk > WCAG_MAX_CPL_CJK) return 'warn';
  return 'ok';
}

/**
 * 항목 kind 별 폭 취급(index.css `[data-ide-prose]`/`[data-ide-wide]` 와 짝). prose = `.ide-md` 를 품은 항목(폭은 안쪽 마크다운 그리드),
 * wide = 도구 호출·묶음(칼럼 밖으로), 나머지는 칼럼 안.
 */
export const READING_PROSE_ITEM_KINDS: ReadonlySet<string> = new Set(['text', 'result', 'command']);
export const READING_WIDE_ITEM_KINDS: ReadonlySet<string> = new Set(['tool', 'toolgroup']);

/** 발화 주체 — 대화 정렬이 좌우를 가르는 표식(정렬은 index.css). `user` = 프롬프트(오른쪽), `ai` = 왼쪽, 표식 없음 = 시스템 줄(정렬 안 함). */
export const READING_USER_ITEM_KINDS: ReadonlySet<string> = new Set(['command']);
// §5.5 #17-12 ③ — 실패 사유(`error`)도 누구의 말이 아니라 **일어난 일**이다(정렬 대상 ❌).
// §5.5 #17-39 — 단계 자국(`step`)도 같다. 사고는 말이 아니라 **걸린 시간**이라 좌우 어느 쪽도 아니다.
export const READING_NEUTRAL_ITEM_KINDS: ReadonlySet<string> = new Set(['system', 'error', 'step', 'turnstop']);

export type ReadingSpeaker = 'user' | 'ai' | null;

export function readingItemSpeaker(kind: string): ReadingSpeaker {
  if (READING_USER_ITEM_KINDS.has(kind)) return 'user';
  if (READING_NEUTRAL_ITEM_KINDS.has(kind)) return null;
  return 'ai';
}

/** 발화 주체 표식 — 두 표면(Sub 탭·메인 탭)이 같은 결과를 쓰도록 한 함수에서 만든다. */
function speakerAttr(kind: string): Record<string, string> {
  const speaker = readingItemSpeaker(kind);
  return speaker ? { 'data-ide-role': speaker } : {};
}

/** 항목 래퍼에 실을 data 속성 — 렌더러는 결과를 그대로 펼치기만 한다(분기 없음). */
export function readingItemAttrs(kind: string): Record<string, string> {
  const speaker = speakerAttr(kind);
  if (READING_WIDE_ITEM_KINDS.has(kind)) return { ...speaker, 'data-ide-wide': '' };
  if (READING_PROSE_ITEM_KINDS.has(kind)) return { ...speaker, 'data-ide-prose': '' };
  return speaker;
}

/**
 * 마크다운 컨테이너(`.ide-md`)를 쓰지 않는 표면용 — 메인 탭 타임라인이 그렇다.
 * 넘길 안쪽 그리드가 없으므로 prose 위임을 하지 않는다(위임하면 폭을 잡는 사람이 아무도 없어진다).
 */
export function readingItemAttrsNoProse(kind: string): Record<string, string> {
  const speaker = speakerAttr(kind);
  return READING_WIDE_ITEM_KINDS.has(kind) ? { ...speaker, 'data-ide-wide': '' } : speaker;
}

/** CSS 커스텀 프로퍼티 이름 — 이 표가 index.css 와의 유일한 계약이다. */
export const READING_CSS_VARS = {
  measure: '--ide-measure',
  /** 본문 상자 전체의 최대 폭(#17-22 ⑩) — 글줄 폭(`measure`)의 바깥 층이다. */
  contentWidth: '--ide-content-width',
  lineHeight: '--ide-line-height',
  letterSpacing: '--ide-letter-spacing',
  wordSpacing: '--ide-word-spacing',
  paragraphSpacing: '--ide-paragraph-spacing',
  fontFamily: '--ide-reading-font',
  gutter: '--ide-reading-gutter',
} as const;

export interface ResolvedReading {
  /** `document.documentElement` 에 실을 CSS 변수 묶음. */
  vars: Record<string, string>;
  /** `data-ide-layout` 값 — index.css 가 이걸로 그리드/탈출을 켠다. */
  layoutAttr: ReadingLayout;
  /** 좁은 화면 자동 변형이 실제로 걸렸는가(패널이 사용자에게 알린다). */
  mobileAdapted: boolean;
  /** `data-ide-chat` — 켜졌을 때만 단다. 꺼지면 `null`(속성 자체가 안 붙는다). */
  chatAttr: 'on' | null;
}

/** 설정 + 뷰포트 → 렌더 값 전부(뷰포트를 인자로 받아 어떤 폭이든 시험한다). */
export function resolveReading(
  settings: ReadingSettings,
  viewportWidth: number,
  fontStack: string,
): ResolvedReading {
  const isMobile = settings.autoMobile && viewportWidth > 0 && viewportWidth <= READING_MOBILE_MAX_WIDTH;

  // 폭은 제한을 걸었고 창이 넓을 때만 잡는다. 좁은 화면은 폭 제한을 풀고(여백만 먹는다) 행간을 조금 올린다.
  const constrained = settings.measureCh !== MEASURE_UNLIMITED && !isMobile;
  const measure = constrained ? `${settings.measureCh}ch` : '100%';
  const lineHeight = clamp(
    settings.lineHeight + (isMobile ? READING_MOBILE_LINE_HEIGHT_BONUS : 0),
    LINE_HEIGHT_MIN,
    LINE_HEIGHT_MAX,
    settings.lineHeight,
  );
  const gutter = isMobile ? READING_GUTTER_MOBILE_PX : READING_GUTTER_PX;

  // 내용 폭도 좁은 화면에서는 스스로 푼다(⑥ 과 같은 규율) — 이미 좁은 창을 더 좁히면 여백만 먹는다.
  const contentLimited = !isMobile && settings.contentWidthPct < CONTENT_WIDTH_MAX_PCT;
  const contentWidth = contentLimited ? `${settings.contentWidthPct}%` : '100%';

  return {
    vars: {
      [READING_CSS_VARS.measure]: measure,
      [READING_CSS_VARS.contentWidth]: contentWidth,
      [READING_CSS_VARS.lineHeight]: String(Number(lineHeight.toFixed(3))),
      [READING_CSS_VARS.letterSpacing]: `${settings.letterSpacing}em`,
      [READING_CSS_VARS.wordSpacing]: `${settings.wordSpacing}em`,
      [READING_CSS_VARS.paragraphSpacing]: `${settings.paragraphSpacing}em`,
      [READING_CSS_VARS.fontFamily]: fontStack,
      [READING_CSS_VARS.gutter]: `${gutter}px`,
    },
    // 제한이 없으면(모바일 포함) 그리드를 끄는 `full`, 걸렸으면 산문만 칼럼에 두는 `breakout`(②).
    layoutAttr: constrained ? 'breakout' : 'full',
    // 폭 제한이든 내용 폭이든 **실제로 풀린 게 있을 때만** 알린다(걸린 게 없으면 알릴 것도 없다).
    mobileAdapted: isMobile
      && (settings.measureCh !== MEASURE_UNLIMITED || settings.contentWidthPct < CONTENT_WIDTH_MAX_PCT),
    // 대화 정렬은 좁은 화면에서도 그대로 둔다 — 메신저가 폰에서 더 자연스럽지, 덜하지 않다.
    chatAttr: settings.chatAlign ? 'on' : null,
  };
}
