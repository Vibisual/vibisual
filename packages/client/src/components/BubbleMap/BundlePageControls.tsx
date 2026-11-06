import { useTranslation } from 'react-i18next';
import { bundlePageWindow } from '../../utils/bundlePages.js';

export function BundlePageControls({ page, count, onChange }: { page: number; count: number; onChange: (page: number) => void }): React.JSX.Element | null {
  const { t } = useTranslation();
  const win = bundlePageWindow(count, page);
  if (win.pages <= 1) return null;
  return (
    <div className="nodrag nopan absolute bottom-4 left-1/2 z-30 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-gray-700 bg-gray-900/95 px-2 py-1.5 text-[12px] text-gray-200 shadow-lg"
      onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button type="button" disabled={win.page === 0} onClick={() => onChange(win.page - 1)} aria-label={t('canvas.bundle.previousPage')}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-gray-700 disabled:opacity-30 pointer-coarse:h-9 pointer-coarse:w-9">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
      </button>
      <span className="min-w-0 truncate tabular-nums">{t('canvas.bundle.page', { page: win.page + 1, pages: win.pages, count })}</span>
      <button type="button" disabled={win.page + 1 >= win.pages} onClick={() => onChange(win.page + 1)} aria-label={t('canvas.bundle.nextPage')}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-gray-700 disabled:opacity-30 pointer-coarse:h-9 pointer-coarse:w-9">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
      </button>
    </div>
  );
}
