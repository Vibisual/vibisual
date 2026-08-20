import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../../stores/graphStore.js';
import { ReadingRow, ReadingSegmented, ReadingSlider, ReadingToggle, type SegmentedOption } from './ReadingControls.js';
import {
  DEFAULT_READING_SETTINGS,
  READING_MEASURE_PRESETS,
  MEASURE_MIN_CH, MEASURE_MAX_CH, MEASURE_UNLIMITED,
  CONTENT_WIDTH_MIN_PCT, CONTENT_WIDTH_MAX_PCT,
  WCAG_MAX_CPL_CJK, estimateCharsPerLine, judgeMeasure,
  type ReadingMeasurePresetId,
} from './readingModel.js';

const VERDICT_CLASS: Record<string, string> = {
  ok: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300',
  warn: 'border-amber-500/50 bg-amber-500/10 text-amber-300',
  over: 'border-gray-600 bg-gray-700/40 text-gray-400',
};

/**
 * 읽기 폭 + 대화 정렬 + 내용 폭. 계측·판정을 함께 보여줘 사용자가 숫자를 보고 고르게 한다.
 * 폭 안(A~D) 줄은 ② v5.04 에서 걷어냈다 — "제한이 걸렸는가"는 읽기 폭 값이 이미 말한다.
 */
export function ReadingWidthSection(): React.JSX.Element {
  const { t } = useTranslation();
  const reading = useGraphStore((s) => s.ideReading);
  const setIdeReading = useGraphStore((s) => s.setIdeReading);

  const presetOptions = useMemo<SegmentedOption<ReadingMeasurePresetId>[]>(
    () => READING_MEASURE_PRESETS.map((p) => ({
      id: p.id,
      label: t(`ide.reading.measurePreset.${p.id}`),
    })),
    [t],
  );

  const activePreset = READING_MEASURE_PRESETS.find((p) => p.ch === reading.measureCh)?.id;
  const est = estimateCharsPerLine(reading.measureCh);
  // 제한이 없으면 judgeMeasure 가 스스로 'over'(= 폭 제한 없음)를 낸다 — 바깥에서 다시 갈래를 타지 않는다.
  const verdict = judgeMeasure(reading.measureCh);

  return (
    <>
      {/* §5.5 #17-22 ② (v5.04) — 폭 축은 이 한 줄뿐이다. 종전 [폭 방식] 이 있던 자리를 그대로 잇는다:
          [전체] 프리셋이 옛 `full` 안을 대신하므로 조건부로 감추지 않는다 — 감추면 "제한 없음"에서
          다시 좁힐 길이 사라진다. */}
      <ReadingRow
        label={t('ide.reading.measureTitle')}
        value={reading.measureCh === MEASURE_UNLIMITED
          ? t('ide.reading.measurePreset.full')
          : `${reading.measureCh}ch`}
        note={t('ide.reading.measureNote')}
        onReset={() => setIdeReading({ measureCh: DEFAULT_READING_SETTINGS.measureCh })}
        isDefault={reading.measureCh === DEFAULT_READING_SETTINGS.measureCh}
      >
        <ReadingSegmented
          value={activePreset}
          options={presetOptions}
          onChange={(id) => {
            const preset = READING_MEASURE_PRESETS.find((p) => p.id === id);
            if (preset) setIdeReading({ measureCh: preset.ch });
          }}
        />
        <ReadingSlider
          label={t('ide.reading.measureTitle')}
          value={reading.measureCh === MEASURE_UNLIMITED ? MEASURE_MAX_CH : reading.measureCh}
          min={MEASURE_MIN_CH}
          max={MEASURE_MAX_CH}
          step={1}
          onChange={(measureCh) => setIdeReading({ measureCh })}
        />
        <div className={`rounded border px-2 py-1 text-[12px] leading-relaxed ${VERDICT_CLASS[verdict]}`}>
          {est
            ? t('ide.reading.charsPerLine', { cjk: est.cjk, latin: est.latin })
            : t('ide.reading.charsUnlimited')}
          {' · '}
          {t(`ide.reading.verdict.${verdict}`, { limit: WCAG_MAX_CPL_CJK })}
        </div>
      </ReadingRow>

      {/* §5.5 #17-22 ⑨ — 폭과 같은 "자리" 축이라 폭 줄 바로 아래에 둔다(사용자가 가리킨 지점). */}
      <ReadingRow
        label={t('ide.reading.chatAlign')}
        note={t('ide.reading.chatAlignNote')}
        onReset={() => setIdeReading({ chatAlign: DEFAULT_READING_SETTINGS.chatAlign })}
        isDefault={reading.chatAlign === DEFAULT_READING_SETTINGS.chatAlign}
      >
        <ReadingToggle
          label={t('ide.reading.chatAlignOn')}
          checked={reading.chatAlign}
          onChange={(chatAlign) => setIdeReading({ chatAlign })}
        />
      </ReadingRow>

      {/* §5.5 #17-22 ⑩ — 바깥 상자 축. 읽기 폭과 무관하게 **항상** 노출한다:
          글줄 제한을 안 걸어도 "상자는 좁히고 싶다"가 성립하기 때문이다. */}
      <ReadingRow
        label={t('ide.reading.contentWidth')}
        value={reading.contentWidthPct >= CONTENT_WIDTH_MAX_PCT
          ? t('ide.reading.contentWidthFull')
          : `${reading.contentWidthPct}%`}
        note={t('ide.reading.contentWidthNote')}
        onReset={() => setIdeReading({ contentWidthPct: DEFAULT_READING_SETTINGS.contentWidthPct })}
        isDefault={reading.contentWidthPct === DEFAULT_READING_SETTINGS.contentWidthPct}
      >
        <ReadingSlider
          label={t('ide.reading.contentWidth')}
          value={reading.contentWidthPct}
          min={CONTENT_WIDTH_MIN_PCT}
          max={CONTENT_WIDTH_MAX_PCT}
          step={1}
          onChange={(contentWidthPct) => setIdeReading({ contentWidthPct })}
        />
      </ReadingRow>

    </>
  );
}
