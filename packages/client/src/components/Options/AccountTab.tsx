import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentEngineKind, ClaudeAuthStatus, CodexAuthStatus } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { EngineIcon } from '../Engine/engineIcons.js';
import { ProviderTabs } from '../Engine/ProviderTabs.js';
import { MainProviderSelect } from './MainProviderSelect.js';
import { CodexHooksToggle } from './EnginesSection.js';

const API_BASE = '';

/**
 * §4 v4.82 · §5.25 (C)(E) — 옵션창 Account 탭.
 *
 * 로그인한 계정을 보여주고 **로그인·로그아웃을 여기서 한다**(사용자 요청: "로그인 정보는 파일
 * 옵션에 넣어서 쉽게 로그아웃 가능하게"). 상태는 스냅샷 `claudeAuth`·`codexAuth` 를 그대로 읽고,
 * 값이 늦게 올 수 있으니 탭을 열 때 한 번 재조회한다.
 *
 * **엔진이 둘이면 계정도 둘이다.** 클로드와 코덱스는 서로 다른 회사의 서로 다른 계정이고, 한쪽만
 * 이 화면에 있으면 나머지 하나는 "로그아웃할 자리가 없는 계정"이 된다 — §5.25 (C) 가 "고른 것은
 * 기본값이지 자물쇠가 아니다"로 세운 규율이 계정 화면에서도 지켜지려면 두 칸이 **같은 모양으로**
 * 나란히 서야 한다. 그래서 카드 한 벌(`AccountCard`)을 엔진별로 두 번 그린다.
 *
 * 자격증명은 우리가 만지지 않는다 — 로그아웃도 서버가 각 CLI 의 로그아웃 명령을 대신 실행할 뿐이다.
 */
