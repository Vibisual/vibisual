import { describe, it, expect } from 'vitest';
import {
  DEFAULT_READING_SETTINGS, MEASURE_UNLIMITED, MEASURE_MIN_CH, MEASURE_MAX_CH,
  LINE_HEIGHT_MAX, READING_MOBILE_MAX_WIDTH, READING_CSS_VARS,
  IDE_BASE_FONT_PX, RESEARCH_FONT_PX, RESEARCH_TEXT_ZOOM,
  CONTENT_WIDTH_MIN_PCT, CONTENT_WIDTH_MAX_PCT, clampContentWidthPct,
  CUSTOM_FONT_NAME_MAX, sanitizeFontFamily,
  clampMeasureCh, normalizeReadingSettings, estimateCharsPerLine, judgeMeasure,
  readingItemAttrs, readingItemAttrsNoProse, readingItemSpeaker, resolveReading, effectiveFontPx,
  type ReadingSettings,
} from './readingModel.js';
import { customFontStack, resolveFontStack, resolveReadingFontStack } from './readingFonts.js';

const STACK = "'Test', sans-serif";
const base = (patch: Partial<ReadingSettings> = {}): ReadingSettings => ({ ...DEFAULT_READING_SETTINGS, ...patch });

describe('clampMeasureCh', () => {
  it('0 과 음수는 "제한 없음"으로 접는다', () => {
    expect(clampMeasureCh(0)).toBe(MEASURE_UNLIMITED);
    expect(clampMeasureCh(-10)).toBe(MEASURE_UNLIMITED);
    expect(clampMeasureCh(Number.NaN)).toBe(MEASURE_UNLIMITED);
  });
  it('범위 밖 값은 경계로 끌어당긴다', () => {
    expect(clampMeasureCh(5)).toBe(MEASURE_MIN_CH);
    expect(clampMeasureCh(9999)).toBe(MEASURE_MAX_CH);
  });
});

describe('clampContentWidthPct', () => {
  it('범위 밖 값은 경계로 끌어당긴다', () => {
    expect(clampContentWidthPct(0)).toBe(CONTENT_WIDTH_MIN_PCT);
    expect(clampContentWidthPct(-40)).toBe(CONTENT_WIDTH_MIN_PCT);
    expect(clampContentWidthPct(9999)).toBe(CONTENT_WIDTH_MAX_PCT);
  });
  it('숫자가 아닌 값은 기본값(제한 없음)으로 떨어진다', () => {
    expect(clampContentWidthPct(Number.NaN)).toBe(DEFAULT_READING_SETTINGS.contentWidthPct);
  });
  it('슬라이더가 만들 수 없는 소수는 정수 % 로 접는다', () => {
    expect(clampContentWidthPct(72.4)).toBe(72);
  });
  // §5.5 #17-22 ⑩-1 — 눈금의 양끝. 위는 창 전체 너비, 아래는 "많이 줄어드는" 자리까지 열려 있어야 한다.
  // 0 으로 두지 않는 이유는 본문이 통째로 사라져 되돌릴 화면조차 안 보이기 때문이다.
  it('바닥은 10% 이고 그보다 낮은 값도 화면이 사라지지 않게 바닥에서 멈춘다', () => {
    expect(CONTENT_WIDTH_MIN_PCT).toBe(10);
    expect(clampContentWidthPct(1)).toBe(10);
    expect(clampContentWidthPct(15)).toBe(15);
  });
});

describe('DEFAULT_READING_SETTINGS', () => {
  it('기본 폭은 제한 없음 — 설정을 만진 적 없는 사용자의 화면이 바뀌면 안 된다', () => {
    expect(DEFAULT_READING_SETTINGS.measureCh).toBe(MEASURE_UNLIMITED);
    const r = resolveReading(DEFAULT_READING_SETTINGS, 1920, STACK);
    expect(r.vars[READING_CSS_VARS.measure]).toBe('100%');
    // 폭 상태도 파생값이라 제한이 없으면 그리드 자체가 꺼진 `full` 이다(② v5.04).
    expect(r.layoutAttr).toBe('full');
  });
  it('대화 정렬도 기본은 꺼짐 — 켜야만 속성이 붙는다', () => {
    expect(DEFAULT_READING_SETTINGS.chatAlign).toBe(false);
    expect(resolveReading(DEFAULT_READING_SETTINGS, 1920, STACK).chatAttr).toBeNull();
  });
  it('내용 폭 기본도 제한 없음 — 손대기 전 화면과 같아야 한다', () => {
    expect(DEFAULT_READING_SETTINGS.contentWidthPct).toBe(CONTENT_WIDTH_MAX_PCT);
    expect(resolveReading(DEFAULT_READING_SETTINGS, 1920, STACK).vars[READING_CSS_VARS.contentWidth]).toBe('100%');
  });
});

