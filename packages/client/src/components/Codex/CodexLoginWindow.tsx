import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  CODEX_AUTH_TERMINAL_REVEAL_MS,
} from '@vibisual/shared';
import type { CodexAuthLoginMode } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { getTerminalTransport } from '../../transport/terminalTransport.js';
import { LoginTerminal } from '../Auth/LoginTerminal.js';
import { hasProjectFolder, shouldSummonProjectFolder } from '../Auth/projectFolderGateFlow.js';
import { LanguageSwitcher } from '../Layout/LanguageSwitcher.js';
import { EngineIcon } from '../Engine/engineIcons.js';
import { useOnboardingGate } from '../../stores/onboardingGates.js';
import { isCodexLoginGateOpen } from './codexGateFlow.js';
import { useCodexLoginSession } from './useCodexLoginSession.js';

const Z = 100_600;

/**
 * §5.25 (E) — 앱 안 코덱스 로그인 창.
 *
 * `LoginWindow`(클로드)의 대칭물이고 **같은 조각을 그대로 쓴다**: 상태는 서버
 * `codex login status`(스냅샷 `codexAuth`), 실행은 기존 임베디드 PTY, 출력 훑기는 같은
 * `scanLoginOutput`. 새 인증 레일도 새 스캐너도 만들지 않는다.
 *
 * 화면 규칙(클로드와 같은 것):
 *  - `loggedIn === false && !error` 일 때만 자동으로 뜬다. `error` 는 "모름"이라 앱을 막지 않는다.
 *  - 예외는 설치 게이트의 인계(`forced`) 하나 — 갓 깐 실행본에 자격증명이 있을 리 없다.
 *  - 성공의 1차 근거는 출력 문구가 아니라 **`login status` 재조회**다(진행 중 3초 폴링).
 *  - URL 을 제때 못 찾으면 같은 PTY 를 터미널로 펼친다 — 어떤 경우에도 앱 밖으로 나갈 일이 없다.
 *
 * **자격증명은 우리가 만지지 않는다.** 코덱스 홈의 `auth.json` 을 읽지도 쓰지도 않고, 로그인은
 * 코덱스 자신의 명령이 자기 방식대로 처리한다(§5.25 경계).
 */
