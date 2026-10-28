/**
 * §5.5 — 읽기 설정 글꼴 레지스트리. 전부 SIL OFL 1.1 이고 웹폰트를 동봉한다(`scripts/fetch-reading-fonts.mjs` → `src/assets/fonts/`, `main.tsx` 가 CSS 를 싣는다)
 * — OS 설치에 기대면 조용히 폴백된다. 동봉 글꼴은 탐지하지 않는다(`probe: null`), `detectFontAvailability` 는 동봉 안 한 글꼴을 넣을 때를 위해 남긴다.
 * 새 글꼴은 배열에 한 줄, 동봉하려면 내려받기 스크립트 목록에도 더해 한 번 돌린다.
 */

import { sanitizeFontFamily, type ReadingSettings } from './readingModel.js';

export interface ReadingFont {
  /** 저장 키. */
  id: string;
  /** 화면에 그대로 보여줄 글꼴 이름(고유명사 — 번역하지 않는다). */
  label: string;
  /**
   * CSS `font-family` 스택. 항상 `var(--font-sans)` 로 끝나 한글 폴백이 보장된다.
   * `null` 이면 앱 기본값을 그대로 쓴다(레지스트리의 'system' 항목).
   */
  stack: string | null;
  /** 설치 여부 탐지에 쓸 실제 패밀리 이름. `null` 이면 탐지 생략(항상 사용 가능). */
  probe: string | null;
  /** 웹폰트를 동봉했는가 — true 면 OS 설치와 무관하므로 탐지(`probe`)하지 않는다. */
  bundled?: boolean;
  /** 라이선스 표기 — 상업적 사용 가능함을 사용자가 확인할 수 있게 그대로 노출한다. */
  license: string;
  /**
   * 가독성 연구가 직접 근거로 있는 글꼴이면 true.
   * UI 가 이 표식을 달아 "왜 이게 목록에 있는지"를 설명한다.
   */
  researchBacked?: boolean;
}

const FALLBACK = "var(--font-sans)";

export const READING_FONTS: readonly ReadingFont[] = [
  {
    id: 'system',
    label: 'Vibisual Default',
    stack: null,
    probe: null,
    license: 'OFL-1.1',
  },
  {
    id: 'pretendard',
    label: 'Pretendard',
    stack: `'Pretendard', ${FALLBACK}`,
    probe: null,
    bundled: true,
    license: 'OFL-1.1',
  },
  {
    id: 'notoSansKr',
    label: 'Noto Sans KR',
    stack: `'Noto Sans KR', ${FALLBACK}`,
    probe: null,
    bundled: true,
    license: 'OFL-1.1',
  },
  {
    id: 'nanumGothic',
    label: 'Nanum Gothic',
    stack: `'NanumGothic', 'Nanum Gothic', ${FALLBACK}`,
    probe: null,
    bundled: true,
    license: 'OFL-1.1',
  },
  {
    id: 'nanumMyeongjo',
    label: 'Nanum Myeongjo',
    stack: `'NanumMyeongjo', 'Nanum Myeongjo', ${FALLBACK}`,
    probe: null,
    bundled: true,
    license: 'OFL-1.1',
  },
  {
    id: 'ibmPlexSansKr',
    label: 'IBM Plex Sans KR',
    stack: `'IBM Plex Sans KR', ${FALLBACK}`,
    probe: null,
    bundled: true,
    license: 'OFL-1.1',
  },
  {
    id: 'gothicA1',
    label: 'Gothic A1',
    stack: `'Gothic A1', ${FALLBACK}`,
    probe: null,
    bundled: true,
    license: 'OFL-1.1',
  },
  {
    id: 'spoqaHanSansNeo',
    label: 'Spoqa Han Sans Neo',
    stack: `'Spoqa Han Sans Neo', ${FALLBACK}`,
    probe: null,
    bundled: true,
    license: 'OFL-1.1',
  },
  {
    // Bonnie Shaver-Troup 의 읽기 능력 연구에서 출발해 글자 폭·간격을 넓힌 글꼴.
    id: 'lexend',
    label: 'Lexend',
    stack: `'Lexend', ${FALLBACK}`,
    probe: null,
    bundled: true,
    license: 'OFL-1.1',
    researchBacked: true,
  },
  {
    // Braille Institute 가 저시력 판독성을 목표로 만든 글꼴 — 비슷한 글자꼴을 일부러 다르게 그린다.
    id: 'atkinson',
    label: 'Atkinson Hyperlegible',
    stack: `'Atkinson Hyperlegible', ${FALLBACK}`,
    probe: null,
    bundled: true,
    license: 'OFL-1.1',
    researchBacked: true,
  },
  {
    id: 'inter',
    label: 'Inter',
    stack: `'Inter', ${FALLBACK}`,
    probe: null,
    bundled: true,
    license: 'OFL-1.1',
  },
];

