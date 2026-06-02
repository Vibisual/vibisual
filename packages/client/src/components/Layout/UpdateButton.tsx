import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAppUpdate } from '../../hooks/useAppUpdate.js';

// SCENARIO.md §4 v2.44 / v2.63 — 자동 업데이트 버튼(VS Code 우상단 파란 업데이트 버튼 톤).
//
// useAppUpdate(=desktop main updaterManager push 구독)의 phase 에 따라:
//   - available    : "새 버전 vX" 정보 pill (autoDownload 라 곧 downloading 으로 전이).
//   - downloading  : "업데이트 {N}%" 진행 pill.
//   - downloaded   : "재시작하여 업데이트" 파란 액션 버튼 → 클릭 시 **확인 모달**(v2.63) →
//                    사용자가 확인하면 install()(quitAndInstall). 즉시 재설치 ❌ — 진행 중
//                    작업·미저장 변경 손실 우려를 재시작 직전에 명시 경고(§3.2.1 인프라 위 안전망).
//   - idle/checking/up-to-date/error/null : 렌더 없음(숨김) — VS Code 처럼 할 일 있을 때만 노출.
//
// 아이콘은 이모지 금지(CLAUDE.md) — Lucide 톤 인라인 stroke SVG.

const CONFIRM_Z = 100_500;

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

function WarningIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

/**
 * §4 v2.63 — 업데이트 재시작 전 손실 경고 확인 모달.
 * "재시작하여 업데이트" 클릭 시 즉시 install() 하지 않고 이 모달로 한 번 더 확인받는다.
 * 진행 중 작업·미저장 변경 손실 우려를 명시 경고(§3.2.1 인프라 위 사용자 안전망).
 */
function UpdateConfirmModal({
  version,
  onCancel,
  onConfirm,
}: {
  version: string;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  return createPortal(
    <>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-[1px]"
        style={{ zIndex: CONFIRM_Z - 1 }}
        onClick={onCancel}
      />
      <div
        className="pointer-events-none fixed inset-0 flex items-center justify-center"
        style={{ zIndex: CONFIRM_Z }}
      >
        <div
          className="pointer-events-auto flex w-[480px] max-w-[92vw] flex-col rounded-lg border-2 border-amber-500/70 bg-gray-900 shadow-2xl"
          style={{ boxShadow: '0 0 0 1px rgba(245,158,11,0.25), 0 25px 50px -12px rgba(0,0,0,0.8), 0 0 32px -4px rgba(245,158,11,0.35)' }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-gray-700 px-4 py-3">
            <WarningIcon className="h-5 w-5 text-amber-400" />
            <h3 className="flex-1 text-sm font-bold text-gray-100">
              {t('header.update.confirmTitle', { defaultValue: 'Restart to update?' })}
            </h3>
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-300">
              {version}
            </span>
          </div>

          {/* Body */}
          <div className="flex flex-col gap-2 px-4 py-3 text-[12px] leading-relaxed text-gray-300">
            <p>
              {t('header.update.confirmBody', {
                defaultValue: 'Updating will close and reinstall the app. Any in-progress agent work or unsaved changes may be lost.',
              })}
            </p>
            <p className="text-amber-200">
              {t('header.update.confirmHint', {
                defaultValue: 'If you have important custom agent work, finish it first, then update.',
              })}
            </p>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-gray-700 px-4 py-3">
            <button
              type="button"
              onClick={onCancel}
              className="rounded border border-gray-700 px-4 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-800"
            >
              {t('header.update.confirmCancel', { defaultValue: 'Cancel' })}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="flex items-center gap-1.5 rounded bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white shadow-md transition-all duration-100 ease-out hover:bg-blue-500 hover:shadow-lg active:scale-95"
            >
              <RestartIcon />
              <span>{t('header.update.restart')}</span>
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

export function UpdateButton(): React.JSX.Element | null {
  const { t } = useTranslation();
  const { state, install } = useAppUpdate();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!state) return null;
  const { phase } = state;
  if (phase !== 'available' && phase !== 'downloading' && phase !== 'downloaded') return null;

  if (phase === 'downloaded') {
    return (
      <>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          title={t('header.update.restartTooltip', { version: state.newVersion ?? '' })}
          className="app-nodrag flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors duration-150 hover:bg-blue-500"
        >
          <RestartIcon />
          <span>{t('header.update.restart')}</span>
        </button>
        {confirmOpen && (
          <UpdateConfirmModal
            version={state.newVersion ?? ''}
            onCancel={() => setConfirmOpen(false)}
            onConfirm={() => { setConfirmOpen(false); install(); }}
          />
        )}
      </>
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
