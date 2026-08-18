import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { STREAM_DENSITIES, type StreamDensity } from '@vibisual/shared';
import { useGraphStore } from '../../../stores/graphStore.js';
import { ReadingRow, ReadingSegmented, ReadingSlider, ReadingToggle, type SegmentedOption } from './ReadingControls.js';
import { ReadingFontRow } from './ReadingFontRow.js';
import {
  DEFAULT_READING_SETTINGS, DEFAULT_IDE_STREAM_DENSITY, DEFAULT_IDE_TEXT_ZOOM,
  LINE_HEIGHT_MIN, LINE_HEIGHT_MAX, LINE_HEIGHT_WCAG, LINE_HEIGHT_DEFAULT,
  LETTER_SPACING_MIN, LETTER_SPACING_MAX,
  WORD_SPACING_MIN, WORD_SPACING_MAX,
  PARAGRAPH_SPACING_MIN, PARAGRAPH_SPACING_MAX,
  RESEARCH_TEXT_ZOOM, RESEARCH_FONT_PX, effectiveFontPx,
} from './readingModel.js';

const TEXT_ZOOM_MIN = 0.6;
const TEXT_ZOOM_MAX = 2.4;
const EM_STEP = 0.005;

/**
 * 소수 축(행간·자간·em)은 슬라이더를 오가며 부동소수 오차가 붙을 수 있어 `===` 로 기본값 판정을 하면
 * 되돌리기 버튼이 영영 켜져 있게 된다 — 가장 작은 눈금의 절반 안이면 같은 값으로 본다.
 */
function atDefault(value: number, base: number, step: number): boolean {
  return Math.abs(value - base) < step / 2;
}

interface ReadingTypeSectionProps {
  /** 글꼴 설치 여부 — 없는 글꼴을 고르면 조용히 폴백되므로 그 사실을 목록에 그대로 적는다. */
  fontAvailability: Record<string, boolean>;
}