export function AccountTab(): React.JSX.Element {
  const { t } = useTranslation();

  const main = useGraphStore(s => s.userDefaults?.engineChoice?.kind ?? 'claude');
  const [accountEngine, setAccountEngine] = useState(main);
  useEffect(() => setAccountEngine(main), [main]);
  const claudeSetup = useGraphStore(s => s.claudeSetup);
  const setSetupGate = useGraphStore(s => s.setSetupGate);
  const claudeAuth = useGraphStore((s) => s.claudeAuth);
  const applyClaudeAuth = useGraphStore((s) => s.applyClaudeAuth);
  const setLoginGate = useGraphStore((s) => s.setLoginGate);

  const codexAuth = useGraphStore((s) => s.codexAuth);
  const applyCodexAuth = useGraphStore((s) => s.applyCodexAuth);
  const setCodexLoginGate = useGraphStore((s) => s.setCodexLoginGate);
  const setCodexSetupGate = useGraphStore((s) => s.setCodexSetupGate);
  const codexSetup = useGraphStore((s) => s.codexSetup);

  const claude = useAccountActions('claude', applyClaudeAuth);
  const codex = useAccountActions('codex', applyCodexAuth);

  const claudeRefresh = claude.refresh;
  const codexRefresh = codex.refresh;
  // 탭을 열면 두 엔진 모두 최신 상태로 맞춘다(밖에서 로그아웃했을 수도 있다).
  useEffect(() => {
    void claudeRefresh();
    void codexRefresh();
  }, [claudeRefresh, codexRefresh]);

  // 코덱스가 안 깔려 있으면 로그인 창 대신 설치 창으로 보낸다 — 없는 CLI 에 로그인시킬 수는 없다.
  const codexReady = codexSetup?.phase === 'ready';

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h4 className="text-sm font-semibold text-gray-200">
          {t('panel.options.categories.account', { defaultValue: 'Account' })}
        </h4>
        <p className="mt-1 text-[12px] leading-relaxed text-gray-500">
          {t('panel.options.account.introEngines', {
            defaultValue: 'The accounts Vibisual uses to run agents. Signing out here signs out that CLI itself.',
          })}
        </p>
      </div>

      <MainProviderSelect />
      <ProviderTabs value={accountEngine} onChange={setAccountEngine} />
      {/* 클로드 계정 */}
      {accountEngine === 'claude' && <AccountCard
        engine="claude"
        title={t('panel.engineChooser.claude.name', { defaultValue: 'Claude Code' })}
        loggedIn={claudeAuth?.loggedIn === true}
        unknown={!claudeAuth || !!claudeAuth.error}
        primary={claudeAuth?.email}
        badge={claudeAuth?.subscriptionType}
        rows={[
          [t('panel.options.account.email', { defaultValue: 'Email' }), claudeAuth?.email],
          [t('panel.options.account.org', { defaultValue: 'Organization' }), claudeAuth?.orgName],
          [t('panel.options.account.method', { defaultValue: 'Method' }), claudeAuth?.authMethod],
          [t('panel.options.account.provider', { defaultValue: 'Provider' }), claudeAuth?.apiProvider],
        ]}
        unknownDesc={t('panel.options.account.unknownDesc', {
          defaultValue: 'The claude binary did not answer. Check the Version tab to make sure Claude Code is installed.',
        })}
        logoutConfirm={t('panel.options.account.logoutConfirm', { defaultValue: 'Sign out of Claude Code?' })}
        onLogin={() => { if (claudeSetup?.phase === 'missing' || claudeSetup?.phase === 'failed') setSetupGate({ forced: true, dismissed: false }); else setLoginGate({ forced: true, dismissed: false }); }}
        state={claude}
      />}

      {/* 코덱스 계정 — 위 칸과 같은 모양이어야 한다(§5.25 (B) "세 형제가 나란히 선다"). */}
      {accountEngine === 'codex' && <AccountCard
        engine="codex"
        title={t('panel.engineChooser.codex.name', { defaultValue: 'Codex' })}
        loggedIn={codexAuth?.loggedIn === true}
        unknown={!codexAuth || !!codexAuth.error}
        primary={codexAuth?.account}
        rows={[
          [t('panel.options.account.email', { defaultValue: 'Email' }), codexAuth?.account],
          [t('panel.options.account.method', { defaultValue: 'Method' }), codexAuth?.authMethod],
        ]}
        unknownDesc={codexReady
          ? t('panel.options.account.codexUnknownDesc', {
            defaultValue: 'The codex binary did not answer. Sign-in status is unknown, so nothing was changed.',
          })
          : t('panel.options.account.codexNotInstalled', {
            defaultValue: 'Codex is not installed yet. Install it first, then sign in.',
          })}
        logoutConfirm={t('panel.options.account.codexLogoutConfirm', { defaultValue: 'Sign out of Codex?' })}
        onLogin={() => {
          if (codexReady) setCodexLoginGate({ forced: true, dismissed: false });
          else setCodexSetupGate({ forced: true, dismissed: false });
        }}
        loginLabel={codexReady ? undefined : t('panel.options.engines.install', { defaultValue: 'Install' })}
        state={codex}
      />}
      {accountEngine === 'local' && <p className="text-xs text-gray-400">{t('providers.localUsage')}</p>}

      {/* §5.25 (C)(I) — 엔진 칸. 첫 진입 관문이 물어본 것과 같은 질문을 언제든 다시 열 수 있는
          자리에 둔다 — 이 칸이 있어야 "고른 것은 기본값이지 자물쇠가 아니다"가 말뿐이 아니게 된다. */}
      <div className="border-t border-gray-800 pt-4">
        {accountEngine === 'codex' && <CodexHooksToggle />}
        {accountEngine === 'local' && <p className="text-xs text-gray-400">{t('panel.options.engines.localHint')}</p>}
      </div>
    </div>
  );
}

/** 카드 한 벌이 쓰는 동작 묶음. 두 엔진이 **같은 코드**로 돌게 여기서 한 번만 짓는다. */
interface AccountActions {
  busy: 'refresh' | 'logout' | null;
  error: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

/** 엔진별 REST 창구. 경로가 대칭이 아니라서(클로드는 `/status/refresh`) 표로 갖는다. */
const AUTH_ENDPOINTS: Record<'claude' | 'codex', { refresh: string; logout: string }> = {
  claude: { refresh: '/api/auth/status/refresh', logout: '/api/auth/logout' },
  codex: { refresh: '/api/codex-auth/refresh', logout: '/api/codex-auth/logout' },
};

/**
 * 상태 재조회·로그아웃 두 창구를 엔진 하나로 묶는다.
 *
 * 두 서버 창구의 응답 모양이 이미 같아서(`{ ok, status }`) 화면 쪽이 갈라질 이유가 없다 —
 * 갈라 두면 한쪽만 고쳐지는 날이 온다.
 */
function useAccountActions<S extends ClaudeAuthStatus | CodexAuthStatus>(
  engine: 'claude' | 'codex',
  apply: (status: S) => void,
): AccountActions {
  const [busy, setBusy] = useState<'refresh' | 'logout' | null>(null);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    setBusy('refresh');
    setError(false);
    try {
      const res = await fetch(`${API_BASE}${AUTH_ENDPOINTS[engine].refresh}`, { method: 'POST' });
      if (!res.ok) throw new Error('refresh failed');
      apply(await res.json() as S);
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }, [engine, apply]);

