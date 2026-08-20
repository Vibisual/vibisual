import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  CLAUDE_AUTH_LOGIN_TERM_ID,
  CLAUDE_AUTH_LOGIN_POLL_INTERVAL_MS,
  CLAUDE_AUTH_TERMINAL_REVEAL_MS,
  DEFAULT_AGENT_CONFIG,
} from '@vibisual/shared';
import type { ClaudeAuthLoginMode, ClaudeAuthStatus } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { getTerminalTransport } from '../../transport/terminalTransport.js';
import { LoginTerminal } from './LoginTerminal.js';
import { scanLoginOutput, type LoginScan } from './loginOutput.js';

const Z = 100_600; // ClaudeVersionGate(100_500) 보다 위 — 로그인이 안 되면 버전 갱신도 의미가 없다.
const API_BASE = '';

/**
 * §4 v4.82 — 앱 안 Claude 로그인 팝업.
 *
 * 그동안 로그인은 앱 밖 cmd 창(`claude` → `/login`)에서만 됐다. 이 창은 **새 인증 레일이 아니라**
 * 기존 조각의 조합이다: 상태는 서버 `claude auth status`(스냅샷 `claudeAuth`), 실행은 기존 임베디드
 * PTY(§4 v2.63 terminalManager 의 §5.5 #17-20 ④ v4.74 실행 런처 갈래)로 `claude auth login` 을 돌린다.
 *
 * 화면 규칙:
 *  - `loggedIn === false && !error` 일 때만 자동으로 뜬다. `error`(CLI 미발견·타임아웃·파싱실패)는
 *    "로그아웃"이 아니라 **"모름"** 이라 모달로 앱을 막지 않는다.
 *  - PTY 출력을 훑어 **OAuth URL → 버튼**, **코드 요구 → 입력칸**으로 바꿔 보여준다.
 *  - 성공 판정의 1차 근거는 출력 문구가 아니라 **`auth status` 재조회**(로그인 중 3초 폴링)다.
 *    CLI 출력 포맷이 바뀌어도 안 깨지게 하기 위함.
 *  - URL 을 제때 못 찾으면 같은 PTY 를 터미널로 자동 펼친다 — 어떤 경우에도 앱 밖으로 나갈 일이 없다.
 */
