import { useTranslation } from 'react-i18next';

interface ViewerStateCardProps {
  kind: 'loading' | 'empty' | 'failed';
  /** 못 연 그림의 경로(실패 때만). */
  path?: string;
  onRetry?: () => void;
}

/** §5.13 (R-9) 무대 가운데 안내 — 받는 중 · 그림 없음 · 못 엶([다시 시도]). 낮은 창에서 카드가 무대보다 크면 위가 잘리지 않게 칸이 스크롤한다. */
export function ViewerStateCard({ kind, path, onRetry }: ViewerStateCardProps): React.JSX.Element {
  const { t } = useTranslation();
  if (kind === 'loading') {
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center" role="status">
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-gray-900/90 px-3 py-2 text-[12px] text-slate-300 shadow-lg">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-500 border-t-slate-200" aria-hidden="true" />
          {t('ide.explorer.loading')}
        </div>
      </div>
    );
  }
  const failed = kind === 'failed';
  return (
    <div className="absolute inset-0 flex overflow-auto p-6 box-narrow:p-3">
      <div className="m-auto flex w-full max-w-sm flex-col items-center rounded-xl border border-white/10 bg-gray-900/95 p-5 text-center shadow-2xl">
        <span className={`mb-3 flex h-10 w-10 items-center justify-center rounded-lg ${failed ? 'bg-rose-500/10 text-rose-300' : 'bg-amber-200/10 text-amber-200/80'}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
            {failed && <path d="m15 3 6 6M21 3l-6 6" />}
          </svg>
        </span>
        <p className="mb-1.5 text-sm font-semibold text-slate-100">
          {failed ? t('panel.apps.vibimage.loadFailed') : t('panel.apps.vibimage.empty')}
        </p>
        {/* 못 읽은 그림의 경로는 끊을 자리가 없는 긴 낱말이다 — 넘칠 때만 아무 데서나 끊는다(안내 문장은 낱말 그대로). */}
        <p className="text-[12px] leading-relaxed text-slate-400 wrap-anywhere">
          {failed ? (path ?? '') : t('panel.apps.vibimage.emptyHint')}
        </p>
        {failed && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 flex h-8 items-center gap-1.5 rounded-md border border-white/15 px-3 text-[12px] font-semibold text-slate-200 transition-colors hover:bg-white/10 pointer-coarse:h-10"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.6-6.4L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
            {t('panel.apps.vibimage.retry')}
          </button>
        )}
      </div>
    </div>
  );
}