  const logout = useCallback(async () => {
    setBusy('logout');
    setError(false);
    try {
      const res = await fetch(`${API_BASE}${AUTH_ENDPOINTS[engine].logout}`, { method: 'POST' });
      const data = await res.json() as { ok?: boolean; status?: S; error?: string };
      if (data.status) apply(data.status);
      if (!res.ok || data.ok === false) setError(true);
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }, [engine, apply]);

  return { busy, error, refresh, logout };
}

/**
 * 엔진 하나의 계정 칸.
 *
 * 아이콘 → 이름 → 상태 → 세부 → 버튼의 순서를 두 엔진이 공유한다. 로그인돼 있으면 초록,
 * 판정 불가는 노랑(§5.25 (E) "모름은 로그아웃이 아니다"), 로그아웃은 회색이다.
 */
function AccountCard({ engine, title, loggedIn, unknown, primary, badge, rows, unknownDesc, logoutConfirm, onLogin, loginLabel, state }: {
  engine: AgentEngineKind;
  title: string;
  loggedIn: boolean;
  unknown: boolean;
  primary?: string | undefined;
  badge?: string | undefined;
  rows: [string, string | undefined][];
  unknownDesc: string;
  logoutConfirm: string;
  onLogin: () => void;
  /** 로그인 버튼 글자를 갈아 끼울 때만(예: 코덱스 미설치 → "설치"). */
  loginLabel?: string | undefined;
  state: AccountActions;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const { busy, error } = state;

  // 로그아웃되면 확인 문구를 접는다 — 밖에서 로그아웃된 뒤에도 "정말?"이 남아 있으면 안 된다.
  useEffect(() => { if (!loggedIn) setConfirming(false); }, [loggedIn]);

  const accentText = engine === 'codex' ? 'text-emerald-400' : 'text-sky-400';

  return (
    <div className={`flex flex-col gap-3 rounded-lg border px-4 py-3.5 ${
      loggedIn ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-gray-700 bg-gray-950/60'
    }`}>
      <div className="flex items-center gap-2.5">
        <span className={`shrink-0 ${loggedIn ? accentText : 'text-gray-600'}`}>
          <EngineIcon kind={engine} className="h-5 w-5" />
        </span>
        <span className="shrink-0 text-[13px] font-semibold text-gray-100">{title}</span>
        <span className={`h-2 w-2 shrink-0 rounded-full ${loggedIn ? 'bg-emerald-400' : unknown ? 'bg-amber-400' : 'bg-gray-500'}`} />
        <span className="min-w-0 truncate text-[12px] text-gray-400">
          {loggedIn
            ? primary ?? t('panel.options.account.signedIn', { defaultValue: 'Signed in' })
            : unknown
              ? t('panel.options.account.unknown', { defaultValue: 'Could not check sign-in status' })
              : t('panel.options.account.signedOut', { defaultValue: 'Not signed in' })}
        </span>
        {loggedIn && badge && (
          <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[12px] font-semibold uppercase tracking-wider text-emerald-300">
            {badge}
          </span>
        )}
      </div>

      {loggedIn && rows.some(([, v]) => !!v) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
          {rows.map(([label, value]) => <Row key={label} label={label} value={value} />)}
        </dl>
      )}

      {unknown && <p className="text-[12px] text-amber-300/80">{unknownDesc}</p>}

      {error && (
        <p className="text-[12px] text-red-300">
          {t('panel.options.account.actionFailed', { defaultValue: 'That did not work. Try again.' })}
        </p>
      )}

      {/* 동작 — 로그인 / 로그아웃 / 새로고침 */}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        {loggedIn ? (
          confirming ? (
            <>
              <span className="text-[12px] text-gray-300">{logoutConfirm}</span>
              <button
                type="button"
                onClick={() => { void state.logout(); }}
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
            onClick={onLogin}
            className={`rounded px-3 py-1.5 text-xs font-medium text-white ${
              engine === 'codex' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-violet-600 hover:bg-violet-500'
            }`}
          >
            {loginLabel ?? t('panel.options.account.login', { defaultValue: 'Sign in' })}
          </button>
        )}
        <button
          type="button"
          onClick={() => { void state.refresh(); }}
          disabled={busy !== null}
          className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-50"
        >
          {busy === 'refresh'
            ? t('panel.options.account.checking', { defaultValue: 'Checking…' })
            : t('panel.options.account.recheck', { defaultValue: 'Check again' })}
        </button>
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
