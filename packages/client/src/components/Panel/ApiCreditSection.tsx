import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  API_CREDIT_DEFAULTS,
  type ApiCreditSettings,
  type ApiCreditState,
  type ApiKeyShapeProblem,
} from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';

// SCENARIO §4 API 크레딧 — 구독 한도가 막히면 Console 크레딧으로 잇는 경로 설정만 맡는다. 금액·한도·잔액은 Console 이 정한다(앱 장부·한도 입력 ❌).
// 값은 스냅샷 `apiCredits` 를 그리고 바꾸는 손은 REST 뿐, 키 본문은 화면에 오지 않는다.

const API_BASE = '';

/** Console 의 키 만들기 화면. 밖 브라우저로 넘긴다(앱 안에서 남의 로그인 페이지를 열지 않는다 — §5.23 경계). */
const CONSOLE_KEYS_URL = 'https://platform.claude.com/settings/keys';

function openExternal(url: string): void {
  try { window.open(url, '_blank', 'noopener,noreferrer'); } catch { /* main 이 ExternalOpenNotice 로 알린다 */ }
}

/** 서버 응답(새 상태)을 스토어에 싣는다. 스냅샷도 곧 같은 값을 들고 오지만 누른 손에 바로 답한다. */
export function applyApiCreditState(state: ApiCreditState | undefined): void {
  if (state) useGraphStore.getState().applyApiCredits(state);
}

export async function sendApiCredit(method: 'PUT' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<{ ok: boolean; data: unknown }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  let data: unknown = null;
  try { data = await res.json(); } catch { /* 본문 없는 응답 */ }
  return { ok: res.ok, data };
}

/** 모양이 틀린 키의 사유 → 문장 키. 실행용·지출용 칸이 같은 문장을 쓴다. */
export function keyProblemKey(problem: ApiKeyShapeProblem): string {
  const name = problem === 'not-anthropic' ? 'notAnthropic' : problem === 'admin-key' ? 'adminKey' : problem === 'oauth-token' ? 'oauthToken' : problem;
  return `panel.usage.apiCredit.keyProblem.${name}`;
}

