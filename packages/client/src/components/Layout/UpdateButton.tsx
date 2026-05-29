import { useTranslation } from 'react-i18next';
import { useAppUpdate } from '../../hooks/useAppUpdate.js';

// SCENARIO.md §4 v2.44 — 자동 업데이트 버튼(VS Code 우상단 파란 업데이트 버튼 톤).
//
// useAppUpdate(=desktop main updaterManager push 구독)의 phase 에 따라:
//   - available    : "새 버전 vX" 정보 pill (autoDownload 라 곧 downloading 으로 전이).
//   - downloading  : "업데이트 {N}%" 진행 pill.
//   - downloaded   : "재시작하여 업데이트" 파란 액션 버튼 → 클릭 시 install()(quitAndInstall).
//   - idle/checking/up-to-date/error/null : 렌더 없음(숨김) — VS Code 처럼 할 일 있을 때만 노출.
//
// 아이콘은 이모지 금지(CLAUDE.md) — Lucide 톤 인라인 stroke SVG.

function DownloadIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function RestartIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

export function UpdateButton(): React.JSX.Element | null {
  const { t } = useTranslation();
  const { state, install } = useAppUpdate();

  if (!state) return null;
  const { phase } = state;
  if (phase !== 'available' && phase !== 'downloading' && phase !== 'downloaded') return null;

  if (phase === 'downloaded') {
    return (
      <button
        type="button"
        onClick={install}
        title={t('header.update.restartTooltip', { version: state.newVersion ?? '' })}
        className="app-nodrag flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors duration-150 hover:bg-blue-500"
      >
        <RestartIcon />
        <span>{t('header.update.restart')}</span>
      </button>
    );
  }

  const label =
    phase === 'downloading'
      ? t('header.update.downloading', { percent: state.percent ?? 0 })
      : t('header.update.available', { version: state.newVersion ?? '' });

  return (
    <div
      title={t('header.update.availableTooltip', { version: state.newVersion ?? '' })}
      className="app-nodrag flex items-center gap-1.5 rounded-md bg-blue-600/20 px-2.5 py-1 text-[11px] font-medium text-blue-300"
    >
      <DownloadIcon className={phase === 'downloading' ? 'animate-pulse' : undefined} />
      <span className="tabular-nums">{label}</span>
    </div>
  );
}
