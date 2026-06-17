import { memo } from 'react';
import { useTranslation } from 'react-i18next';

// SCENARIO.md §5.5 #17-6 (G) — 데스크톱 오버레이 버블(접힘 상태) 우클릭 컨텍스트 메뉴.
//
// 항목: IDE 열기 / 본체에서 이 버블로 점프 / 불투명도(30~100% 슬라이더) / 숨기기(이 버블만) / 닫기(제거).
// (v2.87) 메뉴는 커서 위치의 **독립 팝업 창**(`OverlayMenuShell`)이 띄운다 — 280×320 버블 창 안에
// 갇혀 커서 아래에 못 열리고 하단 항목이 잘려 클릭 안 되던 문제 해소. 이 컴포넌트는 **표현 전용**:
// 위치·외부클릭·Esc·실제 IPC 는 셸/메인이 담당하고, 여기선 메뉴 박스를 그리고 콜백만 호출한다.

// 슬라이더 범위 — 너무 투명하면 버블이 안 보이므로 하한 30%.
const OPACITY_MIN = 30;
const OPACITY_MAX = 100;

interface OverlayBubbleContextMenuProps {
  /** 현재 불투명도(슬라이더 표시용, 0~1). */
  opacity: number;
  onOpenIDE: () => void;
  onReveal: () => void;
  onSetOpacity: (opacity: number) => void;
  onHide: () => void;
  onCloseOverlay: () => void;
}

export const OverlayBubbleContextMenu = memo(function OverlayBubbleContextMenu({
  opacity,
  onOpenIDE,
  onReveal,
  onSetOpacity,
  onHide,
  onCloseOverlay,
}: OverlayBubbleContextMenuProps): React.JSX.Element {
  const { t } = useTranslation();

  const itemClass =
    'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-gray-200 hover:bg-gray-800 transition-colors';

  return (
    <div className="min-w-44 rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-xl shadow-black/50">
      {/* IDE 열기 */}
      <button type="button" className={itemClass} onClick={onOpenIDE}>
        <svg className="h-4 w-4 shrink-0 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 3h6v6" />
          <path d="M9 21H3v-6" />
          <path d="M21 3l-7 7" />
          <path d="M3 21l7-7" />
        </svg>
        <span>{t('overlay.menu.openIde', { defaultValue: 'Open IDE' })}</span>
      </button>

      {/* 본체에서 이 버블로 점프 */}
      <button type="button" className={itemClass} onClick={onReveal}>
        <svg className="h-4 w-4 shrink-0 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="7" />
          <line x1="12" y1="2" x2="12" y2="5" />
          <line x1="12" y1="19" x2="12" y2="22" />
          <line x1="2" y1="12" x2="5" y2="12" />
          <line x1="19" y1="12" x2="22" y2="12" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
        </svg>
        <span>{t('overlay.menu.reveal', { defaultValue: 'Find on canvas' })}</span>
      </button>

      <div className="mx-2 my-1 border-t border-gray-700" />

      {/* 불투명도 슬라이더 */}
      <div className="px-2.5 py-1.5">
        <div className="mb-1.5 flex items-center gap-2 text-[11px] text-gray-400">
          <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3.5C12 3.5 5.5 10 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10 12 3.5 12 3.5z" />
            <path d="M12 18.5a4 4 0 0 1-4-4" />
          </svg>
          <span>{t('overlay.menu.opacity', { defaultValue: 'Opacity' })}</span>
          <span className="ml-auto tabular-nums text-gray-300">{Math.round(opacity * 100)}%</span>
        </div>
        <input
          type="range"
          min={OPACITY_MIN}
          max={OPACITY_MAX}
          step={5}
          value={Math.round(opacity * 100)}
          onChange={(e) => onSetOpacity(Number(e.target.value) / 100)}
          className="w-full cursor-pointer accent-violet-400"
        />
      </div>

      <div className="mx-2 my-1 border-t border-gray-700" />

      {/* 숨기기(이 버블만) */}
      <button type="button" className={itemClass} onClick={onHide}>
        <svg className="h-4 w-4 shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c5 0 9 5 9 8a11.5 11.5 0 0 1-1.7 2.6" />
          <path d="M6.6 6.6C4.1 8.1 2.5 10.6 2.5 12c0 1.6 1.5 4.1 4.1 5.6A8.7 8.7 0 0 0 12 19c1 0 2-.2 2.9-.5" />
          <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
          <line x1="3" y1="3" x2="21" y2="21" />
        </svg>
        <span>{t('overlay.menu.hide', { defaultValue: 'Hide this bubble' })}</span>
      </button>

      {/* 닫기(오버레이에서 제거) */}
      <button type="button" className={`${itemClass} text-rose-300 hover:bg-rose-500/15`} onClick={onCloseOverlay}>
        <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
        <span>{t('overlay.menu.close', { defaultValue: 'Remove from overlay' })}</span>
      </button>
    </div>
  );
});
