import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  CODEX_AUTH_LOGIN_TERM_ID,
  CODEX_AUTH_LOGIN_POLL_INTERVAL_MS,
  CODEX_AUTH_TERMINAL_REVEAL_MS,
  DEFAULT_AGENT_CONFIG,
} from '@vibisual/shared';
import type { CodexAuthLoginMode } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { getTerminalTransport } from '../../transport/terminalTransport.js';
import { LoginTerminal } from '../Auth/LoginTerminal.js';
import { scanLoginOutput, type LoginScan } from '../Auth/loginOutput.js';
import { hasProjectFolder, shouldSummonProjectFolder } from '../Auth/projectFolderGateFlow.js';
import { LanguageSwitcher } from '../Layout/LanguageSwitcher.js';
import { useOnboardingGate } from '../../stores/onboardingGates.js';
import { isCodexLoginGateOpen } from './codexGateFlow.js';

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
  const [running, setRunning] = useState(false);
  const [scan, setScan] = useState<LoginScan>({});
  const [code, setCode] = useState('');
  const [showTerminal, setShowTerminal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [loginCommand, setLoginCommand] = useState<string | undefined>(undefined);
  /** PTY 출력 누적 — URL·코드 요구는 여러 청크에 걸쳐 온다. */
  const bufferRef = useRef('');

  const transport = useMemo(() => getTerminalTransport(), []);
  const shouldOpen = isCodexLoginGateOpen({ auth, forced, dismissed, engineChoice });
  useOnboardingGate('login', shouldOpen);

  const projects = useGraphStore((s) => s.projects);
  const stubProjects = useGraphStore((s) => s.stubProjects);
  const needsProjectFolder = !hasProjectFolder({ projects, stubProjects });

  /** 로그인 PTY 종료 + 진행 상태 초기화. */
  const stopLogin = useCallback(() => {
    setRunning(false);
    setScan({});
    setCode('');
    setShowTerminal(false);
    bufferRef.current = '';
    void transport?.kill(CODEX_AUTH_LOGIN_TERM_ID).catch(() => {});
  }, [transport]);

  // 창이 닫히면 진행 중이던 PTY 도 정리한다(뒤에 유령 프로세스가 남지 않게).
  useEffect(() => {
    if (!shouldOpen && running) stopLogin();
  }, [shouldOpen, running, stopLogin]);

  // 진행 중 상태 폴링 — 브라우저에서 승인이 끝나는 순간을 잡는다.
  useEffect(() => {
    if (!running || succeeded) return;
    const id = setInterval(() => {
      void refreshAuth().then((next) => {
        if (next?.loggedIn) {
          setSucceeded(true);
          stopLogin();
          // 로그인해야 읽히는 모델도 있다 — 성공한 자리에서 목록을 한 번 다시 읽는다.
          void refreshModels();
        }
      });
    }, CODEX_AUTH_LOGIN_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [running, succeeded, refreshAuth, stopLogin, refreshModels]);

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
    if (!running || showTerminal) return;
    const id = setTimeout(() => {
      setScan((prev) => {
        if (!prev.url) setShowTerminal(true);
        return prev;
      });
    }, CODEX_AUTH_TERMINAL_REVEAL_MS);
    return () => clearTimeout(id);
  }, [running, showTerminal]);

  // PTY 출력 구독 — 이 로그인 터미널의 바이트만 훑는다.
  useEffect(() => {
    if (!transport || !running) return;
    const off = transport.onData(({ termId, data }) => {
      if (termId !== CODEX_AUTH_LOGIN_TERM_ID) return;
      bufferRef.current = (bufferRef.current + data).slice(-16_000);
      setScan(scanLoginOutput(bufferRef.current));
    });
    return off;
  }, [transport, running]);

  const handleStart = useCallback(async () => {
    if (!transport) {
      setStartError('no-transport');
      return;
    }
    setStartError(null);
    setScan({});
    setCode('');
    bufferRef.current = '';
    const bin = codexBinPath && codexBinPath.length > 0 ? codexBinPath : 'codex';
    const args = [/\s/.test(bin) ? `"${bin}"` : bin, 'login'];
    // 기기 코드 방식은 브라우저를 못 띄우는 환경(원격 세션 등)을 위한 갈래다.
    if (mode === 'device') args.push('--device-auth');
    const command = args.join(' ');
    setLoginCommand(command);
    const res = await transport.create({
      termId: CODEX_AUTH_LOGIN_TERM_ID,
      // 로그인은 프로젝트와 무관 — cwd 는 셸이 홈으로 떨어지게 빈 값을 준다.
      cwd: '',
      config: DEFAULT_AGENT_CONFIG,
      cols: 100,
      rows: 24,
      command,
      autoRun: true,
    }).catch(() => ({ ok: false, error: 'create-failed' }));
    if (!res.ok) {
      setStartError(res.error ?? 'create-failed');
      return;
    }
    setRunning(true);
  }, [transport, mode, codexBinPath]);

  const handleSendCode = useCallback(() => {
    const value = code.trim();
    if (!value || !transport) return;
    void transport.write(CODEX_AUTH_LOGIN_TERM_ID, `${value}\r`).catch(() => {});
    setCode('');
  }, [code, transport]);

  const handleOpenUrl = useCallback(() => {
    if (!scan.url) return;
    window.open(scan.url, '_blank', 'noopener,noreferrer');
  }, [scan.url]);

  const handleCopyUrl = useCallback(() => {
    if (!scan.url) return;
    void navigator.clipboard.writeText(scan.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    }).catch(() => {});
  }, [scan.url]);

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
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 18l6-6-6-6" />
              <path d="M8 6l-6 6 6 6" />
            </svg>
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
                            onClick={handleCopyUrl}
                            className="rounded-md border border-gray-700 px-3 py-1.5 text-[13px] text-gray-300 transition-colors hover:border-gray-600 hover:text-white"
                          >
                            {copied
                              ? t('panel.codexLogin.copied', { defaultValue: 'Copied' })
                              : t('panel.codexLogin.copyUrl', { defaultValue: 'Copy link' })}
                          </button>
                        </div>
                        <code className="truncate text-[12px] text-gray-500">{scan.url}</code>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950/60 px-3.5 py-3 text-[13px] text-gray-400">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                        {t('panel.codexLogin.starting', { defaultValue: 'Starting sign-in…' })}
                      </div>
                    )}

                    {scan.wantsCode && (
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

                    {scan.failed && (
                      <div className="rounded-lg border border-red-500/40 bg-red-500/5 px-3.5 py-2.5 text-[12px] text-red-300">
                        {t('panel.codexLogin.failed', { defaultValue: 'Sign-in did not complete. Check the terminal below and try again.' })}
                      </div>
                    )}
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
                {running && (
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
                    {showTerminal && <LoginTerminal termId={CODEX_AUTH_LOGIN_TERM_ID} command={loginCommand} />}
                  </div>
                )}
              </>
            )}
          </div>

          {!succeeded && (
            <div className="flex items-center justify-between gap-2 border-t border-gray-800 px-4 py-3">
              <button
                type="button"
                onClick={() => { void refreshAuth(); }}
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
                    {t('panel.codexLogin.start', { defaultValue: 'Sign in' })}
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
