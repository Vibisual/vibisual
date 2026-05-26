import { useTranslation } from 'react-i18next';

interface StubProjectPlaceholderProps {
  projectName: string;
  hydrating: boolean;
  onLoad: () => void;
}

export function StubProjectPlaceholder({ projectName, hydrating, onLoad }: StubProjectPlaceholderProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 text-center">
      {hydrating ? (
        <>
          <span className="h-8 w-8 animate-pulse rounded-full bg-gray-700" />
          <p className="text-sm text-gray-500">{t('header.tab.unloadedProject')}…</p>
        </>
      ) : (
        <>
          <svg
            className="h-10 w-10 text-gray-700"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <p className="max-w-xs text-sm text-gray-500">{t('canvas.stubPlaceholder')}</p>
          <button
            type="button"
            onClick={onLoad}
            className="rounded-md border border-white/[0.08] bg-white/[0.04] px-4 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            {t('header.tab.clickToLoad')} — {projectName}
          </button>
        </>
      )}
    </div>
  );
}