export function CodexLoginWindow(): React.JSX.Element | null {
  const { t } = useTranslation();
  const auth = useGraphStore((s) => s.codexAuth);
  const dismissed = useGraphStore((s) => s.codexLoginGateDismissed);
  const forced = useGraphStore((s) => s.codexLoginGateForced);
  const engineChoice = useGraphStore((s) => s.userDefaults?.engineChoice);
  const setLoginGate = useGraphStore((s) => s.setCodexLoginGate);
  const refreshAuth = useGraphStore((s) => s.refreshCodexAuth);
  const refreshModels = useGraphStore((s) => s.refreshCodexModels);
  /**
   * PATH 의 `codex` 가 아니라 **설치 판정이 고른 절대경로**로 로그인한다.
   *
   * 방금 npm 전역 설치를 마친 경우 PATH 변화는 **이미 떠 있는 앱의 환경에 반영되지 않는다** —
   * 이름만 던지면 PTY 가 못 찾아 온보딩의 마지막 칸이 거기서 끊긴다(클로드 쪽이 같은 자리에서
   * 겪은 사고다). 설치 판정은 절대경로를 들고 있다.
   */
  const codexBinPath = useGraphStore((s) => s.codexSetup?.binPath);

  const [mode, setMode] = useState<CodexAuthLoginMode>('browser');
  const [code, setCode] = useState('');
  const [showTerminal, setShowTerminal] = useState(false);
  const [copied, setCopied] = useState<'url' | 'device' | null>(null);

  const transport = useMemo(() => getTerminalTransport(), []);
  const session = useCodexLoginSession(transport, refreshAuth, refreshModels);
  const { running, checking, succeeded, scan, startError, terminal, start, stop, recheck, setSucceeded } = session;
  const gateOpen = isCodexLoginGateOpen({ auth, forced, dismissed, engineChoice });
  const shouldOpen = gateOpen || succeeded;
  const copyOwner = useRef<string | null>(null);
  copyOwner.current = running ? terminal?.termId ?? null : null;
  useEffect(() => () => { copyOwner.current = null; }, []);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(null), 1_500);
    return () => clearTimeout(id);
  }, [copied]);
  useOnboardingGate('login', shouldOpen);

  const projects = useGraphStore((s) => s.projects);
  const stubProjects = useGraphStore((s) => s.stubProjects);
  const needsProjectFolder = !hasProjectFolder({ projects, stubProjects });

  /** 로그인 PTY 종료 + 진행 상태 초기화. */
  const stopLogin = useCallback(() => {
    copyOwner.current = null;
    stop();
    setCode('');
    setShowTerminal(false);
    setCopied(null);
  }, [stop]);

  // 창이 닫히면 진행 중이던 PTY 도 정리한다(뒤에 유령 프로세스가 남지 않게).
  useEffect(() => {
    // A status refresh may close the automatic gate before its promise resolves.
    // Let the active attempt finish its confirmed-success handoff in that case.
    if (!gateOpen && !auth?.loggedIn && running) stopLogin();
  }, [gateOpen, auth?.loggedIn, running, stopLogin]);

  /** 이 창이 닫히며 **다음 칸(프로젝트 폴더)으로 넘긴다.** 클로드 로그인 창과 같은 인계다. */
  const handOffToProjectFolder = useCallback(() => {
    const now = useGraphStore.getState();
    const hasFolder = hasProjectFolder({ projects: now.projects, stubProjects: now.stubProjects });
    if (!shouldSummonProjectFolder({ hasFolder })) return;
    now.setProjectGate({ forced: true, dismissed: false, reason: 'onboarding' });
  }, []);

  // 성공 표시 후 잠깐 뒤 자동 닫기.
  useEffect(() => {
    if (!succeeded) return;
    const id = setTimeout(() => {
      setSucceeded(false);
      setLoginGate({ forced: false });
      handOffToProjectFolder();
    }, 1_200);
    return () => clearTimeout(id);
  }, [succeeded, setLoginGate, handOffToProjectFolder]);

  // URL 을 제때 못 찾으면 터미널을 펼친다 — 우리가 모르는 프롬프트가 떠도 직접 응답할 수 있게.
  useEffect(() => {
    if (!running || checking || showTerminal) return;
    const id = setTimeout(() => {
      if (!scan.url || (mode === 'device' && !scan.deviceCode)) setShowTerminal(true);
    }, CODEX_AUTH_TERMINAL_REVEAL_MS);
    return () => clearTimeout(id);
  }, [running, checking, showTerminal, scan.url, scan.deviceCode, mode]);

  const handleStart = useCallback(async () => {
    setCode('');
    setShowTerminal(false);
    setCopied(null);
    const bin = codexBinPath && codexBinPath.length > 0 ? codexBinPath : 'codex';
    await start(bin, mode);
  }, [start, mode, codexBinPath]);

  const handleSendCode = useCallback(() => {
    const value = code.trim();
    if (!value || !transport || !terminal || !running || mode === 'device') return;
    void transport.write(terminal.termId, `${value}\r`).catch(() => {});
    setCode('');
  }, [code, transport, terminal, running, mode]);

  const handleOpenUrl = useCallback(() => {
    if (!scan.url) return;
    window.open(scan.url, '_blank', 'noopener,noreferrer');
  }, [scan.url]);

  const handleCopy = useCallback((kind: 'url' | 'device') => {
    const value = kind === 'url' ? scan.url : scan.deviceCode;
    const owner = copyOwner.current;
    if (!value || !owner) return;
    void navigator.clipboard?.writeText(value).then(() => {
      if (copyOwner.current === owner) setCopied(kind);
    }).catch(() => {});
  }, [scan.url, scan.deviceCode]);

  if (!shouldOpen) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-[2px]" style={{ zIndex: Z - 1 }} />
      <div className="pointer-events-none fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: Z }}>
        <div
          className="pointer-events-auto flex max-h-[90vh] w-[600px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-emerald-500/40 bg-gray-900 shadow-2xl"
          style={{ boxShadow: '0 0 0 1px rgba(16,185,129,0.2), 0 25px 50px -12px rgba(0,0,0,0.85), 0 0 40px -8px rgba(16,185,129,0.4)' }}
        >
          <div className="flex items-center gap-2.5 border-b border-gray-800 px-4 py-3">
            <EngineIcon kind="codex" className="h-5 w-5 text-emerald-400" />
            <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-gray-100">
              {t('panel.codexLogin.title', { defaultValue: 'Sign in to Codex' })}
            </h3>
            {auth?.error && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[12px] font-semibold uppercase tracking-wider text-amber-300">
                {auth.error}
              </span>
            )}
            <div className="shrink-0 md:hidden"><LanguageSwitcher portalMenu menuZIndex={Z + 100} /></div>
          </div>

          <div className="flex flex-col gap-3 overflow-y-auto px-4 py-3.5">
            {succeeded ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3.5 py-3 text-sm text-emerald-200">
                  <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  {t('panel.codexLogin.success', { defaultValue: 'Signed in. Closing…' })}
                </div>
                {needsProjectFolder && (
                  <p className="px-0.5 text-[12px] text-gray-500">
                    {t('panel.codexLogin.successNext', { defaultValue: 'Next: choose the project folder your agents will work in.' })}
                  </p>
                )}
              </div>
            ) : (
              <>
                <p className="text-[13px] leading-relaxed text-gray-400">
                  {t('panel.codexLogin.intro', {
                    defaultValue: 'Codex agents run with your OpenAI account. Sign in here — no separate terminal needed.',
                  })}
                </p>

                {/* 방식 선택 — 시작 전에만 바꿀 수 있다(진행 중 변경은 PTY 인자와 어긋난다). */}
                {!running && (
                  <div className="flex flex-col gap-2">
                    <ModeCard
                      active={mode === 'browser'}
                      onClick={() => setMode('browser')}
                      title={t('panel.codexLogin.modeBrowser', { defaultValue: 'Browser sign-in' })}
                      desc={t('panel.codexLogin.modeBrowserDesc', { defaultValue: 'Opens your ChatGPT account page and comes back automatically.' })}
                    />
                    <ModeCard
                      active={mode === 'device'}
                      onClick={() => setMode('device')}
                      title={t('panel.codexLogin.modeDevice', { defaultValue: 'Device code' })}
                      desc={t('panel.codexLogin.modeDeviceDesc', { defaultValue: 'For machines that cannot open a browser — enter a code on another device.' })}
                    />
                  </div>
                )}

                {running && (
                  <div className="flex flex-col gap-2.5">
                    {scan.url ? (
                      <div className="flex flex-col gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-3">
                        <span className="text-[13px] text-emerald-200">
                          {t('panel.codexLogin.openBrowser', { defaultValue: 'Approve the sign-in in your browser, then come back here.' })}
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={handleOpenUrl}
                            className="rounded-md bg-emerald-600 px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-emerald-500"
                          >
                            {t('panel.codexLogin.openBrowserBtn', { defaultValue: 'Open in browser' })}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopy('url')}
                            className="rounded-md border border-gray-700 px-3 py-1.5 text-[13px] text-gray-300 transition-colors hover:border-gray-600 hover:text-white"
                          >
                            {copied === 'url'
                              ? t('panel.codexLogin.copied', { defaultValue: 'Copied' })
                              : t('panel.codexLogin.copyUrl', { defaultValue: 'Copy link' })}
                          </button>
                        </div>
                        <code className="truncate text-[12px] text-gray-500">{scan.url}</code>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950/60 px-3.5 py-3 text-[13px] text-gray-400">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                        {checking
                          ? t('panel.codexLogin.checking', { defaultValue: 'Checking sign-in…' })
                          : t('panel.codexLogin.starting', { defaultValue: 'Starting sign-in…' })}
                      </div>
                    )}

                    {mode === 'device' && !checking && (
                      <div className="flex flex-col gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-3">
                        <p className="text-[13px] text-emerald-200">
                          {t('panel.codexLogin.deviceCodePrompt', { defaultValue: 'Enter this code on the sign-in page in your browser.' })}
                        </p>
                        {scan.deviceCode ? (
                          <div className="flex flex-wrap items-center gap-3">
                            <code className="select-all font-mono text-lg font-semibold tracking-wider text-gray-100">{scan.deviceCode}</code>
                            <button
                              type="button"
                              onClick={() => handleCopy('device')}
                              className="rounded-md border border-gray-700 px-3 py-1.5 text-[13px] text-gray-300 hover:text-white"
                            >
                              {copied === 'device'
                                ? t('panel.codexLogin.copied', { defaultValue: 'Copied' })
                                : t('panel.codexLogin.copyDeviceCode', { defaultValue: 'Copy code' })}
                            </button>
                          </div>
                        ) : (
                          <p className="text-[12px] text-gray-400">
                            {t('panel.codexLogin.deviceCodeWaiting', { defaultValue: 'Waiting for the device code…' })}
                          </p>
                        )}
                        <p className="text-[12px] text-gray-400">
                          {t('panel.codexLogin.deviceCodeHelp', { defaultValue: 'Device code login must be enabled in your ChatGPT security settings or workspace permissions. If unavailable, try browser sign-in.' })}
                        </p>
                      </div>
                    )}

                    {mode !== 'device' && scan.wantsCode && (
                      <div className="flex flex-col gap-1.5 rounded-lg border border-gray-700 bg-gray-950/60 px-3.5 py-3">
                        <span className="text-[12px] text-gray-300">
                          {t('panel.codexLogin.codePrompt', { defaultValue: 'Paste the code shown in your browser.' })}
                        </span>
                        <div className="flex items-center gap-2">
                          <input
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleSendCode(); }}
                            placeholder={t('panel.codexLogin.codePlaceholder', { defaultValue: 'Authorization code' })}
                            className="min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-900 px-2.5 py-1.5 font-mono text-[13px] text-gray-200 outline-none placeholder:text-gray-600 focus:border-emerald-500/60"
                          />
                          <button
                            type="button"
                            onClick={handleSendCode}
                            disabled={!code.trim()}
                            className="rounded-md bg-emerald-600 px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
                          >
                            {t('panel.codexLogin.sendCode', { defaultValue: 'Send' })}
                          </button>
                        </div>
                      </div>
                    )}

                  </div>
                )}

                {scan.failed && (
                  <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/5 px-3.5 py-2.5 text-[12px] text-red-300">
                    {t('panel.codexLogin.ended', { defaultValue: 'Sign-in ended before it completed. Try again, or choose another sign-in method.' })}
                  </div>
                )}

                {startError && (
                  <div className="rounded-lg border border-red-500/40 bg-red-500/5 px-3.5 py-2.5 text-[12px] text-red-300">
                    {startError === 'no-transport'
                      ? t('panel.codexLogin.noTerminal', {
                        defaultValue: 'This window cannot run a terminal here. Open Vibisual on the desktop app to sign in.',
                      })
                      : t('panel.codexLogin.startFailed', { defaultValue: 'Could not start the sign-in process.' })}
                    {startError !== 'no-transport' && (
                      <span className="mt-1.5 block break-all font-mono text-[12px] text-red-300/70">{startError}</span>
                    )}
                  </div>
                )}

                {/* 터미널 폴백 — 우리가 못 알아본 프롬프트가 떠도 여기서 직접 응답한다. */}
                {running && !checking && (
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowTerminal((v) => !v)}
                      className="flex items-center gap-1.5 self-start text-[12px] text-gray-500 transition-colors hover:text-gray-300"
                    >
                      <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 transition-transform ${showTerminal ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                      {t('panel.codexLogin.showTerminal', { defaultValue: 'Terminal' })}
                    </button>
                    {showTerminal && terminal && <LoginTerminal termId={terminal.termId} command={terminal.command} env={terminal.env} />}
                  </div>
                )}
              </>
            )}
          </div>

          {!succeeded && (
            <div className="flex items-center justify-between gap-2 border-t border-gray-800 px-4 py-3">
              <button
                type="button"
                onClick={() => { void recheck(); }}
                className="text-[12px] text-gray-500 transition-colors hover:text-gray-300"
              >
                {t('panel.codexLogin.recheck', { defaultValue: 'Check again' })}
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    stopLogin();
                    setLoginGate({ forced: false, dismissed: true });
                  }}
                  className="rounded-md border border-gray-700 px-3 py-1.5 text-[13px] text-gray-300 transition-colors hover:border-gray-600 hover:text-white"
                >
                  {t('panel.codexLogin.later', { defaultValue: 'Later' })}
                </button>
                {running ? (
                  <button
                    type="button"
                    onClick={stopLogin}
                    className="rounded-md border border-gray-700 px-3 py-1.5 text-[13px] text-gray-300 transition-colors hover:border-gray-600 hover:text-white"
                  >
                    {t('panel.codexLogin.stop', { defaultValue: 'Stop' })}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => { void handleStart(); }}
                    className="rounded-md bg-emerald-600 px-4 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-emerald-500"
                  >
                    {scan.failed || startError
                      ? t('panel.codexLogin.retry', { defaultValue: 'Try again' })
                      : t('panel.codexLogin.start', { defaultValue: 'Sign in' })}
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

function ModeCard({ active, onClick, title, desc }: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-left transition-colors ${
        active
          ? 'border-emerald-500/60 bg-emerald-500/10'
          : 'border-gray-800 bg-gray-950/50 hover:border-gray-700'
      }`}
    >
      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${active ? 'border-emerald-400' : 'border-gray-600'}`}>
        {active && <span className="h-2 w-2 rounded-full bg-emerald-400" />}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className={`text-[13px] font-semibold ${active ? 'text-emerald-100' : 'text-gray-300'}`}>{title}</span>
        <span className="text-[12px] text-gray-500">{desc}</span>
      </span>
    </button>
  );
}
