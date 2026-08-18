import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollFade } from '../../ScrollFade.js';
import { useGraphStore } from '../../../stores/graphStore.js';
import { useOutsidePressDismiss } from '../../../hooks/usePopupDismiss.js';
import { ReadingWidthSection } from './ReadingWidthSection.js';
import { ReadingTypeSection } from './ReadingTypeSection.js';

/** 패널 본문 최대 높이(px) — 창이 작아도 헤더 아래에서 넘치지 않는 선. */
const PANEL_MAX_HEIGHT = 420;

interface ReadingSettingsPopoverProps {
  onClose: () => void;
  /** 좁은 화면 자동 변형이 지금 걸려 있는가(패널이 그 사실을 사용자에게 알린다). */
  mobileAdapted: boolean;
  fontAvailability: Record<string, boolean>;
}

/**
 * §5.5 — IDE 상단 바 [읽기] 패널.
 *
 * 초광폭 창에서 한 줄이 100자를 넘어 읽기 어렵다는 문제를 사용자가 직접 조절해 푸는 자리다.
 * 각 항목에 근거 한 줄을 달아 두는 이유는 값 자체가 취향이 아니라 **연구에서 온 것**이기 때문이고,
 * 고정값을 강제하지 않고 고르게 하는 이유는 개인화된 읽기 설정이 고정값보다 읽기 속도를 실제로
 * 올린다는 결과(Readability Consortium)가 있기 때문이다.
 */
export function ReadingSettingsPopover({
  onClose, mobileAdapted, fontAvailability,
}: ReadingSettingsPopoverProps): React.JSX.Element {
  const { t } = useTranslation();
  const resetIdeReading = useGraphStore((s) => s.resetIdeReading);
  const panelRef = useRef<HTMLDivElement>(null);

  // 바깥 press 로 닫기(공통 규약). 캡처 단계에서 듣지 않는 이유는 패널 내부 클릭이 먼저 처리돼야 하기 때문.
  useOutsidePressDismiss({ onDismiss: onClose, refs: [panelRef], capture: false });

  // Esc 로 닫기
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      // 상단 바는 창 드래그 영역이라(app-drag) 패널은 반드시 app-nodrag 로 빠져나온다.
      className="app-nodrag absolute right-0 top-full z-50 mt-1 w-80 max-md:w-[calc(100vw-1rem)] overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-2xl shadow-black/60"
      onMouseDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={t('ide.reading.title')}
    >
      <div className="flex items-center justify-between border-b border-gray-700 px-3 py-2">
        <span className="text-[11.5px] font-semibold text-gray-200">{t('ide.reading.title')}</span>
        <button
          type="button"
          onClick={resetIdeReading}
          className="rounded border border-gray-700 px-1.5 py-0.5 text-[10px] text-gray-400 transition-colors hover:border-gray-600 hover:text-gray-200"
        >
          {t('ide.reading.reset')}
        </button>
      </div>

      {mobileAdapted ? (
        <div className="border-b border-gray-700 bg-amber-500/10 px-3 py-1.5 text-[10px] leading-relaxed text-amber-300">
          {t('ide.reading.mobileActive')}
        </div>
      ) : null}

      <ScrollFade maxHeight={PANEL_MAX_HEIGHT}>
        <div className="flex flex-col">
          <ReadingWidthSection />
          <ReadingTypeSection fontAvailability={fontAvailability} />
        </div>
      </ScrollFade>

      <p className="border-t border-gray-700 px-3 py-2 text-[10px] leading-relaxed text-gray-500">
        {t('ide.reading.rationale')}
      </p>
    </div>
  );
}