/** 켜기/끄기 한 줄 — 지금 곧바로 켜고 끄는 손잡이라 `role="switch"`(체크박스 ❌). */
function SwitchRow({ label, hint, checked, disabled, onChange }: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-2.5 rounded px-1 py-1.5 text-left transition-colors hover:bg-gray-800/60 disabled:opacity-50 pointer-coarse:py-2.5"
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-gray-700'}`}
      >
        <span className={`h-3 w-3 rounded-full bg-white transition-transform ${checked ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs font-medium text-gray-200">{label}</span>
        <span className="text-[12px] leading-relaxed text-gray-500">{hint}</span>
      </span>
    </button>
  );
}

function ExternalIcon(): React.JSX.Element {
  return (
    <svg className="h-3 w-3 shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

export function ApiCreditSection({ variant = 'popup' }: { variant?: 'popup' | 'options' }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const state = useGraphStore((s) => s.apiCredits);
  const [failed, setFailed] = useState(false);
  /** 서버 답이 오기 전까지 누른 값을 붙든다 — 그 사이 스냅샷이 옛 값을 싣고 와도 화면이 되돌아가지 않게. */
  const [held, setHeld] = useState<Partial<ApiCreditSettings>>({});
  const [keyDraft, setKeyDraft] = useState('');
  const [keyProblem, setKeyProblem] = useState<ApiKeyShapeProblem | 'failed' | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);

  // 처음 열 때 한 번 최신 상태를 받는다(스냅샷이 아직 없을 수 있다). 서버는 이때 Console 지출이 오래됐으면 다시 읽는다.
  useEffect(() => {
    let alive = true;
    void fetch(`${API_BASE}/api/api-credits`)
      .then(async (res) => { if (alive && res.ok) applyApiCreditState(await res.json() as ApiCreditState); })
      .catch(() => { /* 스냅샷이 곧 싣고 온다 */ });
    return () => { alive = false; };
  }, []);

  const settings: ApiCreditSettings = useMemo(
    () => ({ ...(state?.settings ?? API_CREDIT_DEFAULTS), ...held }),
    [state?.settings, held],
  );

  const patch = useCallback((next: Partial<ApiCreditSettings>): void => {
    setFailed(false);
    setHeld((h) => ({ ...h, ...next }));
    void sendApiCredit('PUT', '/api/api-credits/settings', next)
      .then(({ ok, data }) => {
        if (ok) applyApiCreditState(data as ApiCreditState); else setFailed(true);
      })
      .catch(() => setFailed(true))
      .finally(() => setHeld((h) => {
        const rest = { ...h };
        for (const k of Object.keys(next) as (keyof ApiCreditSettings)[]) delete rest[k];
        return rest;
      }));
  }, []);

  const action = useCallback((method: 'POST' | 'DELETE', path: string): void => {
    setFailed(false);
    void sendApiCredit(method, path)
      .then(({ ok, data }) => { if (ok) applyApiCreditState(data as ApiCreditState); else setFailed(true); })
      .catch(() => setFailed(true));
  }, []);

  const saveKey = useCallback((): void => {
    setKeyBusy(true);
    setKeyProblem(null);
    void sendApiCredit('POST', '/api/api-credits/key', { key: keyDraft })
      .then(({ ok, data }) => {
        const body = data as { ok?: boolean; problem?: ApiKeyShapeProblem; state?: ApiCreditState } | null;
        applyApiCreditState(body?.state);
        if (ok && body?.ok) setKeyDraft('');
        else setKeyProblem(body?.problem ?? 'failed');
      })
      .catch(() => setKeyProblem('failed'))
      .finally(() => setKeyBusy(false));
  }, [keyDraft]);

  const keyProblemText = keyProblem === null ? null
    : keyProblem === 'failed' ? t('panel.usage.apiCredit.keySaveFailed') : t(keyProblemKey(keyProblem));

  const block = state?.block;
  const enabled = settings.enabled;
  const status: 'off' | 'blocked' | 'active' | 'standby' = !enabled ? 'off'
    : block ? 'blocked'
      : state?.route === 'credits' || (state?.liveRuns ?? 0) > 0 ? 'active' : 'standby';
  const statusTone = status === 'active' ? 'bg-amber-500/15 text-amber-300'
    : status === 'blocked' ? 'bg-red-500/15 text-red-300'
      : status === 'standby' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-700/60 text-gray-400';

  const pad = variant === 'popup' ? 'px-4 py-3 border-t border-gray-700' : 'rounded-lg border border-gray-700 bg-gray-950/60 px-4 py-3.5';

  return (
    <section className={`flex flex-col gap-3 ${pad}`} aria-label={t('panel.usage.apiCredit.title')}>
      {/* 머리 — 제목 + 상태 칩 */}
      <div className="flex flex-wrap items-center gap-2">
        <svg className="h-3.5 w-3.5 shrink-0 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <path d="M2 10h20" />
          <path d="M6 15h4" />
        </svg>
        <h3 className="min-w-0 truncate text-xs font-semibold text-gray-200">{t('panel.usage.apiCredit.title')}</h3>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[12px] font-semibold ${statusTone}`}>
          {t(`panel.usage.apiCredit.status.${status}`)}
        </span>
      </div>

      <SwitchRow
        label={t('panel.usage.apiCredit.enable')}
        hint={t('panel.usage.apiCredit.enableHint')}
        checked={enabled}
        onChange={(on) => patch({ enabled: on })}
      />

      {/* 지금 어느 경로로 나가는가 — 서버 판정 그대로 */}
      {state && (
        <p className="rounded border border-gray-700 bg-gray-800/40 px-2.5 py-1.5 text-[12px] leading-relaxed text-gray-300" role="status">
          {t(`panel.usage.apiCredit.reason.${state.reason}`)}
          {state.subscriptionExhausted && state.subscriptionResetsAt !== undefined && (
            <span className="text-gray-500"> · {t('panel.usage.apiCredit.subscriptionResets', { time: new Date(state.subscriptionResetsAt).toLocaleString(i18n.language) })}</span>
          )}
        </p>
      )}

      {/* Anthropic 의 거절 — 앱이 막은 것이 아니라 Console 쪽이 막았다. 원문·다시 시도할 때·지금 다시 시도 */}
      {block && (
        <div className="flex flex-col gap-2 rounded border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-[12px] leading-relaxed text-red-200" role="alert">
          <span>{t(`panel.usage.apiCredit.block.${block.reason}`)}</span>
          {block.detail && <code className="break-words font-mono text-[12px] text-red-300/80">{block.detail}</code>}
          {block.until !== undefined && (
            <span className="text-red-200/80">{t('panel.usage.apiCredit.blockRetryAt', { time: new Date(block.until).toLocaleString(i18n.language) })}</span>
          )}
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => action('POST', '/api/api-credits/retry')}
              className="rounded border border-red-400/50 px-2.5 py-1 text-xs text-red-100 hover:bg-red-500/20 pointer-coarse:py-2">
              {t('panel.usage.apiCredit.blockRetry')}
            </button>
          </div>
        </div>
      )}

      {(state?.liveRuns ?? 0) > 0 && (
        <span className="text-[12px] text-amber-300">{t('panel.usage.apiCredit.liveRunsNow', { count: state?.liveRuns ?? 0 })}</span>
      )}

      {/* 실행용 키 */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-gray-200">{t('panel.usage.apiCredit.key')}</span>
        {state?.hasKey ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="font-mono text-gray-300">{t('panel.usage.apiCredit.keySaved', { hint: state.keyHint ?? '…' })}</span>
              <span className={`rounded px-1.5 py-0.5 font-semibold ${
                state.keyVerified === 'ok' ? 'bg-emerald-500/15 text-emerald-300'
                  : state.keyVerified === 'rejected' ? 'bg-red-500/15 text-red-300' : 'bg-gray-700/60 text-gray-400'
              }`}>
                {t(`panel.usage.apiCredit.keyVerified.${state.keyVerified ?? 'unknown'}`)}
              </span>
              <span className="flex-1" />
              <button type="button" onClick={() => action('POST', '/api/api-credits/verify')}
                className="rounded border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs text-gray-300 hover:bg-gray-700 pointer-coarse:py-2">
                {t('panel.usage.apiCredit.keyVerify')}
              </button>
              <button type="button" onClick={() => action('DELETE', '/api/api-credits/key')}
                className="rounded border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs text-gray-300 hover:bg-gray-700 pointer-coarse:py-2">
                {t('panel.usage.apiCredit.keyRemove')}
              </button>
            </div>
            {state.keyReadable === false && <span className="text-[12px] text-amber-300">{t('panel.usage.apiCredit.keyUnreadable')}</span>}
            <span className={`text-[12px] leading-relaxed ${state.keyScheme === 'os' && state.encryptionAvailable ? 'text-gray-500' : 'text-amber-300/90'}`}>
              {state.keyScheme === 'os' && state.encryptionAvailable ? t('panel.usage.apiCredit.keyProtected') : t('panel.usage.apiCredit.keyUnprotected')}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={keyDraft}
                onChange={(e) => { setKeyDraft(e.target.value); setKeyProblem(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && keyDraft.trim() && !keyBusy) saveKey(); }}
                placeholder={t('panel.usage.apiCredit.keyPlaceholder')}
                aria-label={t('panel.usage.apiCredit.key')}
                className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-900 px-2 py-1.5 font-mono text-xs text-gray-100 outline-none focus:border-blue-500 pointer-coarse:py-2.5"
              />
              <button type="button" disabled={!keyDraft.trim() || keyBusy} onClick={saveKey}
                className="shrink-0 rounded bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-500 pointer-coarse:py-2.5">
                {t('panel.usage.apiCredit.keySave')}
              </button>
            </div>
            {keyProblemText && <span className="text-[12px] text-red-300">{keyProblemText}</span>}
            <button type="button" onClick={() => openExternal(CONSOLE_KEYS_URL)}
              className="inline-flex items-center gap-1.5 self-start text-[12px] text-blue-400 hover:text-blue-300">
              {t('panel.usage.apiCredit.keyCreate')}
              <ExternalIcon />
            </button>
          </div>
        )}
      </div>

      <SwitchRow
        label={t('panel.usage.apiCredit.mode')}
        hint={t('panel.usage.apiCredit.modeHintConsole')}
        checked={settings.mode === 'credits-first'}
        onChange={(on) => patch({ mode: on ? 'credits-first' : 'subscription-first' })}
      />
      <SwitchRow
        label={t('panel.usage.apiCredit.autoContinue')}
        hint={t('panel.usage.apiCredit.autoContinueHint')}
        checked={settings.autoContinue}
        onChange={(on) => patch({ autoContinue: on })}
      />

      {failed && <p className="text-[12px] text-red-300">{t('panel.usage.apiCredit.actionFailed')}</p>}
    </section>
  );
}
