import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CLAUDE_SETUP_READY_HOLD_MS } from '@vibisual/shared';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { LanguageSwitcher } from '../Layout/LanguageSwitcher.js';
import { useOnboardingGate } from '../../stores/onboardingGates.js';
import { isCodexSetupGateOpen, shouldSummonCodexLogin } from './codexGateFlow.js';

/**
 * §5.25 (D) — 코덱스 CLI 설치 게이트 + 상단 배너.
 *
 * `ClaudeSetupGate` 의 대칭물이고 **같은 규약**을 따른다: 권장형(차단 ❌ · [나중에] 로 닫으면
 * 배너가 남는다), 설치 명령은 서버가 실제로 실행하는 문자열 그대로, 준비가 끝나면 짧은 확인 뒤
 * 자동으로 닫히며 **그 자리에서 로그인 창을 부른다**.
 *
 * **다른 점 하나**: 이 창은 저절로 뜨지 않는다. 코덱스를 고른 적 있는 사용자에게만 자동으로
 * 뜨고(§5.25 (C) `codexGatesMayAutoOpen`), 그 밖에는 사용자가 직접 열 때만 나타난다 —
 * 코덱스를 쓸 생각이 없는 사람에게 설치 창이 하나 더 생기면 그건 방해다.
 *
 * ⚠ 완료 유지 타이머의 deps 는 `justCompleted` 하나뿐이다. 여기에 `shouldOpen` 을 넣으면
 *   타이머가 켠 상태가 곧바로 자기 효과를 다시 태워 정리(cleanup)가 방금 건 타이머를 지운다 —
 *   클로드 게이트가 "준비 완료"에서 영원히 멈췄던 자리가 정확히 그것이었다.
 */

const Z = 100_700;