describe('normalizeReadingSettings', () => {
  it('빈 값·잘못된 값은 기본값으로 복구한다', () => {
    expect(normalizeReadingSettings(null)).toEqual(DEFAULT_READING_SETTINGS);
    expect(normalizeReadingSettings('nope')).toEqual(DEFAULT_READING_SETTINGS);
  });
  // ② v5.04 마이그레이션 — 폭 안이 있던 시절의 저장값을 폭 하나로 옮긴다.
  it('옛 full 안 저장값은 읽기 폭 제한 없음으로 옮겨진다 — 켜자마자 글이 좁아지면 안 된다', () => {
    // 그 시절 measureCh(50)는 "칼럼으로 바꾸면 쓸 시작값"일 뿐 화면에 걸리지 않았다.
    expect(normalizeReadingSettings({ layout: 'full', measureCh: 50 }).measureCh).toBe(MEASURE_UNLIMITED);
  });
  it('옛 칼럼 계열 저장값은 그때 보던 폭을 그대로 이어받는다', () => {
    expect(normalizeReadingSettings({ layout: 'preset', measureCh: 50 }).measureCh).toBe(50);
    expect(normalizeReadingSettings({ layout: 'column', measureCh: 60 }).measureCh).toBe(60);
  });
  it('폐지된 layout 필드는 결과에 남지 않는다', () => {
    expect(normalizeReadingSettings({ layout: 'legacy-mode' })).not.toHaveProperty('layout');
  });
  it('범위를 벗어난 타이포그래피 값을 잘라 낸다', () => {
    const n = normalizeReadingSettings({ lineHeight: 99, letterSpacing: 5, wordSpacing: -3, paragraphSpacing: 0 });
    expect(n.lineHeight).toBe(LINE_HEIGHT_MAX);
    expect(n.letterSpacing).toBeLessThanOrEqual(0.12);
    expect(n.wordSpacing).toBeGreaterThanOrEqual(0);
    expect(n.paragraphSpacing).toBeGreaterThan(0);
  });
  it('유효한 값은 그대로 통과시킨다', () => {
    const src = base({ measureCh: 60, fontId: 'lexend', autoMobile: false });
    expect(normalizeReadingSettings(src)).toEqual(src);
  });
  it('내용 폭이 없던 구버전 저장값은 제한 없음으로 복구된다', () => {
    const { contentWidthPct: _drop, ...legacy } = base({ measureCh: 50 });
    expect(normalizeReadingSettings(legacy).contentWidthPct).toBe(CONTENT_WIDTH_MAX_PCT);
  });
  it('범위를 벗어난 내용 폭을 잘라 낸다', () => {
    expect(normalizeReadingSettings({ contentWidthPct: 5 }).contentWidthPct).toBe(CONTENT_WIDTH_MIN_PCT);
    expect(normalizeReadingSettings({ contentWidthPct: 400 }).contentWidthPct).toBe(CONTENT_WIDTH_MAX_PCT);
  });
});

