import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_AGENT_CONFIG } from '@vibisual/shared';
import type { PackagedTerminalApi } from '../../transport/install-packaged-transport.js';
import { scanLoginOutput, type LoginScan } from './loginOutput.js';
interface LoginAuthStatus { loggedIn: boolean }
interface LoginLaunch { command: string; env?: Record<string, string> }
const noAfterLogin = async (): Promise<void> => {};

interface LoginAttempt {
  termId: string;
  active: boolean;
  ending: boolean;
  dispose: () => void;
  pending?: Promise<LoginAuthStatus | null>;
}

const LOGIN_OUTPUT_LIMIT = 16_000;

/** Owns one login attempt, including events emitted before create() resolves. */
export function useLoginSession(
  transport: PackagedTerminalApi | null,
  refreshAuth: () => Promise<LoginAuthStatus | null>,
  termIdPrefix: string,
  pollIntervalMs: number,
  refreshModels: () => Promise<unknown> = noAfterLogin,
) {
  const [running, setRunning] = useState(false);
  const [checking, setChecking] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [scan, setScan] = useState<LoginScan>({});
  const [startError, setStartError] = useState<string | null>(null);
  const [terminal, setTerminal] = useState<{ termId: string; command: string; env?: Record<string, string> } | null>(null);
  const current = useRef<LoginAttempt | null>(null);
  const epoch = useRef(0);

  const release = useCallback((attempt: LoginAttempt): void => {
    attempt.active = false;
    attempt.dispose();
    // Per-attempt IDs prevent a late kill/create/exit from touching the next try.
    void transport?.kill(attempt.termId).catch(() => {});
    if (current.current === attempt) current.current = null;
  }, [transport]);

  const stop = useCallback((): void => {
    epoch.current += 1;
    if (current.current) release(current.current);
    setRunning(false);
    setChecking(false);
    setSucceeded(false);
    setScan({});
    setStartError(null);
    setTerminal(null);
  }, [release]);

  useEffect(() => () => {
    epoch.current += 1;
    if (current.current) release(current.current);
  }, [release]);

  const complete = useCallback((attempt: LoginAttempt): void => {
    if (!attempt.active || current.current !== attempt) return;
    release(attempt);
    setRunning(false);
    setChecking(false);
    setScan({});
    setStartError(null);
    setSucceeded(true);
    void refreshModels().catch(() => {});
  }, [release, refreshModels]);

  const check = useCallback(async (attempt: LoginAttempt): Promise<void> => {
    if (!attempt.active || attempt.ending || attempt.pending) return;
    const pending = refreshAuth().catch(() => null);
    attempt.pending = pending;
    const status = await pending;
    if (attempt.pending === pending) attempt.pending = undefined;
    if (status?.loggedIn) complete(attempt);
  }, [refreshAuth, complete]);

  const finish = useCallback(async (attempt: LoginAttempt): Promise<void> => {
    if (!attempt.active || attempt.ending) return;
    attempt.ending = true;
    attempt.dispose();
    void transport?.kill(attempt.termId).catch(() => {});
    setChecking(true);
    // Expired URLs and device codes must not remain actionable. Exit itself is
    // not a failed login: confirm status before presenting success or retry.
    setScan({});
    await attempt.pending;
    if (!attempt.active || current.current !== attempt) return;
    const status = await refreshAuth().catch(() => null);
    if (!attempt.active || current.current !== attempt) return;
    if (status?.loggedIn) complete(attempt);
    else {
      release(attempt);
      setRunning(false);
      setChecking(false);
      setScan({ failed: true });
    }
  }, [transport, refreshAuth, complete, release]);

  const start = useCallback(async (launch: LoginLaunch, scanOptions: { deviceAuth?: boolean } = {}): Promise<void> => {
    if (current.current?.active && !current.current.ending) return;
    epoch.current += 1;
    if (current.current) release(current.current);
    if (!transport) {
      setStartError('no-transport');
      return;
    }
    // LAN HTTP clients may not expose randomUUID (a secure-context API). This is
    // a resource ID, not an authentication token, so a per-attempt nonce suffices.
    const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const termId = `${termIdPrefix}:${nonce}`;
    const attempt: LoginAttempt = { termId, active: true, ending: false, dispose: () => {} };
    current.current = attempt;
    setScan({});
    setStartError(null);
    setSucceeded(false);
    setRunning(true);
    setChecking(false);
    setTerminal({ termId, ...launch });
    let buffer = '';
    // Subscribe before create: a fast CLI may print its URL or fail before IPC replies.
    const offData = transport.onData((event) => {
      if (!attempt.active || attempt.ending || event.termId !== termId) return;
      buffer = (buffer + event.data).slice(-LOGIN_OUTPUT_LIMIT);
      const next = scanLoginOutput(buffer, scanOptions);
      setScan(next);
      if (next.failed) void finish(attempt);
      else if (next.succeeded) void check(attempt);
    });
    const offExit = transport.onExit((event) => {
      if (event.termId === termId) void finish(attempt);
    });
    const timer = setInterval(() => { void check(attempt); }, pollIntervalMs);
    attempt.dispose = (): void => { offData(); offExit(); clearInterval(timer); };
    const result = await transport.create({
      termId, cwd: '', config: DEFAULT_AGENT_CONFIG, cols: 100, rows: 24,
      ...launch, autoRun: true,
    }).catch(() => ({ ok: false, error: 'create-failed' }));
    if (!attempt.active || attempt.ending || current.current !== attempt) {
      // A close while create was in flight must also reap the late-created PTY.
      void transport.kill(termId).catch(() => {});
      return;
    }
    if (!result.ok) {
      release(attempt);
      setRunning(false);
      setChecking(false);
      setStartError(result.error ?? 'create-failed');
    }
  }, [transport, release, finish, check, termIdPrefix, pollIntervalMs]);

  const recheck = useCallback(async (): Promise<void> => {
    const attempt = current.current;
    if (attempt) await check(attempt);
    else {
      const requestEpoch = epoch.current;
      const status = await refreshAuth().catch(() => null);
      if (requestEpoch !== epoch.current || !status?.loggedIn) return;
      setScan({});
      setStartError(null);
      setSucceeded(true);
      void refreshModels().catch(() => {});
    }
  }, [check, refreshAuth, refreshModels]);

  return { running, checking, succeeded, scan, startError, terminal, start, stop, recheck, setSucceeded };
}