export function CodexSetupGate(): React.JSX.Element | null {
  const { t } = useTranslation();
  const setup = useGraphStore((s) => s.codexSetup);
  const progress = useGraphStore((s) => s.codexSetupProgress);
  const dismissed = useGraphStore((s) => s.codexSetupGateDismissed);
  const forced = useGraphStore((s) => s.codexSetupGateForced);
  const engineChoice = useGraphStore((s) => s.userDefaults?.engineChoice);
  const setGate = useGraphStore((s) => s.setCodexSetupGate);
  const install = useGraphStore((s) => s.installCodexSetup);
  const refresh = useGraphStore((s) => s.refreshCodexSetup);
  const setLoginGate = useGraphStore((s) => s.setCodexLoginGate);
  const refreshAuth = useGraphStore((s) => s.refreshCodexAuth);
  const refreshModels = useGraphStore((s) => s.refreshCodexModels);

  const [copied, setCopied] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  const outputRef = useRef<HTMLPreElement | null>(null);
  const wasOpenRef = useRef(false);
  /** 인계는 한 번만 — 자동 만료와 [계속] 이 겹쳐도 로그인 창을 두 번 부르지 않게. */
  const handedOffRef = useRef(false);

  const shouldOpen = isCodexSetupGateOpen({ setup, justCompleted, forced, dismissed, engineChoice });
  useOnboardingGate('setup', shouldOpen);

  /** 다음 칸(로그인)으로 넘긴다 — 이 게이트가 닫히는 **모든 경로**가 같은 함수를 탄다. */
  const handOffToLogin = useCallback(() => {
    if (handedOffRef.current) return;
    handedOffRef.current = true;
    // 갓 깐 실행본의 로그인 상태는 아직 `cli-missing` 으로 캐시돼 있다 — 먼저 다시 묻는다.
    void refreshAuth().then((next) => {
      if (shouldSummonCodexLogin(next)) setLoginGate({ forced: true, dismissed: false });
    });
    // 모델 목록도 이 자리에서 한 번 읽는다(설치 전에는 캐시 파일이 없었다).
    void refreshModels();
  }, [refreshAuth, setLoginGate, refreshModels]);

  const continueNow = useCallback(() => {
    setJustCompleted(false);
    setGate({ forced: false });
    handOffToLogin();
  }, [setGate, handOffToLogin]);

  const backdrop = useBackdropDismiss<HTMLDivElement>(() => {
    // 설치 중에 바깥을 누른 것은 무시한다(중단이 아니다). 준비가 끝난 뒤에만 넘어간다.
    if (setup?.phase === 'ready') continueNow();
  });

  // 게이트를 **보고 있던 사람에게만** 짧은 완료 표시를 남긴다.
  useEffect(() => {
    const ready = setup?.phase === 'ready';
    if (!ready && shouldOpen) wasOpenRef.current = true;
    if (ready && wasOpenRef.current) {
      wasOpenRef.current = false;
      handedOffRef.current = false;
      setJustCompleted(true);
    }
  }, [setup?.phase, shouldOpen]);

  // 완료 표시 만료 — deps 는 `justCompleted` 하나뿐이다(위 ⚠ 참조).
  useEffect(() => {
    if (!justCompleted) return;
    const id = setTimeout(() => {
      setJustCompleted(false);
      setGate({ forced: false });
      handOffToLogin();
    }, CLAUDE_SETUP_READY_HOLD_MS);
    return () => clearTimeout(id);
  }, [justCompleted]); // eslint-disable-line react-hooks/exhaustive-deps

  // 진행 로그는 항상 마지막 줄을 보여 준다(사용자가 위로 올려 읽는 중이면 방해하지 않게 끝일 때만).
  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [progress?.output]);

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
      <div className="fixed inset-0 bg-black/70 backdrop-blur-[2px]" style={{ zIndex: Z - 1 }} {...backdrop} />
      <div className="pointer-events-none fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: Z }}>
        <div
          className="pointer-events-auto flex max-h-[90vh] w-[620px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-emerald-500/40 bg-gray-900 shadow-2xl"
          style={{ boxShadow: '0 0 0 1px rgba(16,185,129,0.2), 0 25px 50px -12px rgba(0,0,0,0.85), 0 0 40px -8px rgba(16,185,129,0.35)' }}
        >
          <div className="flex items-center gap-2.5 border-b border-gray-800 px-4 py-3">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 18l6-6-6-6" />
              <path d="M8 6l-6 6 6 6" />
            </svg>
            <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-gray-100">
              {t('panel.codexSetup.title', { defaultValue: 'Install Codex CLI' })}
            </h3>
            {setup.version && (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[12px] font-semibold text-emerald-300">
                {setup.version}
              </span>
            )}
            <div className="shrink-0 md:hidden"><LanguageSwitcher portalMenu menuZIndex={Z + 100} /></div>
          </div>

          <div className="flex flex-col gap-3 overflow-y-auto px-4 py-3.5">
            {ready ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3.5 py-3 text-sm text-emerald-200">
                  <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  {t('panel.codexSetup.ready', { defaultValue: 'Codex CLI is ready. Continuing…' })}
                </div>
                <p className="px-0.5 text-[12px] text-gray-500">
                  {t('panel.codexSetup.readyNext', { defaultValue: 'Next: sign in to your OpenAI account.' })}
                </p>
              </div>
            ) : (
              <>
                <p className="text-[13px] leading-relaxed text-gray-400">
                  {t('panel.codexSetup.intro', {
                    defaultValue: 'Codex agents run through the Codex CLI, which is not installed on this computer yet. Install it here — no terminal needed.',
                  })}
                </p>

                <div className="flex flex-col gap-1.5 rounded-lg border border-gray-800 bg-gray-950/70 px-3.5 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] uppercase tracking-wider text-gray-500">
                      {t('panel.codexSetup.commandLabel', { defaultValue: 'Install command' })}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="text-[12px] text-gray-500 transition-colors hover:text-gray-300"
                    >
                      {copied
                        ? t('panel.codexSetup.copied', { defaultValue: 'Copied' })
                        : t('panel.codexSetup.copy', { defaultValue: 'Copy' })}
                    </button>
                  </div>
                  <code className="block overflow-x-auto whitespace-pre font-mono text-[12px] text-gray-300">
                    {setup.installCommand}
                  </code>
                </div>

                {!setup.canAutoInstall && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3.5 py-2.5 text-[12px] text-amber-200">
                    {t('panel.codexSetup.manualOnly', {
                      defaultValue: 'npm was not found, so Vibisual cannot install it for you. Install Node.js, run the command above in a terminal, then choose "Check again".',
                    })}
                  </div>
                )}

                {failed && (
                  <div className="flex flex-col gap-1.5 rounded-lg border border-red-500/40 bg-red-500/5 px-3.5 py-2.5 text-[12px] text-red-300">
                    <span>{t('panel.codexSetup.failed', { defaultValue: 'The install did not complete. Run the command above in a terminal, then choose "Check again".' })}</span>
                    {(setup.error ?? progress?.error) && (
                      <span className="font-mono text-[12px] text-red-400/80">{setup.error ?? progress?.error}</span>
                    )}
                  </div>
                )}

                {progress && (
                  <div className="flex flex-col gap-1.5 rounded-lg border border-gray-800 bg-gray-950/70 px-3.5 py-2.5">
                    <div className="flex items-center gap-2 text-[12px]">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          installing ? 'animate-pulse bg-emerald-400' :
                          progress.status === 'done' ? 'bg-emerald-400' :
                          progress.status === 'error' ? 'bg-red-400' : 'bg-gray-500'
                        }`}
                      />
                      <span className="font-semibold text-gray-300">
                        {installing
                          ? t('panel.codexSetup.installing', { defaultValue: 'Installing…' })
                          : progress.status === 'done'
                            ? t('panel.codexSetup.installDone', { defaultValue: 'Installed' })
                            : t('panel.codexSetup.installFailed', { defaultValue: 'Install failed' })}
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
                  className="self-start text-[12px] text-emerald-400 underline transition-colors hover:text-emerald-300"
                >
                  {t('panel.codexSetup.docs', { defaultValue: 'Official installation guide' })}
                </a>
              </>
            )}
          </div>

          {ready ? (
            <div className="flex items-center justify-end gap-2 border-t border-gray-800 px-4 py-3">
              <button
                type="button"
                autoFocus
                onClick={continueNow}
                className="rounded-md bg-emerald-600 px-4 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-emerald-500"
              >
                {t('panel.codexSetup.continue', { defaultValue: 'Continue' })}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 border-t border-gray-800 px-4 py-3">
              <button
                type="button"
                onClick={handleRecheck}
                disabled={rechecking}
                className="text-[12px] text-gray-500 transition-colors hover:text-gray-300 disabled:opacity-50"
              >
                {rechecking
                  ? t('panel.codexSetup.rechecking', { defaultValue: 'Checking…' })
                  : t('panel.codexSetup.recheck', { defaultValue: 'Check again' })}
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setGate({ forced: false, dismissed: true })}
                  className="rounded-md border border-gray-700 px-3 py-1.5 text-[13px] text-gray-300 transition-colors hover:border-gray-600 hover:text-white"
                >
                  {t('panel.codexSetup.later', { defaultValue: 'Later' })}
                </button>
                {setup.canAutoInstall && (
                  <button
                    type="button"
                    onClick={() => { void install(); }}
                    disabled={installing}
                    className="rounded-md bg-emerald-600 px-4 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {installing
                      ? t('panel.codexSetup.installing', { defaultValue: 'Installing…' })
                      : failed
                        ? t('panel.codexSetup.retry', { defaultValue: 'Try again' })
                        : t('panel.codexSetup.install', { defaultValue: 'Install' })}
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
 * 권장형 게이트를 [나중에] 로 닫았을 때 남는 상단 배너.
 *
 * **코덱스를 고른 사람에게만 보인다** — 클로드나 로컬을 쓰는 사람의 화면 위에 코덱스 배너가
 * 늘 떠 있으면 그건 광고지 안내가 아니다.
 */
export function CodexSetupBanner(): React.JSX.Element | null {
  const { t } = useTranslation();
  const setup = useGraphStore((s) => s.codexSetup);
  const dismissed = useGraphStore((s) => s.codexSetupGateDismissed);
  const forced = useGraphStore((s) => s.codexSetupGateForced);
  const engineChoice = useGraphStore((s) => s.userDefaults?.engineChoice);
  const setGate = useGraphStore((s) => s.setCodexSetupGate);

  const needsSetup = setup !== null && (setup.phase === 'missing' || setup.phase === 'failed');
  if (!needsSetup || !dismissed || forced || engineChoice?.kind !== 'codex') return null;

  return (
    <button
      type="button"
      onClick={() => setGate({ forced: true })}
      className="flex w-full items-center justify-center gap-2 border-b border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[12px] text-emerald-200 transition-colors hover:bg-emerald-500/20"
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v5" />
        <path d="M12 16h.01" />
      </svg>
      <span>
        {t('header.codexSetupBanner.text', { defaultValue: 'Codex CLI is not installed — Codex agents cannot run yet.' })}
      </span>
      <span className="font-semibold underline">
        {t('header.codexSetupBanner.action', { defaultValue: 'Install' })}
      </span>
    </button>
  );
}
