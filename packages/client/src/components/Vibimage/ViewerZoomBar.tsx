import { useTranslation } from 'react-i18next';
import { ImageToolbarButton, ImageToolbarDivider } from '../IDE/ImageToolbarButton.js';

interface ViewerZoomBarProps {
  /** 그림 크기를 아는가 — 모르면 배율 단추는 할 일이 없다. */
  ready: boolean;
  percent: number;
  fitted: boolean;
  actualSize: boolean;
  checker: boolean;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFit: () => void;
  onActualSize: () => void;
  onToggleChecker: () => void;
}

const GLYPH = {
  className: 'h-4 w-4',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '1.8',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** §5.13 (R-9) 보기 막대 — 무대 아래 가운데에 떠 있고, 빠른 편집(§5.5 #17-25) 도구 막대와 같은 단추·글리프·유리면을 쓴다. */
export function ViewerZoomBar(p: ViewerZoomBarProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div
      role="toolbar"
      aria-label={t('panel.apps.vibimage.viewControls')}
      className="pointer-events-auto flex max-w-full items-center gap-1 rounded-xl border border-gray-700 bg-gray-900/95 px-2 py-1.5 shadow-2xl backdrop-blur-[10px]"
    >
      <ImageToolbarButton label={t('panel.apps.vibimage.zoomOut')} disabled={!p.ready} onClick={p.onZoomOut}>
        <svg {...GLYPH}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5M7.5 10.5h6" /></svg>
      </ImageToolbarButton>
      <output className="w-12 shrink-0 text-center text-[12px] tabular-nums text-gray-300" aria-live="polite">
        {p.ready ? `${p.percent}%` : ''}
      </output>
      <ImageToolbarButton label={t('panel.apps.vibimage.zoomIn')} disabled={!p.ready} onClick={p.onZoomIn}>
        <svg {...GLYPH}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5M7.5 10.5h6M10.5 7.5v6" /></svg>
      </ImageToolbarButton>
      <ImageToolbarDivider />
      <ImageToolbarButton label={t('panel.apps.vibimage.fit')} active={p.fitted} disabled={!p.ready} onClick={p.onFit}>
        <svg {...GLYPH}><path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" /></svg>
      </ImageToolbarButton>
      <ImageToolbarButton label={t('panel.apps.vibimage.actualSize')} active={p.actualSize} disabled={!p.ready} onClick={p.onActualSize}>
        <span className="text-[12px] font-semibold tabular-nums" aria-hidden="true">1:1</span>
      </ImageToolbarButton>
      <ImageToolbarDivider />
      <ImageToolbarButton label={t('panel.apps.vibimage.transparency')} active={p.checker} onClick={p.onToggleChecker}>
        <svg {...GLYPH}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 3h9v9H3zM12 12h9v9h-9z" fill="currentColor" stroke="none" opacity="0.35" />
        </svg>
      </ImageToolbarButton>
    </div>
  );
}