describe('글꼴 — 제공 / 커스텀 2단', () => {
  it('기본은 제공 글꼴이고 커스텀 이름은 비어 있다', () => {
    expect(DEFAULT_READING_SETTINGS.fontSource).toBe('preset');
    expect(DEFAULT_READING_SETTINGS.customFontFamily).toBe('');
  });

  it('CSS 를 깨뜨릴 수 있는 문자는 이름에서 걷어 낸다', () => {
    // 따옴표·세미콜론·중괄호가 남으면 커스텀 프로퍼티 선언 밖으로 빠져나갈 수 있다.
    expect(sanitizeFontFamily("Segoe UI'; color: red; --x:{}")).toBe('Segoe UI color: red --x:');
    expect(sanitizeFontFamily('  Malgun   Gothic  ')).toBe('Malgun Gothic');
    expect(sanitizeFontFamily('')).toBe('');
  });

  it('한글·일본어 글꼴 이름은 그대로 통과한다(금지 목록 방식)', () => {
    expect(sanitizeFontFamily('맑은 고딕')).toBe('맑은 고딕');
    expect(sanitizeFontFamily('MS Pゴシック')).toBe('MS Pゴシック');
  });

  it('이름 길이는 상한에서 잘린다', () => {
    expect(sanitizeFontFamily('A'.repeat(200))).toHaveLength(CUSTOM_FONT_NAME_MAX);
  });

  it('모르는 출처는 기본값으로 떨어지고 커스텀 이름도 소독된다', () => {
    const n = normalizeReadingSettings({ fontSource: 'downloaded', customFontFamily: 'Foo"; }' });
    expect(n.fontSource).toBe('preset');
    expect(n.customFontFamily).toBe('Foo');
  });

  it('출처가 없던 구버전 저장값은 제공 글꼴로 복구된다', () => {
    const { fontSource: _s, customFontFamily: _c, ...legacy } = base({ fontId: 'lexend' });
    const n = normalizeReadingSettings(legacy);
    expect(n.fontSource).toBe('preset');
    expect(n.fontId).toBe('lexend');
    expect(n.customFontFamily).toBe('');
  });

  it('커스텀 스택은 폴백을 뒤에 달고, 이름이 비면 앱 기본값으로 떨어진다', () => {
    expect(customFontStack('Segoe UI')).toBe("'Segoe UI', var(--font-sans)");
    expect(customFontStack('   ')).toBe('var(--font-sans)');
  });

  it('출처에 따라 실제 스택이 갈린다 — 두 갈래가 만나는 단 한 곳', () => {
    expect(resolveReadingFontStack(base({ fontSource: 'preset', fontId: 'lexend' })))
      .toBe(resolveFontStack('lexend'));
    expect(resolveReadingFontStack(base({ fontSource: 'custom', customFontFamily: 'Segoe UI' })))
      .toBe("'Segoe UI', var(--font-sans)");
  });

  it('커스텀으로 바꿨지만 이름을 아직 안 적었으면 기본 글꼴이 그대로 쓰인다', () => {
    expect(resolveReadingFontStack(base({ fontSource: 'custom', customFontFamily: '' })))
      .toBe('var(--font-sans)');
  });
});

describe('estimateCharsPerLine / judgeMeasure', () => {
  it('폭 제한이 없으면 글자 수를 단정하지 않는다', () => {
    expect(estimateCharsPerLine(MEASURE_UNLIMITED)).toBeNull();
    expect(judgeMeasure(MEASURE_UNLIMITED)).toBe('over');
  });
  it('한글은 라틴의 절반쯤 들어간다(전각)', () => {
    const est = estimateCharsPerLine(50);
    expect(est).not.toBeNull();
    expect(est!.latin).toBe(55);
    expect(est!.cjk).toBe(28);
  });
  it('WCAG CJK 상한(40자)을 넘으면 경고로 판정한다', () => {
    expect(judgeMeasure(50)).toBe('ok');
    // 72ch ≈ 한글 40자 — 상한에 딱 걸터앉은 값이라 아직 ok.
    expect(judgeMeasure(72)).toBe('ok');
    expect(judgeMeasure(90)).toBe('warn');
  });
});

describe('readingItemAttrs', () => {
  it('도구 항목만 칼럼 밖으로 나간다', () => {
    expect(readingItemAttrs('tool')).toEqual({ 'data-ide-role': 'ai', 'data-ide-wide': '' });
    expect(readingItemAttrs('toolgroup')).toEqual({ 'data-ide-role': 'ai', 'data-ide-wide': '' });
  });
  it('마크다운 항목은 안쪽 그리드에 폭을 넘긴다', () => {
    expect(readingItemAttrs('text')).toEqual({ 'data-ide-role': 'ai', 'data-ide-prose': '' });
    expect(readingItemAttrs('result')).toEqual({ 'data-ide-role': 'ai', 'data-ide-prose': '' });
  });
  it('카드류는 칼럼 안에 남는다', () => {
    expect(readingItemAttrs('report')).toEqual({ 'data-ide-role': 'ai' });
    expect(readingItemAttrs('question')).toEqual({ 'data-ide-role': 'ai' });
  });
  it('마크다운이 없는 표면(메인 탭)에서는 prose 위임을 하지 않는다', () => {
    expect(readingItemAttrsNoProse('text')).toEqual({ 'data-ide-role': 'ai' });
    expect(readingItemAttrsNoProse('tool')).toEqual({ 'data-ide-role': 'ai', 'data-ide-wide': '' });
  });
});

