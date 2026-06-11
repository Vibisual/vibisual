import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';

// SCENARIO.md §5.5 #17-6 (v2.73) — Header 전역 오버레이 토글.
//
// 데스크톱에 떠 있는 모든 오버레이 위젯 창을 한 번에 show/hide(`overlay:set-visible`).
// 오버레이가 하나도 없으면(=빼낸 버블 없음) 버튼 자체를 숨긴다. dev/web 모드에선 부재.
// 오버레이는 본체/다른 프로그램 포커스와 무관하게 항상 위에 떠 있고, 이 토글이 유일한 표시 스위치.

export function OverlayToggleButton(): React.JSX.Element | null {
  const { t } = useTranslation();
  const overlayAgentIds = useGraphStore((s) => s.overlayAgentIds);
  const overlaysVisible = useGraphStore((s) => s.overlaysVisible);
  const hasOverlayApi = typeof window !== 'undefined' && !!window.api?.overlay;

  const handleToggle = useCallback(() => {
    void window.api?.overlay?.setVisible(!overlaysVisible);
  }, [overlaysVisible]);

  if (!hasOverlayApi || overlayAgentIds.length === 0) return null;

  return (
    <button
      type="button"
      onClick={handleToggle}
      title={overlaysVisible
        ? t('overlay.toggleHide', { defaultValue: 'Hide desktop overlay bubbles' })
        : t('overlay.toggleShow', { defaultValue: 'Show desktop overlay bubbles' })}
      className={`app-nodrag flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium tabular-nums transition-colors ${
        overlaysVisible
          ? 'bg-violet-500/20 text-violet-200 hover:bg-violet-500/30'
          : 'text-gray-400 hover:bg-white/[0.08] hover:text-gray-200'
      }`}
    >
      {overlaysVisible ? (
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="13" height="13" rx="2" />
          <path d="M21 8v10a2 2 0 0 1-2 2H9" />
        </svg>
      ) : (
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="13" height="13" rx="2" />
          <path d="M21 8v10a2 2 0 0 1-2 2H9" />
          <line x1="3" y1="3" x2="21" y2="21" />
        </svg>
      )}
      <span>{overlayAgentIds.length}</span>
    </button>
  );
}