export function LoginWindow(): React.JSX.Element | null {
  const { t } = useTranslation();
  const auth = useGraphStore((s) => s.claudeAuth);
  const dismissed = useGraphStore((s) => s.loginGateDismissed);
  const forced = useGraphStore((s) => s.loginGateForced);
  const setLoginGate = useGraphStore((s) => s.setLoginGate);
  const applyClaudeAuth = useGraphStore((s) => s.applyClaudeAuth);
  // PATH 의 `claude` 가 아니라 **앱이 실제로 쓰는 바이너리**로 로그인해야 자격증명이 같은 곳에 남는다
  // (VS Code 확장 번들 등 PATH 밖 설치 — §5.7 #23-1 resolveClaudeBin 이 고른 경로).
  const claudeBinPath = useGraphStore((s) => s.claudeVersion?.binPath);

  const [mode, setMode] = useState<ClaudeAuthLoginMode>('claudeai');
  const [email, setEmail] = useState('');
  const [running, setRunning] = useState(false);
  const [scan, setScan] = useState<LoginScan>({});
  const [code, setCode] = useState('');
  const [showTerminal, setShowTerminal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  /** 실행한 로그인 명령 — 터미널 폴백이 (PTY 가 이미 죽었을 때) 같은 명령으로 다시 뜨게 넘긴다. */
  const [loginCommand, setLoginCommand] = useState<string | undefined>(undefined);
  /** PTY 출력 누적 — URL/코드 요구는 여러 청크에 걸쳐 올 수 있어 합쳐서 훑는다. */
  const bufferRef = useRef('');

  const transport = useMemo(() => getTerminalTransport(), []);
  const shouldOpen = forced || (auth !== null && !auth.loggedIn && !auth.error && !dismissed);

  /** 상태 재조회 — 로그인 성공의 진짜 판정. */
  const refreshStatus = useCallback(async (): Promise<ClaudeAuthStatus | null> => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/status/refresh`, { method: 'POST' });
      if (!res.ok) return null;
      const next = await res.json() as ClaudeAuthStatus;
      applyClaudeAuth(next);
      return next;
    } catch {
      return null;
    }
  }, [applyClaudeAuth]);

  /** 로그인 PTY 종료 + 로컬 진행 상태 초기화. */
  const stopLogin = useCallback(() => {
    setRunning(false);
    setScan({});
    setCode('');
    setShowTerminal(false);
    bufferRef.current = '';
    void transport?.kill(CLAUDE_AUTH_LOGIN_TERM_ID).catch(() => {});
  }, [transport]);

  // 창이 닫히면 진행 중이던 로그인 PTY 도 함께 정리한다(뒤에 유령 프로세스가 남지 않게).
  useEffect(() => {
    if (!shouldOpen && running) stopLogin();
  }, [shouldOpen, running, stopLogin]);

  // 로그인 진행 중 상태 폴링 — 브라우저에서 승인이 끝나는 순간을 잡는다.
  useEffect(() => {
    if (!running || succeeded) return;
    const id = setInterval(() => {
      void refreshStatus().then((next) => {
        if (next?.loggedIn) {
          setSucceeded(true);
          stopLogin();
        }
      });
    }, CLAUDE_AUTH_LOGIN_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [running, succeeded, refreshStatus, stopLogin]);

  // 성공 표시 후 잠깐 뒤 자동 닫기(ClaudeVersionGate 의 설치 완료 처리와 같은 결).
  useEffect(() => {
    if (!succeeded) return;
    const id = setTimeout(() => {
      setSucceeded(false);
      setLoginGate({ forced: false });
    }, 1_200);
    return () => clearTimeout(id);
  }, [succeeded, setLoginGate]);

  // URL 을 제때 못 찾으면 터미널을 펼친다 — 우리가 모르는 프롬프트가 떠도 사용자가 직접 응답 가능.
  useEffect(() => {
    if (!running || showTerminal) return;
    const id = setTimeout(() => {
      setScan((prev) => {
        if (!prev.url) setShowTerminal(true);
        return prev;
      });
    }, CLAUDE_AUTH_TERMINAL_REVEAL_MS);
    return () => clearTimeout(id);
  }, [running, showTerminal]);

  // PTY 출력 구독 — 로그인 터미널의 바이트만 골라 훑는다.
  useEffect(() => {
    if (!transport || !running) return;
    const off = transport.onData(({ termId, data }) => {
      if (termId !== CLAUDE_AUTH_LOGIN_TERM_ID) return;
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
    const bin = claudeBinPath && claudeBinPath.length > 0 ? claudeBinPath : 'claude';
    const args = [/\s/.test(bin) ? `"${bin}"` : bin, 'auth', 'login', mode === 'console' ? '--console' : '--claudeai'];
    if (email.trim()) args.push('--email', email.trim());
    const command = args.join(' ');
    setLoginCommand(command);
    const res = await transport.create({
      termId: CLAUDE_AUTH_LOGIN_TERM_ID,
      // 로그인은 프로젝트와 무관 — cwd 는 셸이 알아서 홈으로 떨어지게 빈 값을 준다.
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
  }, [transport, mode, email, claudeBinPath]);

  const handleSendCode = useCallback(() => {
    const value = code.trim();
    if (!value || !transport) return;
    void transport.write(CLAUDE_AUTH_LOGIN_TERM_ID, `${value}\r`).catch(() => {});
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
          className="pointer-events-auto flex max-h-[90vh] w-[600px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-violet-500/40 bg-gray-900 shadow-2xl"
          style={{ boxShadow: '0 0 0 1px rgba(139,92,246,0.2), 0 25px 50px -12px rgba(0,0,0,0.85), 0 0 40px -8px rgba(139,92,246,0.4)' }}
        >
          {/* 헤더 */}
          <div className="flex items-center gap-2.5 border-b border-gray-800 px-4 py-3">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-violet-400" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <path d="M10 17l5-5-5-5" />
              <path d="M15 12H3" />
            </svg>
            <h3 className="flex-1 text-sm font-bold text-gray-100">
              {t('panel.login.title', { defaultValue: 'Sign in to Claude' })}
            </h3>
            {auth?.error && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[12px] font-semibold uppercase tracking-wider text-amber-300">
                {auth.error}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-3 overflow-y-auto px-4 py-3.5">
            {succeeded ? (
              <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3.5 py-3 text-sm text-emerald-200">
                <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                {t('panel.login.success', { defaultValue: 'Signed in. Closing…' })}
              </div>
            ) : (
              <>
                <p className="text-[13px] leading-relaxed text-gray-400">
                  {t('panel.login.intro', {
                    defaultValue: 'Vibisual runs agents with your Claude Code account. Sign in here — no separate terminal needed.',
                  })}
                </p>

                {/* 방식 선택 — 시작 전에만 바꿀 수 있다(진행 중 변경은 PTY 인자와 어긋난다). */}
                {!running && (
                  <div className="flex flex-col gap-2">
                    <ModeCard
                      active={mode === 'claudeai'}
                      onClick={() => setMode('claudeai')}
                      title={t('panel.login.modeSubscription', { defaultValue: 'Claude subscription' })}
                      desc={t('panel.login.modeSubscriptionDesc', { defaultValue: 'Pro / Max plan — usage counts against your plan.' })}
                    />
                    <ModeCard
                      active={mode === 'console'}
                      onClick={() => setMode('console')}
                      title={t('panel.login.modeConsole', { defaultValue: 'Anthropic Console' })}
                      desc={t('panel.login.modeConsoleDesc', { defaultValue: 'API account — usage is billed per token.' })}
                    />
                    <label className="mt-0.5 flex flex-col gap-1">
                      <span className="text-[12px] text-gray-500">
                        {t('panel.login.emailLabel', { defaultValue: 'Email (optional — prefills the sign-in page)' })}
                      </span>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="rounded-md border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-[13px] text-gray-200 outline-none placeholder:text-gray-600 focus:border-violet-500/60"
                      />
                    </label>
                  </div>
                )}

                {/* 진행 중 — 추출한 URL / 코드 입력 */}
                {running && (
                  <div className="flex flex-col gap-2.5">
                    {scan.url ? (
                      <div className="flex flex-col gap-2 rounded-lg border border-violet-500/30 bg-violet-500/5 px-3.5 py-3">
                        <span className="text-[13px] text-violet-200">
                          {t('panel.login.openBrowser', { defaultValue: 'Approve the sign-in in your browser, then come back here.' })}
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={handleOpenUrl}
                            className="rounded-md bg-violet-600 px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-violet-500"
                          >
                            {t('panel.login.openBrowserBtn', { defaultValue: 'Open in browser' })}
                          </button>
                          <button
                            type="button"
                            onClick={handleCopyUrl}
                            className="rounded-md border border-gray-700 px-3 py-1.5 text-[13px] text-gray-300 transition-colors hover:border-gray-600 hover:text-white"
                          >
                            {copied
                              ? t('panel.login.copied', { defaultValue: 'Copied' })
                              : t('panel.login.copyUrl', { defaultValue: 'Copy link' })}
                          </button>
                        </div>
                        <code className="truncate text-[12px] text-gray-500">{scan.url}</code>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950/60 px-3.5 py-3 text-[13px] text-gray-400">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-violet-400" />
                        {t('panel.login.starting', { defaultValue: 'Starting sign-in…' })}
                      </div>
                    )}

                    {scan.wantsCode && (
                      <div className="flex flex-col gap-1.5 rounded-lg border border-gray-700 bg-gray-950/60 px-3.5 py-3">
                        <span className="text-[12px] text-gray-300">
                          {t('panel.login.codePrompt', { defaultValue: 'Paste the code shown in your browser.' })}
                        </span>
                        <div className="flex items-center gap-2">
                          <input
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleSendCode(); }}
                            placeholder={t('panel.login.codePlaceholder', { defaultValue: 'Authorization code' })}
                            className="min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-900 px-2.5 py-1.5 font-mono text-[13px] text-gray-200 outline-none placeholder:text-gray-600 focus:border-violet-500/60"
                          />
                          <button
                            type="button"
                            onClick={handleSendCode}
                            disabled={!code.trim()}
                            className="rounded-md bg-violet-600 px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
                          >
                            {t('panel.login.sendCode', { defaultValue: 'Send' })}
                          </button>
                        </div>
                      </div>
                    )}

                    {scan.failed && (
                      <div className="rounded-lg border border-red-500/40 bg-red-500/5 px-3.5 py-2.5 text-[12px] text-red-300">
                        {t('panel.login.failed', { defaultValue: 'Sign-in did not complete. Check the terminal below and try again.' })}
                      </div>
                    )}
                  </div>
                )}

                {startError && (
                  <div className="rounded-lg border border-red-500/40 bg-red-500/5 px-3.5 py-2.5 text-[12px] text-red-300">
                    {startError === 'no-transport'
                      ? t('panel.login.noTerminal', {
                        defaultValue: 'This window cannot run a terminal here. Open Vibisual on the desktop app to sign in.',
                      })
                      : t('panel.login.startFailed', { defaultValue: 'Could not start the sign-in process.' })}
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
                      {t('panel.login.showTerminal', { defaultValue: 'Terminal' })}
                    </button>
                    {showTerminal && <LoginTerminal termId={CLAUDE_AUTH_LOGIN_TERM_ID} command={loginCommand} />}
                  </div>
                )}
              </>
            )}
          </div>

          {/* 푸터 */}
          {!succeeded && (
            <div className="flex items-center justify-between gap-2 border-t border-gray-800 px-4 py-3">
              <button
                type="button"
                onClick={() => { void refreshStatus(); }}
                className="text-[12px] text-gray-500 transition-colors hover:text-gray-300"
              >
                {t('panel.login.recheck', { defaultValue: 'Check again' })}
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
                  {t('panel.login.later', { defaultValue: 'Later' })}
                </button>
                {running ? (
                  <button
                    type="button"
                    onClick={stopLogin}
                    className="rounded-md border border-gray-700 px-3 py-1.5 text-[13px] text-gray-300 transition-colors hover:border-gray-600 hover:text-white"
                  >
                    {t('panel.login.stop', { defaultValue: 'Stop' })}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => { void handleStart(); }}
                    className="rounded-md bg-violet-600 px-4 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-violet-500"
                  >
                    {t('panel.login.start', { defaultValue: 'Sign in' })}
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
          ? 'border-violet-500/60 bg-violet-500/10'
          : 'border-gray-800 bg-gray-950/50 hover:border-gray-700'
      }`}
    >
      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${active ? 'border-violet-400' : 'border-gray-600'}`}>
        {active && <span className="h-2 w-2 rounded-full bg-violet-400" />}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className={`text-[13px] font-semibold ${active ? 'text-violet-100' : 'text-gray-300'}`}>{title}</span>
        <span className="text-[12px] text-gray-500">{desc}</span>
      </span>
    </button>
  );
}