describe('발화 주체 — 대화 정렬이 좌우를 가르는 기준', () => {
  it('사용자 프롬프트만 내 말이다', () => {
    expect(readingItemSpeaker('command')).toBe('user');
    expect(readingItemAttrs('command')).toEqual({ 'data-ide-role': 'user', 'data-ide-prose': '' });
  });
  it('AI 가 낸 것은 말·카드·도구를 가리지 않고 전부 AI 쪽이다', () => {
    for (const kind of ['text', 'result', 'plan', 'tool', 'toolgroup', 'report', 'question', 'review', 'list', 'ask', 'thinking-live']) {
      expect(readingItemSpeaker(kind)).toBe('ai');
    }
  });
  it('시스템 줄은 누구의 말도 아니라 표식을 달지 않는다(정렬에서 제외)', () => {
    expect(readingItemSpeaker('system')).toBeNull();
    expect(readingItemAttrs('system')).toEqual({});
    expect(readingItemAttrsNoProse('system')).toEqual({});
  });
});

describe('resolveReading', () => {
  it('폭 제한을 걸면 읽기 폭을 ch 로 내보내고 탈출 그리드를 켠다', () => {
    const r = resolveReading(base({ measureCh: 50 }), 1920, STACK);
    expect(r.vars[READING_CSS_VARS.measure]).toBe('50ch');
    expect(r.layoutAttr).toBe('breakout');
    expect(r.mobileAdapted).toBe(false);
  });

  it('제한 없음이면 폭을 잡지 않는다', () => {
    const r = resolveReading(base({ measureCh: MEASURE_UNLIMITED }), 1920, STACK);
    expect(r.vars[READING_CSS_VARS.measure]).toBe('100%');
    expect(r.layoutAttr).toBe('full');
  });

  it('좁은 창에서는 폭 제한이 스스로 풀리고 행간이 조금 오른다', () => {
    const settings = base({ measureCh: 50 });
    const wide = resolveReading(settings, 1920, STACK);
    const narrow = resolveReading(settings, 375, STACK);
    expect(narrow.vars[READING_CSS_VARS.measure]).toBe('100%');
    expect(narrow.layoutAttr).toBe('full');
    expect(narrow.mobileAdapted).toBe(true);
    expect(Number(narrow.vars[READING_CSS_VARS.lineHeight]))
      .toBeGreaterThan(Number(wide.vars[READING_CSS_VARS.lineHeight]));
  });

  it('임계 바로 위는 자동 변형이 걸리지 않는다', () => {
    const settings = base({ measureCh: 50 });
    expect(resolveReading(settings, READING_MOBILE_MAX_WIDTH, STACK).mobileAdapted).toBe(true);
    expect(resolveReading(settings, READING_MOBILE_MAX_WIDTH + 1, STACK).mobileAdapted).toBe(false);
  });

  it('자동 변형을 끄면 좁은 창에서도 폭 제한이 유지된다', () => {
    const r = resolveReading(base({ measureCh: 50, autoMobile: false }), 375, STACK);
    expect(r.vars[READING_CSS_VARS.measure]).toBe('50ch');
    expect(r.mobileAdapted).toBe(false);
  });

  it('행간을 올려도 상한을 넘지 않는다(모바일 가산 포함)', () => {
    const r = resolveReading(base({ lineHeight: LINE_HEIGHT_MAX }), 375, STACK);
    expect(Number(r.vars[READING_CSS_VARS.lineHeight])).toBeLessThanOrEqual(LINE_HEIGHT_MAX);
  });

  it('대화 정렬은 좁은 창에서도 유지된다(폭 제한만 풀린다)', () => {
    const settings = base({ measureCh: 50, chatAlign: true });
    expect(resolveReading(settings, 1920, STACK).chatAttr).toBe('on');
    const narrow = resolveReading(settings, 375, STACK);
    expect(narrow.chatAttr).toBe('on');
    expect(narrow.layoutAttr).toBe('full');
  });

  it('내용 폭은 읽기 폭과 무관하게 걸린다 — 글줄 제한이 없어도 상자는 좁아진다', () => {
    const r = resolveReading(base({ contentWidthPct: 70 }), 1920, STACK);
    expect(r.vars[READING_CSS_VARS.contentWidth]).toBe('70%');
    // 글줄 폭은 제한 없음 그대로 — 두 축은 서로를 덮지 않는다.
    expect(r.vars[READING_CSS_VARS.measure]).toBe('100%');
  });

  // §5.5 #17-22 ⑩-1 — 100% 는 "종전 동작"이자 **창 전체 너비**이고, 내린 값은 그대로 상자 폭이 된다.
  // (화면 쪽 짝: 대화 정렬의 52rem·44rem 고정 캡을 걷어 이 변수가 상자 폭을 단독으로 소유한다.)
  it('내용 폭 눈금은 양끝이 다 산다 — 100%=전체, 바닥까지 그대로 실린다', () => {
    const full = resolveReading(base({ contentWidthPct: CONTENT_WIDTH_MAX_PCT }), 1920, STACK);
    expect(full.vars[READING_CSS_VARS.contentWidth]).toBe('100%');
    const floor = resolveReading(base({ contentWidthPct: CONTENT_WIDTH_MIN_PCT }), 1920, STACK);
    expect(floor.vars[READING_CSS_VARS.contentWidth]).toBe('10%');
    // 대화 정렬을 켜도 폭은 같은 값이다 — 정렬은 방향만 정하고 폭은 이 축이 정한다.
    const chat = resolveReading(base({ contentWidthPct: 25, chatAlign: true }), 1920, STACK);
    expect(chat.vars[READING_CSS_VARS.contentWidth]).toBe('25%');
    expect(chat.chatAttr).toBe('on');
  });

  it('내용 폭과 읽기 폭은 함께 걸린다(직교)', () => {
    const r = resolveReading(base({ measureCh: 50, contentWidthPct: 60 }), 1920, STACK);
    expect(r.vars[READING_CSS_VARS.contentWidth]).toBe('60%');
    expect(r.vars[READING_CSS_VARS.measure]).toBe('50ch');
  });

  it('좁은 창에서는 내용 폭도 스스로 풀리고 그 사실을 알린다', () => {
    const settings = base({ contentWidthPct: 60 });
    expect(resolveReading(settings, 1920, STACK).mobileAdapted).toBe(false);
    const narrow = resolveReading(settings, 375, STACK);
    expect(narrow.vars[READING_CSS_VARS.contentWidth]).toBe('100%');
    // 폭 제한이 없는 A 안이라 종전 조건(cfg.constrained)만으로는 알릴 것이 없었지만, 내용 폭이 풀렸으므로 알린다.
    expect(narrow.mobileAdapted).toBe(true);
  });

  it('자동 변형을 끄면 좁은 창에서도 내용 폭이 유지된다', () => {
    const r = resolveReading(base({ contentWidthPct: 60, autoMobile: false }), 375, STACK);
    expect(r.vars[READING_CSS_VARS.contentWidth]).toBe('60%');
    expect(r.mobileAdapted).toBe(false);
  });

  it('글꼴 스택과 간격 값이 CSS 변수로 그대로 나간다', () => {
    const r = resolveReading(base({ letterSpacing: 0.05, wordSpacing: 0.1, paragraphSpacing: 1.2 }), 1920, STACK);
    expect(r.vars[READING_CSS_VARS.fontFamily]).toBe(STACK);
    expect(r.vars[READING_CSS_VARS.letterSpacing]).toBe('0.05em');
    expect(r.vars[READING_CSS_VARS.wordSpacing]).toBe('0.1em');
    expect(r.vars[READING_CSS_VARS.paragraphSpacing]).toBe('1.2em');
  });
});

describe('effectiveFontPx', () => {
  it('배율 1 은 본문 기준 크기 그대로다', () => {
    expect(effectiveFontPx(1)).toBe(IDE_BASE_FONT_PX);
  });
  it('연구 권장 배율은 18pt(=24px) 를 가리킨다', () => {
    expect(effectiveFontPx(RESEARCH_TEXT_ZOOM)).toBe(RESEARCH_FONT_PX);
  });
});
