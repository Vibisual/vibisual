import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../../stores/graphStore.js';
import { ReadingRow, ReadingSegmented, ReadingSelect, ReadingTextField, type SegmentedOption } from './ReadingControls.js';
import { READING_FONTS, isFontFamilyAvailable, queryLocalFontFamilies } from './readingFonts.js';
import {
  DEFAULT_READING_SETTINGS, READING_FONT_SOURCES, sanitizeFontFamily,
  type ReadingFontSource,
} from './readingModel.js';

const CHIP_CLASS: Record<'ok' | 'missing' | 'unknown', string> = {
  ok: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300',
  missing: 'border-amber-500/50 bg-amber-500/10 text-amber-300',
  unknown: 'border-gray-600 bg-gray-700/40 text-gray-400',
};

interface ReadingFontRowProps {
  /** 동봉하지 않은 제공 글꼴의 설치 여부(동봉분은 항상 true). */
  fontAvailability: Record<string, boolean>;
}

/**
 * §5.5 #17-22 — 글꼴 축 한 줄. 제공 / 커스텀을 가르는 것은 라이선스 경계 때문 — 제공은 동봉한 OFL 1.1(상업 사용 허용) 글꼴,
 * 커스텀은 사용자 컴퓨터에 이미 있는 글꼴을 그 화면에서만 쓴다(나눠 주는 것 없음).
 */
export function ReadingFontRow({ fontAvailability }: ReadingFontRowProps): React.JSX.Element {
  const { t } = useTranslation();
  const reading = useGraphStore((s) => s.ideReading);
  const setIdeReading = useGraphStore((s) => s.setIdeReading);

  // 시스템 글꼴 목록은 **사용자가 누를 때만** 불러온다 — `queryLocalFonts` 는 권한창을 띄우므로
  //   패널을 열었을 뿐인데 권한을 묻는 일이 없어야 한다. 못 불러와도 직접 입력 경로는 그대로다.
  const [localFonts, setLocalFonts] = useState<readonly string[]>([]);
  const [localFontsAsked, setLocalFontsAsked] = useState(false);
  const loadLocalFonts = useCallback(() => {
    setLocalFontsAsked(true);
    void queryLocalFontFamilies().then(setLocalFonts);
  }, []);

  const sourceOptions = useMemo<SegmentedOption<ReadingFontSource>[]>(
    () => READING_FONT_SOURCES.map((id) => ({
      id,
      label: t(`ide.reading.fontSource.${id}`),
      title: t(`ide.reading.fontSourceNote.${id}`),
    })),
    [t],
  );

  const fontOptions = useMemo<SegmentedOption<string>[]>(
    () => READING_FONTS.map((f) => {
      const missing = fontAvailability[f.id] === false;
      return {
        id: f.id,
        label: f.researchBacked ? `${f.label} — ${t('ide.reading.fontResearch')}` : f.label,
        ...(missing ? { disabledReason: t('ide.reading.fontMissing') } : {}),
      };
    }),
    [fontAvailability, t],
  );

  const custom = reading.fontSource === 'custom';
  const cleanCustom = sanitizeFontFamily(reading.customFontFamily);
  const available = custom ? isFontFamilyAvailable(cleanCustom) : null;
  const chip: 'ok' | 'missing' | 'unknown' =
    available === true ? 'ok' : available === false ? 'missing' : 'unknown';

  const isDefault =
    reading.fontSource === DEFAULT_READING_SETTINGS.fontSource
    && reading.fontId === DEFAULT_READING_SETTINGS.fontId
    && reading.customFontFamily === DEFAULT_READING_SETTINGS.customFontFamily;

  return (
    <ReadingRow
      label={t('ide.reading.font')}
      note={t(`ide.reading.fontSourceNote.${reading.fontSource}`)}
      onReset={() => setIdeReading({
        fontSource: DEFAULT_READING_SETTINGS.fontSource,
        fontId: DEFAULT_READING_SETTINGS.fontId,
        customFontFamily: DEFAULT_READING_SETTINGS.customFontFamily,
      })}
      isDefault={isDefault}
    >
      <ReadingSegmented
        value={reading.fontSource}
        options={sourceOptions}
        onChange={(fontSource) => setIdeReading({ fontSource })}
      />

      {custom ? (
        <>
          <ReadingTextField
            label={t('ide.reading.customFont')}
            value={reading.customFontFamily}
            placeholder={t('ide.reading.customFontPlaceholder')}
            onChange={(customFontFamily) => setIdeReading({ customFontFamily })}
            suggestions={localFonts}
            action={{
              label: t('ide.reading.customFontBrowse'),
              title: t('ide.reading.customFontBrowseHint'),
              onClick: loadLocalFonts,
              disabled: localFonts.length > 0,
            }}
          />
          <div className={`rounded border px-2 py-1 text-[12px] leading-relaxed ${CHIP_CLASS[chip]}`}>
            {!cleanCustom
              ? t('ide.reading.customFontEmpty')
              : available === true
                ? t('ide.reading.customFontFound', { name: cleanCustom })
                : available === false
                  ? t('ide.reading.customFontNotFound', { name: cleanCustom })
                  : t('ide.reading.customFontUnknown', { name: cleanCustom })}
            {localFontsAsked && localFonts.length === 0
              ? ` · ${t('ide.reading.customFontBrowseUnavailable')}`
              : ''}
          </div>
        </>
      ) : (
        <ReadingSelect
          label={t('ide.reading.font')}
          value={reading.fontId}
          options={fontOptions}
          onChange={(fontId) => setIdeReading({ fontId })}
        />
      )}
    </ReadingRow>
  );
}
