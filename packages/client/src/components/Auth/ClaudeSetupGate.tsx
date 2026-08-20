import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';

/**
 * §4 (첫 실행 설치 온보딩) — Claude Code CLI 설치 게이트 + 상단 배너.
 *
 * 앱만 내려받은 사람에게 **CLI 가 없다는 사실이 화면에 뜨는 유일한 자리**다. 그동안은
 * `LoginWindow` 가 `error`(판정 불가)면 뜨지 않고(§4 v4.82 — 판정 불가를 모달로 막지 않는다),
 * `ClaudeVersionGate` 는 `isOutdated` 로만 발화하는데 미설치는 `current=null` 이라 false 라서
 * 아무것도 뜨지 않았다.
 *
 * 화면 규칙:
 *  - **권장형(차단 ❌)** — [나중에] 로 닫으면 모달만 사라지고 **상단 배너**가 남는다. 배너를 누르면
 *    다시 열린다. 사용자가 앱을 둘러보는 것을 막지 않되, 없다는 사실은 계속 보이게 한다.
 *  - z-index 는 `LoginWindow`(100_600) 보다 위 — CLI 가 없으면 로그인은 애초에 불가능하므로
 *    순서상 이 창이 먼저다.
 *  - 설치가 끝나 `phase === 'ready'` 가 되면 성공 표시 후 자동으로 닫히고, 그 뒤 로그인이
 *    필요하면 `LoginWindow` 가 이어받는다(이 컴포넌트는 로그인을 직접 다루지 않는다).
 *  - 자동 설치가 막힌 플랫폼이거나 실패했을 때를 대비해 **수동 명령 + 공식 문서**가 항상 보인다.
 */

const Z = 100_700;

