import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';

const Z = 100_500;

const MARKETPLACE_URL = 'https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code';

/**
 * §5.7 #23-1 v1.59 — Claude Code 버전 업데이트 게이트 모달.
 * `addCommand` 가 outdated 감지 시 자동으로 띄움. 사용자 결정까지 명령 발사 보류.
 */
export function ClaudeVersionGate(): React.JSX.Element | null {
  const { t } = useTranslation();
  const open = useGraphStore((s) => s.claudeVersionModalOpen);
  const info = useGraphStore((s) => s.claudeVersion);
  const progress = useGraphStore((s) => s.claudeInstallProgress);
  const dismiss = useGraphStore((s) => s.dismissClaudeVersion);
  const install = useGraphStore((s) => s.installClaudeVersion);
  const stdoutRef = useRef<HTMLPreElement | null>(null);

  // 설치 stdout 자동 스크롤
  useEffect(() => {
    if (stdoutRef.current) stdoutRef.current.scrollTop = stdoutRef.current.scrollHeight;
  }, [progress?.stdout]);

  // dismiss 레퍼런스 — 스토어 셀렉터는 매 렌더마다 새 참조를 반환할 수 있으므로
  // ref로 감싸 effect deps에서 제외하면서도 항상 최신 함수를 호출한다.
  const dismissRef = useRef(dismiss);
  useEffect(() => { dismissRef.current = dismiss; });

  // 설치 완료 + 새 버전 검증되면 모달 자동 닫고 명령 발사 흐름 재개
  useEffect(() => {
    const isDone = progress?.status === 'done';
    const isFailed = progress?.status === 'error';
    if (isDone && progress?.newVersion && !isFailed) {
      const id = setTimeout(() => dismissRef.current(), 600);
      return () => clearTimeout(id);
    }
  }, [progress?.status, progress?.newVersion]);

  if (!open || !info) return null;

  const installing = progress != null && progress.status !== 'done' && progress.status !== 'error';
  const installFailed = progress?.status === 'error';
  const installDone = progress?.status === 'done';

  const canAutoInstall = info.source === 'path';

  return createPortal(
    <>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-[1px]"
        style={{ zIndex: Z - 1 }}
      />
      <div
        className="pointer-events-none fixed inset-0 flex items-center justify-center"
        style={{ zIndex: Z }}
      >
        <div
          className="pointer-events-auto flex w-[560px] max-w-[92vw] flex-col rounded-lg border-2 border-amber-500/70 bg-gray-900 shadow-2xl"
          style={{ boxShadow: '0 0 0 1px rgba(245,158,11,0.25), 0 25px 50px -12px rgba(0,0,0,0.8), 0 0 32px -4px rgba(245,158,11,0.35)' }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-gray-700 px-4 py-3">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-amber-400" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v4" />
              <path d="M12 18v4" />
              <path d="M4.93 4.93l2.83 2.83" />
              <path d="M16.24 16.24l2.83 2.83" />
              <path d="M2 12h4" />
              <path d="M18 12h4" />
              <path d="M4.93 19.07l2.83-2.83" />
              <path d="M16.24 7.76l2.83-2.83" />
            </svg>
            <h3 className="flex-1 text-sm font-bold text-gray-100">
              {t('panel.claudeVersionGate.title', { defaultValue: 'Claude Code update available' })}
            </h3>
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
              {info.source}
            </span>
          </div>

          {/* Body — version diff */}
          <div className="flex flex-col gap-3 px-4 py-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1 rounded border border-gray-800 bg-gray-950/70 px-3 py-2">
                <span className="text-[10px] uppercase tracking-wider text-gray-500">
                  {t('panel.claudeVersionGate.current', { defaultValue: 'Current' })}
                </span>
                <span className="font-mono text-base text-gray-200">{info.current ?? '?'}</span>
              </div>
              <div className="flex flex-col gap-1 rounded border border-emerald-500/40 bg-emerald-500/5 px-3 py-2">
                <span className="text-[10px] uppercase tracking-wider text-emerald-400">
                  {t('panel.claudeVersionGate.latest', { defaultValue: 'Latest' })}
                </span>
                <span className="font-mono text-base text-emerald-300">{info.latest ?? '?'}</span>
              </div>
            </div>

            <div className="text-[11px] text-gray-400">
              {t('panel.claudeVersionGate.binPath', { defaultValue: 'Binary' })}:{' '}
              <span className="font-mono text-gray-500">{info.binPath}</span>
            </div>

            {info.source === 'vscode-extension' && (
              <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200">
                {t('panel.claudeVersionGate.vscodeNotice', {
                  defaultValue: 'This binary comes from the VS Code extension and cannot be auto-updated. Open the Marketplace to update.',
                })}
                <div className="mt-1.5">
                  <a
                    href={MARKETPLACE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-amber-300 underline hover:text-amber-200"
                  >
                    {t('panel.claudeVersionGate.openMarketplace', { defaultValue: 'Open VS Code Marketplace' })}
                  </a>
                </div>
              </div>
            )}

            {info.source === 'unknown' && (
              <div className="rounded border border-red-500/40 bg-red-500/5 px-3 py-2 text-[11px] text-red-200">
                {t('panel.claudeVersionGate.unknownNotice', {
                  defaultValue: 'Could not detect a working `claude` binary. Install Claude Code manually before continuing.',
                })}
              </div>
            )}

            {/* Install progress */}
            {progress && (
              <div className="flex flex-col gap-1.5 rounded border border-gray-800 bg-gray-950/70 px-3 py-2">
                <div className="flex items-center gap-2 text-[11px]">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      installing ? 'animate-pulse bg-amber-400' :
                      installDone ? 'bg-emerald-400' :
                      installFailed ? 'bg-red-400' : 'bg-gray-500'
                    }`}
                  />
                  <span className="font-semibold text-gray-300">
                    {installing && t('panel.claudeVersionGate.installing', { defaultValue: 'Installing…' })}
                    {installDone && t('panel.claudeVersionGate.installDone', { defaultValue: 'Installed', version: progress.newVersion ?? '?' })}
                    {installFailed && t('panel.claudeVersionGate.installFailed', { defaultValue: 'Install failed' })}
                  </span>
                  {progress.newVersion && installDone && (
                    <span className="font-mono text-emerald-300">→ {progress.newVersion}</span>
                  )}
                </div>
                {progress.stdout && (
                  <pre
                    ref={stdoutRef}
                    className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-black/40 px-2 py-1 font-mono text-[10px] leading-relaxed text-gray-400"
                  >
                    {progress.stdout}
                  </pre>
                )}
                {progress.error && (
                  <div className="text-[11px] text-red-300">{progress.error}</div>
                )}
              </div>
            )}

            {info.registryError && !info.latest && (
              <div className="text-[10px] text-gray-500">
                {t('panel.claudeVersionGate.registryError', { defaultValue: 'npm registry check failed' })}: {info.registryError}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 border-t border-gray-700 px-4 py-3">
            <button
              type="button"
              onClick={dismiss}
              disabled={installing}
              className="rounded px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('panel.claudeVersionGate.skip', { defaultValue: 'Skip this session' })}
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={dismiss}
                disabled={installing}
                className="rounded border border-gray-700 px-4 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('panel.claudeVersionGate.keep', { defaultValue: 'Keep current' })}
              </button>

              {/* §5.7 #23-1 v1.77 — 자동설치 불가 source 는 죽은(비활성) Update 버튼을
                  남기지 않는다(거짓 어포던스). path=동작하는 Update,
                  vscode-extension=동작하는 Marketplace 버튼, unknown=주 버튼 없음. */}
              {canAutoInstall ? (
                <button
                  type="button"
                  onClick={() => void install()}
                  disabled={installing || installDone}
                  className="rounded bg-amber-600 px-4 py-1.5 text-xs font-semibold text-white shadow-md transition-all duration-100 ease-out hover:bg-amber-500 hover:shadow-lg active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500 disabled:shadow-none"
                >
                  {installing
                    ? t('panel.claudeVersionGate.updating', { defaultValue: 'Updating…' })
                    : t('panel.claudeVersionGate.update', { defaultValue: 'Update' })}
                </button>
              ) : info.source === 'vscode-extension' ? (
                <a
                  href={MARKETPLACE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={dismiss}
                  className="rounded bg-amber-600 px-4 py-1.5 text-xs font-semibold text-white no-underline shadow-md transition-all duration-100 ease-out hover:bg-amber-500 hover:shadow-lg active:scale-95"
                >
                  {t('panel.claudeVersionGate.openMarketplace', { defaultValue: 'Open VS Code Marketplace' })}
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
