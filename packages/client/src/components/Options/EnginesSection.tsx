import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CodexAuthStatus, CodexHookState } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { engineForGating } from '../Engine/engineChoiceFlow.js';

const API_BASE = '';

/** §5.25 (C)(I) — 옵션창 엔진 칸: 첫 관문의 질문을 언제든 다시 여는 자리. 세 줄은 같은 모양이다(하나만 특별하면 나머지가 곁다리로 읽힌다). */
export function EnginesSection(): React.JSX.Element {
  const { t } = useTranslation();
  const userDefaults = useGraphStore((s) => s.userDefaults);
  const setEngineChooser = useGraphStore((s) => s.setEngineChooser);

  const claudeSetup = useGraphStore((s) => s.claudeSetup);
  const claudeAuth = useGraphStore((s) => s.claudeAuth);
  const setSetupGate = useGraphStore((s) => s.setSetupGate);
  const setLoginGate = useGraphStore((s) => s.setLoginGate);

  const codexSetup = useGraphStore((s) => s.codexSetup);
  const codexAuth = useGraphStore((s) => s.codexAuth);
  const setCodexSetupGate = useGraphStore((s) => s.setCodexSetupGate);
  const setCodexLoginGate = useGraphStore((s) => s.setCodexLoginGate);
  const refreshCodexSetup = useGraphStore((s) => s.refreshCodexSetup);
  const refreshCodexAuth = useGraphStore((s) => s.refreshCodexAuth);
  const applyCodexAuth = useGraphStore((s) => s.applyCodexAuth);

  const localEngineInstalled = useGraphStore((s) => s.localLlm?.engine?.installed === true);
  const localModelCount = useGraphStore((s) => s.localLlm?.models?.length ?? 0);

  const defaultEngine = engineForGating(userDefaults?.engineChoice);
  const [codexBusy, setCodexBusy] = useState(false);

  // 이 칸을 열면 코덱스 판정을 한 번 맞춘다 — 앱 밖에서 깔거나 로그인했을 수 있다.
  useEffect(() => {
    void refreshCodexSetup();
    void refreshCodexAuth();
  }, [refreshCodexSetup, refreshCodexAuth]);

  const handleCodexLogout = useCallback(async () => {
    setCodexBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/codex-auth/logout`, { method: 'POST' });
      const data = await res.json() as { ok?: boolean; status?: CodexAuthStatus };
      if (data.status) applyCodexAuth(data.status);
    } catch {
      // 실패하면 상태가 그대로 남는다 — 로그아웃된 척하지 않는다.
    } finally {
      setCodexBusy(false);
    }
  }, [applyCodexAuth]);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h4 className="text-sm font-semibold text-gray-200">
          {t('panel.options.engines.title', { defaultValue: 'Engines' })}
        </h4>
        <p className="mt-1 text-[12px] leading-relaxed text-gray-500">
          {t('panel.options.engines.intro', {
            defaultValue: 'All three engines can be used side by side. The default only decides what a new agent starts as.',
          })}
        </p>
      </div>

      {/* 기본 엔진 — 첫 진입에서 고른 그 값이고, 여기서 다시 고를 수 있다. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-700 bg-gray-950/60 px-4 py-3">
        <span className="text-[12px] text-gray-500">
          {t('panel.options.engines.defaultLabel', { defaultValue: 'Default for new agents' })}
        </span>
        <span className="text-[13px] font-semibold text-gray-100">
          {t(`panel.engineChooser.${defaultEngine}.name`, {
            defaultValue: defaultEngine === 'claude' ? 'Claude Code' : defaultEngine === 'codex' ? 'Codex' : 'Local models',
          })}
        </span>
        <button
          type="button"
          onClick={() => setEngineChooser({ forced: true, dismissed: false })}
          className="ml-auto rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700"
        >
          {t('panel.options.engines.change', { defaultValue: 'Change' })}
        </button>
      </div>

      {/* 클로드 */}
      <EngineCard
        accent="sky"
        name={t('panel.engineChooser.claude.name', { defaultValue: 'Claude Code' })}
        ready={claudeSetup?.phase === 'ready'}
        readyLabel={claudeSetup?.version}
        signedIn={claudeAuth?.loggedIn === true}
        signedInLabel={claudeAuth?.email}
        unknownAuth={!claudeAuth || !!claudeAuth.error}
      >
        {claudeSetup?.phase !== 'ready' && (
          <CardButton onClick={() => setSetupGate({ forced: true, dismissed: false })} tone="sky">
            {t('panel.options.engines.install', { defaultValue: 'Install' })}
          </CardButton>
        )}
        {claudeAuth?.loggedIn !== true && (
          <CardButton onClick={() => setLoginGate({ forced: true, dismissed: false })} tone="sky">
            {t('panel.options.engines.signIn', { defaultValue: 'Sign in' })}
          </CardButton>
        )}
      </EngineCard>

      {/* 코덱스 */}
      <EngineCard
        accent="emerald"
        name={t('panel.engineChooser.codex.name', { defaultValue: 'Codex' })}
        ready={codexSetup?.phase === 'ready'}
        readyLabel={codexSetup?.version}
        signedIn={codexAuth?.loggedIn === true}
        signedInLabel={codexAuth?.account}
        unknownAuth={!codexAuth || !!codexAuth.error}
      >
        {codexSetup?.phase !== 'ready' && (
          <CardButton onClick={() => setCodexSetupGate({ forced: true, dismissed: false })} tone="emerald">
            {t('panel.options.engines.install', { defaultValue: 'Install' })}
          </CardButton>
        )}
        {codexSetup?.phase === 'ready' && codexAuth?.loggedIn !== true && (
          <CardButton onClick={() => setCodexLoginGate({ forced: true, dismissed: false })} tone="emerald">
            {t('panel.options.engines.signIn', { defaultValue: 'Sign in' })}
          </CardButton>
        )}
        {codexAuth?.loggedIn === true && (
          <CardButton onClick={() => { void handleCodexLogout(); }} disabled={codexBusy} tone="plain">
            {t('panel.options.engines.signOut', { defaultValue: 'Sign out' })}
          </CardButton>
        )}
      </EngineCard>

      {/* 코덱스 훅 — 앱 **밖에서** 돌린 코덱스 세션을 캔버스에 올린다. 기본 꺼짐. */}
      <CodexHooksToggle />

      {/* 로컬 */}
      <EngineCard
        accent="violet"
        name={t('panel.engineChooser.local.name', { defaultValue: 'Local models' })}
        ready={localEngineInstalled}
        readyLabel={localModelCount > 0
          ? t('panel.options.engines.localModels', { defaultValue: '{{count}} model(s)', count: localModelCount })
          : undefined}
        // 로컬은 계정이 없다 — 로그인 칸 자체를 그리지 않는다(빈 칸을 남기면 고장으로 읽힌다).
        signedIn={null}
        signedInLabel={undefined}
        unknownAuth={false}
      >
        <span className="text-[12px] text-gray-500">
          {t('panel.options.engines.localHint', {
            defaultValue: 'Right-click the canvas → All Model. Downloading the engine and models happens in that window.',
          })}
        </span>
      </EngineCard>
    </div>
  );
}

/**
 * §5.25 (I) — 코덱스 훅 켬/끔(켜면 앱 밖 코덱스 세션도 캔버스에). 기본 꺼짐 — 남의 전역 설정에 말없이 넣지 않는다.
 * 설치는 파일에 적기까지 — 코덱스는 사용자가 신뢰해야 새 훅을 돌리고 우리는 우회하지 않으므로, 남은 한 걸음을 화면이 말한다.
 */
export function CodexHooksToggle(): React.JSX.Element | null {
  const { t } = useTranslation();
  const hooks = useGraphStore((s) => s.codexHooks);
  const codexSetup = useGraphStore((s) => s.codexSetup);
  const setInstalled = useGraphStore((s) => s.setCodexHooksInstalled);
  const applyCodexHooks = useGraphStore((s) => s.applyCodexHooks);
  const [busy, setBusy] = useState(false);

  // 이 칸을 열면 현재 설치 상태를 한 번 읽는다(밖에서 파일을 고쳤을 수 있다).
  useEffect(() => {
    void fetch(`${API_BASE}/api/codex-hooks`)
      .then((r) => r.json() as Promise<CodexHookState>)
      .then((s) => { if (typeof s?.installed === 'boolean') applyCodexHooks(s); })
      .catch(() => {});
  }, [applyCodexHooks]);

  // 코덱스가 없으면 켤 것도 없다 — 없는 대상의 스위치를 두면 눌러도 아무 일이 없다.
  if (codexSetup?.phase !== 'ready') return null;

  const installed = hooks?.installed === true;
  const toggle = (): void => {
    setBusy(true);
    void setInstalled(!installed).finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-gray-700 bg-gray-950/60 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[13px] font-semibold text-gray-100">
            {t('panel.options.engines.codexHooks', { defaultValue: 'Show Codex sessions run outside Vibisual' })}
          </span>
          <span className="text-[12px] leading-relaxed text-gray-500">
            {t('panel.options.engines.codexHooksDesc', {
              defaultValue: 'Adds Vibisual hooks to your Codex config so sessions started in a terminal or editor also appear on the canvas.',
            })}
          </span>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className={`shrink-0 rounded border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
            installed
              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
              : 'border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700'
          }`}
        >
          {busy
            ? t('panel.options.engines.working', { defaultValue: 'Working…' })
            : installed
              ? t('panel.options.engines.hooksOn', { defaultValue: 'On' })
              : t('panel.options.engines.hooksOff', { defaultValue: 'Off' })}
        </button>
      </div>

      {installed && (
        <p className="text-[12px] leading-relaxed text-amber-300/80">
          {t('panel.options.engines.codexHooksTrust', {
            defaultValue: 'Codex asks you to trust new hooks once, the next time you start it. Until you accept, nothing is forwarded.',
          })}
        </p>
      )}
      {hooks?.error && (
        <p className="break-all font-mono text-[12px] text-red-300/80">{hooks.error}</p>
      )}
      {hooks?.hooksPath && (
        <p className="break-all font-mono text-[12px] text-gray-600">{hooks.hooksPath}</p>
      )}
    </div>
  );
}

const ACCENT_DOT: Record<string, string> = {
  sky: 'bg-sky-400',
  emerald: 'bg-emerald-400',
  violet: 'bg-violet-400',
};

function EngineCard({ accent, name, ready, readyLabel, signedIn, signedInLabel, unknownAuth, children }: {
  accent: string;
  name: string;
  ready: boolean;
  readyLabel?: string | undefined;
  /** `null` = 이 엔진에는 계정이라는 것이 없다(로컬). */
  signedIn: boolean | null;
  signedInLabel?: string | undefined;
  unknownAuth: boolean;
  children?: React.ReactNode;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-gray-700 bg-gray-950/60 px-4 py-3">
      <div className="flex items-center gap-2.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${ready ? (ACCENT_DOT[accent] ?? 'bg-gray-500') : 'bg-gray-600'}`} />
        <span className="text-[13px] font-semibold text-gray-100">{name}</span>
        <span className="text-[12px] text-gray-500">
          {ready
            ? readyLabel ?? t('panel.options.engines.installed', { defaultValue: 'Installed' })
            : t('panel.options.engines.notInstalled', { defaultValue: 'Not installed' })}
        </span>
        {signedIn !== null && (
          <span className={`text-[12px] ${signedIn ? 'text-emerald-400/80' : unknownAuth ? 'text-amber-400/80' : 'text-gray-500'}`}>
            {signedIn
              ? signedInLabel ?? t('panel.options.engines.signedIn', { defaultValue: 'Signed in' })
              : unknownAuth
                ? t('panel.options.engines.authUnknown', { defaultValue: 'Sign-in status unknown' })
                : t('panel.options.engines.signedOut', { defaultValue: 'Not signed in' })}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function CardButton({ onClick, children, tone, disabled }: {
  onClick: () => void;
  children: React.ReactNode;
  tone: 'sky' | 'emerald' | 'plain';
  disabled?: boolean;
}): React.JSX.Element {
  const cls = tone === 'sky'
    ? 'bg-sky-600 text-white hover:bg-sky-500'
    : tone === 'emerald'
      ? 'bg-emerald-600 text-white hover:bg-emerald-500'
      : 'border border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  );
}