export function findReadingFont(id: string): ReadingFont {
  return READING_FONTS.find((f) => f.id === id) ?? READING_FONTS[0]!;
}

/** 선택된 글꼴의 CSS 스택. 기본값이면 앱 전역 `--font-sans` 를 그대로 물려받는다. */
export function resolveFontStack(id: string): string {
  return findReadingFont(id).stack ?? 'var(--font-sans)';
}

/**
 * 커스텀 글꼴 이름 → CSS 스택. 이름이 비었으면 앱 기본값으로 떨어진다(빈 선언을 만들지 않는다).
 * 폴백을 항상 뒤에 붙이므로 오타나 미설치 글꼴을 적어도 글자가 사라지지 않는다.
 */
export function customFontStack(family: string): string {
  const clean = sanitizeFontFamily(family);
  return clean ? `'${clean}', ${FALLBACK}` : 'var(--font-sans)';
}

/** 글꼴 출처를 가려 실제로 쓸 스택을 정한다 — 두 갈래가 갈리는 단 한 곳. */
export function resolveReadingFontStack(
  settings: Pick<ReadingSettings, 'fontSource' | 'fontId' | 'customFontFamily'>,
): string {
  return settings.fontSource === 'custom'
    ? customFontStack(settings.customFontFamily)
    : resolveFontStack(settings.fontId);
}

// 설치 여부 탐지 — `document.fonts.check()` 는 폴백에도 참을 줄 때가 있어 믿지 않는다. 서로 다른 두 기준 글꼴 위에 얹어 폭을 재고 하나라도 다르면 적용된 것으로 본다.

const PROBE_TEXT = 'mmmmmmmmmmlliWWQ가나다한글AZ0';
const PROBE_SIZE = 72;
const PROBE_BASES = ['monospace', 'serif', 'sans-serif'] as const;
/** 계측 오차를 넘어야 "다르다"고 판정 — 서브픽셀 흔들림을 걸러 낸다. */
const PROBE_EPSILON = 0.5;

function measure(ctx: CanvasRenderingContext2D, family: string): number {
  ctx.font = `${PROBE_SIZE}px ${family}`;
  return ctx.measureText(PROBE_TEXT).width;
}

/** 커스텀 글꼴 이름의 설치 여부 — 적는 동안 알려 조용한 폴백을 없앤다. 잴 수 없으면 `null`(없다고 단정하지 않는다). */
export function isFontFamilyAvailable(family: string): boolean | null {
  const clean = sanitizeFontFamily(family);
  if (!clean) return null;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = document.createElement('canvas').getContext('2d');
  } catch {
    return null;
  }
  if (!ctx) return null;
  return PROBE_BASES.some((baseFamily) => {
    const baseWidth = measure(ctx!, baseFamily);
    const withFont = measure(ctx!, `'${clean}', ${baseFamily}`);
    return Math.abs(withFont - baseWidth) > PROBE_EPSILON;
  });
}

/** 설치된 글꼴 패밀리 목록(커스텀 입력의 자동완성 후보로만). `queryLocalFonts` 는 권한 거부·미지원이 흔해 실패를 정상 경로로 본다. 이름만 읽는다. */
export async function queryLocalFontFamilies(): Promise<string[]> {
  const q = (window as unknown as {
    queryLocalFonts?: () => Promise<Array<{ family?: string }>>;
  }).queryLocalFonts;
  if (typeof q !== 'function') return [];
  try {
    const fonts = await q.call(window);
    const families = new Set<string>();
    for (const f of fonts) {
      const family = sanitizeFontFamily(f.family ?? '');
      if (family) families.add(family);
    }
    return [...families].sort((a, b) => a.localeCompare(b));
  } catch {
    // 권한 거부·미지원 — 자동완성 없이 직접 입력으로 간다(오류로 다루지 않는다).
    return [];
  }
}

/**
 * 레지스트리 전체의 설치 여부를 잰다. 브라우저 API 를 쓰므로 순수하지 않다 — 훅에서만 부른다.
 * 계측이 불가능한 환경(캔버스 없음 등)에서는 **전부 사용 가능**으로 본다(잘못 막는 쪽이 더 나쁘다).
 */
export function detectFontAvailability(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const font of READING_FONTS) result[font.id] = true;

  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = document.createElement('canvas').getContext('2d');
  } catch {
    return result;
  }
  if (!ctx) return result;

  const baseWidths = PROBE_BASES.map((base) => measure(ctx!, base));

  for (const font of READING_FONTS) {
    if (!font.probe) continue;
    let available = false;
    PROBE_BASES.forEach((base, i) => {
      if (available) return;
      const w = measure(ctx!, `'${font.probe}', ${base}`);
      if (Math.abs(w - baseWidths[i]!) > PROBE_EPSILON) available = true;
    });
    result[font.id] = available;
  }
  return result;
}