/** 글자 크기·행간·자간·어간·문단 간격·글꼴·밀도·모바일 자동 변형. */
export function ReadingTypeSection({ fontAvailability }: ReadingTypeSectionProps): React.JSX.Element {
  const { t } = useTranslation();
  const reading = useGraphStore((s) => s.ideReading);
  const setIdeReading = useGraphStore((s) => s.setIdeReading);
  // 글자 크기와 밀도는 이미 있는 축을 그대로 쓴다(중복 상태 금지 — Ctrl+휠·하단 토글과 같은 값).
  const textZoom = useGraphStore((s) => s.ideTextZoom);
  const setIdeTextZoom = useGraphStore((s) => s.setIdeTextZoom);
  const density = useGraphStore((s) => s.ideStreamDensity);
  const setIdeStreamDensity = useGraphStore((s) => s.setIdeStreamDensity);

  const densityOptions = useMemo<SegmentedOption<StreamDensity>[]>(
    () => STREAM_DENSITIES.map((d) => ({ id: d, label: t(`ide.density.${d}`) })),
    [t],
  );

  return (
    <>
      <ReadingRow
        label={t('ide.reading.fontSize')}
        value={`${effectiveFontPx(textZoom)}px`}
        note={t('ide.reading.fontSizeNote', { px: RESEARCH_FONT_PX })}
        onReset={() => setIdeTextZoom(DEFAULT_IDE_TEXT_ZOOM)}
        isDefault={atDefault(textZoom, DEFAULT_IDE_TEXT_ZOOM, 0.05)}
      >
        <ReadingSlider
          label={t('ide.reading.fontSize')}
          value={textZoom}
          min={TEXT_ZOOM_MIN}
          max={TEXT_ZOOM_MAX}
          step={0.05}
          onChange={setIdeTextZoom}
          recommend={{ value: RESEARCH_TEXT_ZOOM, label: `${RESEARCH_FONT_PX}px` }}
        />
      </ReadingRow>

      <ReadingRow
        label={t('ide.reading.lineHeight')}
        value={reading.lineHeight.toFixed(2)}
        note={t('ide.reading.lineHeightNote', { cjk: LINE_HEIGHT_DEFAULT, wcag: LINE_HEIGHT_WCAG })}
        onReset={() => setIdeReading({ lineHeight: DEFAULT_READING_SETTINGS.lineHeight })}
        isDefault={atDefault(reading.lineHeight, DEFAULT_READING_SETTINGS.lineHeight, 0.05)}
      >
        <ReadingSlider
          label={t('ide.reading.lineHeight')}
          value={reading.lineHeight}
          min={LINE_HEIGHT_MIN}
          max={LINE_HEIGHT_MAX}
          step={0.05}
          onChange={(lineHeight) => setIdeReading({ lineHeight })}
          recommend={{ value: LINE_HEIGHT_DEFAULT, label: String(LINE_HEIGHT_DEFAULT) }}
        />
      </ReadingRow>

      <ReadingRow
        label={t('ide.reading.letterSpacing')}
        value={`${reading.letterSpacing.toFixed(3)}em`}
        note={t('ide.reading.letterSpacingNote', { max: LETTER_SPACING_MAX })}
        onReset={() => setIdeReading({ letterSpacing: DEFAULT_READING_SETTINGS.letterSpacing })}
        isDefault={atDefault(reading.letterSpacing, DEFAULT_READING_SETTINGS.letterSpacing, EM_STEP)}
      >
        <ReadingSlider
          label={t('ide.reading.letterSpacing')}
          value={reading.letterSpacing}
          min={LETTER_SPACING_MIN}
          max={LETTER_SPACING_MAX}
          step={EM_STEP}
          onChange={(letterSpacing) => setIdeReading({ letterSpacing })}
        />
      </ReadingRow>

      <ReadingRow
        label={t('ide.reading.wordSpacing')}
        value={`${reading.wordSpacing.toFixed(3)}em`}
        note={t('ide.reading.wordSpacingNote', { max: WORD_SPACING_MAX })}
        onReset={() => setIdeReading({ wordSpacing: DEFAULT_READING_SETTINGS.wordSpacing })}
        isDefault={atDefault(reading.wordSpacing, DEFAULT_READING_SETTINGS.wordSpacing, EM_STEP)}
      >
        <ReadingSlider
          label={t('ide.reading.wordSpacing')}
          value={reading.wordSpacing}
          min={WORD_SPACING_MIN}
          max={WORD_SPACING_MAX}
          step={EM_STEP}
          onChange={(wordSpacing) => setIdeReading({ wordSpacing })}
        />
      </ReadingRow>

      <ReadingRow
        label={t('ide.reading.paragraphSpacing')}
        value={`${reading.paragraphSpacing.toFixed(2)}em`}
        note={t('ide.reading.paragraphSpacingNote')}
        onReset={() => setIdeReading({ paragraphSpacing: DEFAULT_READING_SETTINGS.paragraphSpacing })}
        isDefault={atDefault(reading.paragraphSpacing, DEFAULT_READING_SETTINGS.paragraphSpacing, 0.05)}
      >
        <ReadingSlider
          label={t('ide.reading.paragraphSpacing')}
          value={reading.paragraphSpacing}
          min={PARAGRAPH_SPACING_MIN}
          max={PARAGRAPH_SPACING_MAX}
          step={0.05}
          onChange={(paragraphSpacing) => setIdeReading({ paragraphSpacing })}
        />
      </ReadingRow>

      {/* 글꼴 축은 출처(제공/커스텀)에 따라 컨트롤이 갈려 자체 컴포넌트가 맡는다. */}
      <ReadingFontRow fontAvailability={fontAvailability} />

      <ReadingRow
        label={t('ide.density.label')}
        onReset={() => setIdeStreamDensity(DEFAULT_IDE_STREAM_DENSITY)}
        isDefault={density === DEFAULT_IDE_STREAM_DENSITY}
      >
        <ReadingSegmented value={density} options={densityOptions} onChange={setIdeStreamDensity} />
      </ReadingRow>

      <ReadingRow
        label={t('ide.reading.autoMobile')}
        note={t('ide.reading.autoMobileNote')}
        onReset={() => setIdeReading({ autoMobile: DEFAULT_READING_SETTINGS.autoMobile })}
        isDefault={reading.autoMobile === DEFAULT_READING_SETTINGS.autoMobile}
      >
        <ReadingToggle
          label={t('ide.reading.autoMobileOn')}
          checked={reading.autoMobile}
          onChange={(autoMobile) => setIdeReading({ autoMobile })}
        />
      </ReadingRow>
    </>
  );
}