export function ClaudeSetupGate(): React.JSX.Element | null {
  const { t } = useTranslation();
  const setup = useGraphStore((s) => s.claudeSetup);
  const progress = useGraphStore((s) => s.claudeSetupProgress);
  const dismissed = useGraphStore((s) => s.setupGateDismissed);
  const forced = useGraphStore((s) => s.setupGateForced);
  const setSetupGate = useGraphStore((s) => s.setSetupGate);
  const install = useGraphStore((s) => s.installClaudeSetup);
  const refresh = useGraphStore((s) => s.refreshClaudeSetup);

  const [copied, setCopied] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const outputRef = useRef<HTMLPreElement | null>(null);

  /**
   * 설치가 막 끝난 직후 잠깐 유지되는 "완료" 표시.
   *
   * 이게 없으면 준비 완료 순간 `needsSetup` 과 `forced` 가 **동시에** 꺼지면서(스토어가
   * `setupGateForced` 를 내린다) 창이 그냥 사라져, 사용자는 [설치하기] 를 누른 뒤 아무 확인도
   * 못 본 채 화면이 바뀐다. 게이트를 **보고 있던 사람에게만** 1.6초 확인을 남긴다.
   */
  const [justCompleted, setJustCompleted] = useState(false);
  const wasOpenRef = useRef(false);

  const needsSetup = setup !== null && (setup.phase === 'missing' || setup.phase === 'failed' || setup.phase === 'installing');
  const shouldOpen = setup !== null && (justCompleted || forced || (needsSetup && !dismissed));

  useEffect(() => {
    if (setup?.phase !== 'ready') {
      wasOpenRef.current = shouldOpen;
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    setJustCompleted(true);
    const id = setTimeout(() => setJustCompleted(false), 1_600);
    return () => clearTimeout(id);
  }, [setup?.phase, shouldOpen]);

  // 설치 로그 자동 스크롤 — 마지막 줄이 항상 보이게.
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [progress?.output]);

  // 닫는 일은 위 `justCompleted` 만료가 맡는다 — 스토어가 준비 완료 시 `setupGateForced` 를
  // 이미 내리므로, 여기서 또 닫으려 들면 두 장치가 같은 일을 두 번 하게 된다.

  const handleCopy = useCallback(() => {
    if (!setup?.installCommand) return;
    void navigator.clipboard.writeText(setup.installCommand).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    }).catch(() => {});
  }, [setup?.installCommand]);

  const handleRecheck = useCallback(() => {
    setRechecking(true);
    void refresh().finally(() => setRechecking(false));
  }, [refresh]);

  if (!shouldOpen || !setup) return null;

  const installing = setup.phase === 'installing' || progress?.status === 'running' || progress?.status === 'starting';
  const failed = setup.phase === 'failed' || progress?.status === 'error';
  const ready = setup.phase === 'ready';

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-[2px]" style={{ zIndex: Z - 1 }} />
      <div className="pointer-events-none fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: Z }}>
        <div
          className="pointer-events-auto flex max-h-[90vh] w-[620px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-sky-500/40 bg-gray-900 shadow-2xl"
          style={{ boxShadow: '0 0 0 1px rgba(56,189,248,0.2), 0 25px 50px -12px rgba(0,0,0,0.85), 0 0 40px -8px rgba(56,189,248,0.35)' }}
        >
          {/* 헤더 */}
          <div className="flex items-center gap-2.5 border-b border-gray-800 px-4 py-3">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-sky-400" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M7 10l5 5 5-5" />
              <path d="M12 15V3" />
            </svg>
            <h3 className="flex-1 text-sm font-bold text-gray-100">
              {t('panel.setup.title', { defaultValue: 'Install Claude Code' })}
            </h3>
            {setup.version && (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[12px] font-semibold text-emerald-300">
                {setup.version}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-3 overflow-y-auto px-4 py-3.5">
            {ready ? (
              <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3.5 py-3 text-sm text-emerald-200">
                <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                {t('panel.setup.ready', { defaultValue: 'Claude Code is ready. Continuing…' })}
              </div>
            ) : (
              <>
                <p className="text-[13px] leading-relaxed text-gray-400">
                  {t('panel.setup.intro', {
                    defaultValue: 'Vibisual runs its agents with the Claude Code CLI, which is not installed on this computer yet. Install it here — no terminal needed.',
                  })}
                </p>

                {/* 설치 명령 — 자동 설치가 실제로 실행하는 것과 같은 문자열(서버가 조립해 내려준다). */}
                <div className="flex flex-col gap-1.5 rounded-lg border border-gray-800 bg-gray-950/70 px-3.5 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] uppercase tracking-wider text-gray-500">
                      {t('panel.setup.commandLabel', { defaultValue: 'Install command' })}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="text-[12px] text-gray-500 transition-colors hover:text-gray-300"
                    >
                      {copied
                        ? t('panel.setup.copied', { defaultValue: 'Copied' })
                        : t('panel.setup.copy', { defaultValue: 'Copy' })}
                    </button>
                  </div>
                  <code className="block overflow-x-auto whitespace-pre font-mono text-[12px] text-gray-300">
                    {setup.installCommand}
                  </code>
                </div>

                {!setup.canAutoInstall && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3.5 py-2.5 text-[12px] text-amber-200">
                    {t('panel.setup.manualOnly', {
                      defaultValue: 'Automatic install is not available on this platform. Run the command above in a terminal, then choose "Check again".',
                    })}
                  </div>
                )}

                {failed && (
                  <div className="flex flex-col gap-1.5 rounded-lg border border-red-500/40 bg-red-500/5 px-3.5 py-2.5 text-[12px] text-red-300">
                    <span>{t('panel.setup.failed', { defaultValue: 'The install did not complete. Run the command above in a terminal, then choose "Check again".' })}</span>
                    {(setup.error ?? progress?.error) && (
                      <span className="font-mono text-[12px] text-red-400/80">{setup.error ?? progress?.error}</span>
                    )}
                  </div>
                )}

                {/* 진행 로그 */}
                {progress && (
                  <div className="flex flex-col gap-1.5 rounded-lg border border-gray-800 bg-gray-950/70 px-3.5 py-2.5">
                    <div className="flex items-center gap-2 text-[12px]">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          installing ? 'animate-pulse bg-sky-400' :
                          progress.status === 'done' ? 'bg-emerald-400' :
                          progress.status === 'error' ? 'bg-red-400' : 'bg-gray-500'
                        }`}
                      />
                      <span className="font-semibold text-gray-300">
                        {installing
                          ? t('panel.setup.installing', { defaultValue: 'Installing…' })
                          : progress.status === 'done'
                            ? t('panel.setup.installDone', { defaultValue: 'Installed' })
                            : t('panel.setup.installFailed', { defaultValue: 'Install failed' })}
                      </span>
                    </div>
                    {progress.output && (
                      <pre
                        ref={outputRef}
                        className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-black/40 px-2 py-1 font-mono text-[12px] leading-relaxed text-gray-400"
                      >
                        {progress.output}
                      </pre>
                    )}
                  </div>
                )}

                <a
                  href={setup.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="self-start text-[12px] text-sky-400 underline transition-colors hover:text-sky-300"
                >
                  {t('panel.setup.docs', { defaultValue: 'Official installation guide' })}
                </a>
              </>
            )}
          </div>

          {/* 푸터 */}
          {!ready && (
            <div className="flex items-center justify-between gap-2 border-t border-gray-800 px-4 py-3">
              <button
                type="button"
                onClick={handleRecheck}
                disabled={rechecking}
                className="text-[12px] text-gray-500 transition-colors hover:text-gray-300 disabled:opacity-50"
              >
                {rechecking
                  ? t('panel.setup.rechecking', { defaultValue: 'Checking…' })
                  : t('panel.setup.recheck', { defaultValue: 'Check again' })}
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSetupGate({ forced: false, dismissed: true })}
                  className="rounded-md border border-gray-700 px-3 py-1.5 text-[13px] text-gray-300 transition-colors hover:border-gray-600 hover:text-white"
                >
                  {t('panel.setup.later', { defaultValue: 'Later' })}
                </button>
                {setup.canAutoInstall && (
                  <button
                    type="button"
                    onClick={() => { void install(); }}
                    disabled={installing}
                    className="rounded-md bg-sky-600 px-4 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
                  >
                    {installing
                      ? t('panel.setup.installing', { defaultValue: 'Installing…' })
                      : failed
                        ? t('panel.setup.retry', { defaultValue: 'Try again' })
                        : t('panel.setup.install', { defaultValue: 'Install' })}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

/**
 * 권장형 게이트를 [나중에]로 닫았을 때 남는 상단 배너 — 누르면 게이트가 다시 열린다.
 * 이것이 "차단하지 않으면서도 없다는 사실은 계속 보이게 한다"는 권장형의 나머지 절반이다.
 */
export function ClaudeSetupBanner(): React.JSX.Element | null {
  const { t } = useTranslation();
  const setup = useGraphStore((s) => s.claudeSetup);
  const dismissed = useGraphStore((s) => s.setupGateDismissed);
  const forced = useGraphStore((s) => s.setupGateForced);
  const setSetupGate = useGraphStore((s) => s.setSetupGate);

  const needsSetup = setup !== null && (setup.phase === 'missing' || setup.phase === 'failed');
  if (!needsSetup || !dismissed || forced) return null;

  return (
    <button
      type="button"
      onClick={() => setSetupGate({ forced: true })}
      className="flex w-full items-center justify-center gap-2 border-b border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-[12px] text-sky-200 transition-colors hover:bg-sky-500/20"
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v5" />
        <path d="M12 16h.01" />
      </svg>
      <span>
        {t('header.setupBanner.text', { defaultValue: 'Claude Code is not installed — agents cannot run yet.' })}
      </span>
      <span className="font-semibold underline">
        {t('header.setupBanner.action', { defaultValue: 'Install' })}
      </span>
    </button>
  );
}
