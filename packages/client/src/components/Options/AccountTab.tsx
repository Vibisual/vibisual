import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClaudeAuthStatus } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';

const API_BASE = '';

/**
 * §4 v4.82 — 옵션창 Account 탭.
 *
 * 로그인한 계정을 보여주고 **로그아웃**을 여기서 한다(사용자 요청: "로그인 정보는 파일 옵션에 넣어서
 * 쉽게 로그아웃 가능하게"). 상태는 스냅샷 `claudeAuth` 를 그대로 읽고, 값이 늦게 올 수 있으니 탭을
 * 열 때 한 번 재조회한다.
 *
 * 자격증명은 우리가 만지지 않는다 — 로그아웃도 서버가 `claude auth logout` 을 대신 실행할 뿐이다.
 */
export function AccountTab(): React.JSX.Element {
  const { t } = useTranslation();
  const auth = useGraphStore((s) => s.claudeAuth);
  const applyClaudeAuth = useGraphStore((s) => s.applyClaudeAuth);
  const setLoginGate = useGraphStore((s) => s.setLoginGate);

  const [busy, setBusy] = useState<'refresh' | 'logout' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy('refresh');
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/status/refresh`, { method: 'POST' });
      if (res.ok) applyClaudeAuth(await res.json() as ClaudeAuthStatus);
    } catch {
      setError('refresh');
    } finally {
      setBusy(null);
    }
  }, [applyClaudeAuth]);

  // 탭을 열면 최신 상태로 한 번 맞춘다(밖에서 로그아웃했을 수도 있다).
  useEffect(() => { void refresh(); }, [refresh]);

  const handleLogout = useCallback(async () => {
    setBusy('logout');
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST' });
      const data = await res.json() as { ok: boolean; status?: ClaudeAuthStatus; error?: string };
      if (data.status) applyClaudeAuth(data.status);
      if (!data.ok) setError(data.error ?? 'logout');
    } catch {
      setError('logout');
    } finally {
      setBusy(null);
      setConfirming(false);
    }
  }, [applyClaudeAuth]);

  const loggedIn = auth?.loggedIn === true;
  const unknown = !auth || !!auth.error;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h4 className="text-sm font-semibold text-gray-200">
          {t('panel.options.categories.account', { defaultValue: 'Account' })}
        </h4>
        <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
          {t('panel.options.account.intro', {
            defaultValue: 'The Claude Code account Vibisual uses to run agents. Signing out here signs out Claude Code itself.',
          })}
        </p>
      </div>

      {/* 상태 카드 */}
      <div className={`flex flex-col gap-3 rounded-lg border px-4 py-3.5 ${
        loggedIn ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-gray-700 bg-gray-950/60'
      }`}>
        <div className="flex items-center gap-2.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${loggedIn ? 'bg-emerald-400' : unknown ? 'bg-amber-400' : 'bg-gray-500'}`} />
          <span className="text-[13px] font-semibold text-gray-100">
            {loggedIn
              ? auth?.email ?? t('panel.options.account.signedIn', { defaultValue: 'Signed in' })
              : unknown
                ? t('panel.options.account.unknown', { defaultValue: 'Could not check sign-in status' })
                : t('panel.options.account.signedOut', { defaultValue: 'Not signed in' })}
          </span>
          {loggedIn && auth?.subscriptionType && (
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
              {auth.subscriptionType}
            </span>
          )}
        </div>

        {loggedIn && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[11.5px]">
            <Row label={t('panel.options.account.email', { defaultValue: 'Email' })} value={auth?.email} />
            <Row label={t('panel.options.account.org', { defaultValue: 'Organization' })} value={auth?.orgName} />
            <Row label={t('panel.options.account.method', { defaultValue: 'Method' })} value={auth?.authMethod} />
            <Row label={t('panel.options.account.provider', { defaultValue: 'Provider' })} value={auth?.apiProvider} />
          </dl>
        )}

        {unknown && (
          <p className="text-[11px] text-amber-300/80">
            {t('panel.options.account.unknownDesc', {
              defaultValue: 'The claude binary did not answer. Check the Version tab to make sure Claude Code is installed.',
            })}
          </p>
        )}

        {error && (
          <p className="text-[11px] text-red-300">
            {t('panel.options.account.actionFailed', { defaultValue: 'That did not work. Try again.' })}
          </p>
        )}

        {/* 동작 — 로그인 / 로그아웃 / 새로고침 */}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {loggedIn ? (
            confirming ? (
              <>
                <span className="text-[11.5px] text-gray-300">
                  {t('panel.options.account.logoutConfirm', { defaultValue: 'Sign out of Claude Code?' })}
                </span>
                <button
                  type="button"
                  onClick={() => { void handleLogout(); }}
                  disabled={busy !== null}
                  className="rounded border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-500/20 disabled:opacity-50"
                >
                  {busy === 'logout'
                    ? t('panel.options.account.loggingOut', { defaultValue: 'Signing out…' })
                    : t('panel.options.account.logoutYes', { defaultValue: 'Sign out' })}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={busy !== null}
                  className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-50"
                >
                  {t('panel.options.account.logoutNo', { defaultValue: 'Keep me signed in' })}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700"
              >
                {t('panel.options.account.logout', { defaultValue: 'Sign out' })}
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={() => setLoginGate({ forced: true, dismissed: false })}
              className="rounded bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
            >
              {t('panel.options.account.login', { defaultValue: 'Sign in' })}
            </button>
          )}
          <button
            type="button"
            onClick={() => { void refresh(); }}
            disabled={busy !== null}
            className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-50"
          >
            {busy === 'refresh'
              ? t('panel.options.account.checking', { defaultValue: 'Checking…' })
              : t('panel.options.account.recheck', { defaultValue: 'Check again' })}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }): React.JSX.Element | null {
  if (!value) return null;
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className="truncate text-gray-300">{value}</dd>
    </>
  );
}
