import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { utcNextMonthStart, type ApiCreditState, type ApiKeyShapeProblem, type ClaudeCloudProvider } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { ApiCreditSection, applyApiCreditState, keyProblemKey, sendApiCredit } from './ApiCreditSection.js';
import { UsageResources } from './UsageResources.js';

// SCENARIO §4 API 크레딧 — 지갑마다 페이지를 나눈다(섞이면 다른 지갑의 칸을 본다). 페이지마다 무엇·청구처·관리처·Vibisual 사용 여부를 같은 꼴로.
// 사용량 팝업과 옵션창 「크레딧」이 이 한 벌을 쓴다. 구독 한도 페이지는 팝업에만.

export type CreditPageKey = 'subscription' | 'personal' | 'business' | 'cloud';

/** 관리하러 가는 공개 페이지(문서에 없는 엔드포인트 ❌ — 사람이 여는 화면만). */
const MANAGE_URLS = {
  subscription: 'https://claude.ai/settings/usage',
  personal: 'https://claude.ai/settings/usage',
  business: 'https://platform.claude.com/settings/billing',
} as const;

/** 관리자 키를 만드는 곳과, 개인(individual) 계정이 조직을 먼저 만드는 곳(공식 문서가 가리키는 Console 화면). */
const CONSOLE_ADMIN_KEYS_URL = 'https://platform.claude.com/settings/admin-keys';
const CONSOLE_ORGANIZATION_URL = 'https://platform.claude.com/settings/organization';
/** Console 지출 한도 화면(2026-10-27 확인). 한도 금액은 조직용 공개 API 가 없어 읽지 않고 이 화면으로 넘긴다. */
const CONSOLE_SPEND_LIMITS_URL = 'https://platform.claude.com/settings/spend-limits';

/** 클라우드 제공자마다 Claude 를 켜고 청구를 보는 콘솔(공개 페이지). */
const CLOUD_CONSOLES: { id: ClaudeCloudProvider; site: string; url: string }[] = [
  { id: 'bedrock', site: 'AWS', url: 'https://console.aws.amazon.com/bedrock/home' },
  { id: 'vertex', site: 'Google Cloud', url: 'https://console.cloud.google.com/vertex-ai' },
  { id: 'foundry', site: 'Azure', url: 'https://ai.azure.com' },
];

/** Claude Code 를 클라우드 제공자로 쓰는 공식 안내. */
const CLOUD_DOCS_URL = 'https://code.claude.com/docs/en/third-party-integrations';

/** 다시 열면 마지막에 보던 페이지로(화면 기억만 — 저장하지 않는다). 입구마다 따로 기억한다. */
const lastPage: Record<'popup' | 'options', CreditPageKey | undefined> = { popup: undefined, options: undefined };

function openExternal(url: string): void {
  try { window.open(url, '_blank', 'noopener,noreferrer'); } catch { /* main 이 ExternalOpenNotice 로 알린다 */ }
}

function ExternalLink({ url, label }: { url: string; label: string }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => openExternal(url)}
      title={url}
      className="inline-flex min-w-0 max-w-full items-center gap-1 text-left text-blue-400 hover:text-blue-300"
    >
      <span className="truncate">{label}</span>
      <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 3h6v6" />
        <path d="M10 14 21 3" />
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6" />
      </svg>
    </button>
  );
}

/** 페이지 설명 — 각 페이지 내용 아래에 넷을 같은 꼴로. 이 칸이 같은 모양이어야 페이지끼리 견줘 읽힌다. */
function PageIntro({ page, manage }: { page: CreditPageKey; manage: ReactNode }): React.JSX.Element {
  const { t } = useTranslation();
  const row = (label: string, value: ReactNode): React.JSX.Element => (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className="min-w-0 break-words text-gray-200">{value}</dd>
    </>
  );
  return (
    <div className="flex flex-col gap-2 rounded border border-gray-700 bg-gray-800/40 px-3 py-2.5">
      <p className="text-xs leading-relaxed text-gray-200">{t(`panel.usage.creditPages.${page}.what`)}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px] leading-relaxed">
        {row(t('panel.usage.creditPages.billedLabel'), t(`panel.usage.creditPages.${page}.billed`))}
        {row(t('panel.usage.creditPages.manageLabel'), manage)}
        {row(t('panel.usage.creditPages.vibisualLabel'), t(`panel.usage.creditPages.${page}.vibisual`))}
      </dl>
    </div>
  );
}

/** 비즈니스 맨 위 — Console 이번 달 지출을 공식 `cost_report` 값 그대로(앱이 센 금액 없음). 한도·잔액은 공개 API 가 없어 안 읽는다고 늘 함께 적는다. */
function ConsoleSpendCard(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const state = useGraphStore((s) => s.apiCredits);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<ApiKeyShapeProblem | 'failed' | null>(null);
  const [busy, setBusy] = useState(false);
  const money = (amount: number): string => {
    try { return new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(amount); }
    catch { return `$${amount.toFixed(2)}`; }
  };
  const spend = state?.console;
  const adminKey = state?.adminKey;

  const save = (): void => {
    setBusy(true);
    setProblem(null);
    void sendApiCredit('POST', '/api/api-credits/admin-key', { key: draft })
      .then(({ ok, data }) => {
        const body = data as { ok?: boolean; problem?: ApiKeyShapeProblem; state?: ApiCreditState } | null;
        applyApiCreditState(body?.state);
        if (ok && body?.ok) setDraft('');
        else setProblem(body?.problem ?? 'failed');
      })
      .catch(() => setProblem('failed'))
      .finally(() => setBusy(false));
  };
  const act = (method: 'POST' | 'DELETE', path: string): void => {
    void sendApiCredit(method, path)
      .then(({ ok, data }) => { if (ok) applyApiCreditState(data as ApiCreditState); })
      .catch(() => { /* 스냅샷이 곧 다시 싣고 온다 */ });
  };

  const hasValue = spend?.spendUsd !== undefined;
  const problemText = problem === null ? null
    : problem === 'failed' ? t('panel.usage.apiCredit.keySaveFailed') : t(keyProblemKey(problem));

  return (
    <section className="flex flex-col gap-2.5 rounded-lg border border-gray-700 bg-gray-950/60 px-4 py-3.5" aria-label={t('panel.usage.apiCredit.console.title')}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="min-w-0 truncate text-xs font-semibold text-gray-200">{t('panel.usage.apiCredit.console.title')}</h3>
        {spend?.orgName && (
          <span className="min-w-0 truncate text-[12px] text-gray-500" title={spend.orgName}>{t('panel.usage.apiCredit.console.org', { name: spend.orgName })}</span>
        )}
        <span className="flex-1" />
        {adminKey && (
          <button
            type="button"
            disabled={spend?.refreshing}
            onClick={() => act('POST', '/api/api-credits/console/refresh')}
            className="shrink-0 rounded border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-60 pointer-coarse:py-2"
          >
            {spend?.refreshing ? t('panel.usage.apiCredit.console.refreshing') : t('panel.usage.apiCredit.console.refresh')}
          </button>
        )}
      </div>

      {hasValue && spend && (
        <div className="flex flex-col gap-0.5">
          {/* Console 지출 한도 화면과 같은 꼴 — 「US$129.31 사용됨 · 2026년 11월 1일 (UTC) 초기화」. 초기화는 문서상 매달 1일 00:00 UTC. */}
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-xl font-semibold tabular-nums text-gray-100">{money(spend.spendUsd ?? 0)}</span>
            <span className="text-xs text-gray-400">{t('panel.usage.apiCredit.console.used')}</span>
          </div>
          <span className="text-[12px] text-gray-300">
            {t('panel.usage.apiCredit.console.resetsOn', {
              date: new Date(utcNextMonthStart(spend.monthStart)).toLocaleDateString(i18n.language, { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' }),
            })}
          </span>
          <span className="text-[12px] leading-relaxed text-gray-500">
            {t('panel.usage.apiCredit.console.asOf', {
              start: new Date(spend.monthStart).toLocaleDateString(i18n.language, { timeZone: 'UTC' }),
              time: spend.fetchedAt !== undefined ? new Date(spend.fetchedAt).toLocaleTimeString(i18n.language) : '—',
            })}
          </span>
        </div>
      )}
      {adminKey && !hasValue && spend?.status === 'pending' && (
        <span className="text-[12px] text-gray-400" role="status">{t('panel.usage.apiCredit.console.pending')}</span>
      )}
      {adminKey && spend?.status === 'error' && spend.error && (
        <div className="flex flex-col gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[12px] leading-relaxed text-amber-100" role="alert">
          <span>{t(`panel.usage.apiCredit.console.error.${spend.error.kind}`)}</span>
          {spend.error.message && <code className="break-words font-mono text-[12px] text-amber-200/80">{spend.error.message}</code>}
          {hasValue && <span className="text-amber-200/80">{t('panel.usage.apiCredit.console.lastValue')}</span>}
        </div>
      )}

      {adminKey ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-gray-200">{t('panel.usage.apiCredit.console.adminKey')}</span>
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="font-mono text-gray-300">{t('panel.usage.apiCredit.keySaved', { hint: adminKey.hint })}</span>
            <span className={`rounded px-1.5 py-0.5 font-semibold ${
              adminKey.verified === 'ok' ? 'bg-emerald-500/15 text-emerald-300'
                : adminKey.verified === 'rejected' ? 'bg-red-500/15 text-red-300' : 'bg-gray-700/60 text-gray-400'
            }`}>
              {t(`panel.usage.apiCredit.keyVerified.${adminKey.verified ?? 'unknown'}`)}
            </span>
            <span className="flex-1" />
            <button type="button" onClick={() => act('DELETE', '/api/api-credits/admin-key')}
              className="rounded border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs text-gray-300 hover:bg-gray-700 pointer-coarse:py-2">
              {t('panel.usage.apiCredit.keyRemove')}
            </button>
          </div>
          <span className={`text-[12px] leading-relaxed ${adminKey.scheme === 'os' && state?.encryptionAvailable ? 'text-gray-500' : 'text-amber-300/90'}`}>
            {t('panel.usage.apiCredit.console.adminKeyHint')}{' '}
            {adminKey.scheme === 'os' && state?.encryptionAvailable ? t('panel.usage.apiCredit.keyProtected') : t('panel.usage.apiCredit.keyUnprotected')}
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1 rounded border border-gray-700 bg-gray-800/40 px-2.5 py-2 text-[12px] leading-relaxed text-gray-300" role="note">
            <span className="font-semibold text-gray-100">{t('panel.usage.apiCredit.console.needKeyTitle')}</span>
            <span>{t('panel.usage.apiCredit.console.needKeyBody')}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setProblem(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim() && !busy) save(); }}
              placeholder={t('panel.usage.apiCredit.console.adminKeyPlaceholder')}
              aria-label={t('panel.usage.apiCredit.console.adminKey')}
              className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-900 px-2 py-1.5 font-mono text-xs text-gray-100 outline-none focus:border-blue-500 pointer-coarse:py-2.5"
            />
            <button type="button" disabled={!draft.trim() || busy} onClick={save}
              className="shrink-0 rounded bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-500 pointer-coarse:py-2.5">
              {t('panel.usage.apiCredit.keySave')}
            </button>
          </div>
          {problemText && <span className="text-[12px] text-red-300">{problemText}</span>}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
            <ExternalLink url={CONSOLE_ADMIN_KEYS_URL} label={t('panel.usage.apiCredit.console.createAdminKey')} />
            <ExternalLink url={CONSOLE_ORGANIZATION_URL} label={t('panel.usage.apiCredit.console.setupOrg')} />
          </div>
        </div>
      )}

      <div className="flex flex-col items-start gap-1 text-[12px]">
        <p className="leading-relaxed text-gray-500">{t('panel.usage.apiCredit.console.limitsNote')}</p>
        <ExternalLink url={CONSOLE_SPEND_LIMITS_URL} label={t('panel.usage.apiCredit.console.viewSpendLimits')} />
      </div>
    </section>
  );
}

/** 클라우드 페이지 — 이 PC 의 Claude Code 가 어디로 청구하는지(읽기 전용). */
function CloudPage(): React.JSX.Element {
  const { t } = useTranslation();
  const fromCredits = useGraphStore((s) => s.apiCredits?.cloudProvider);
  const apiProvider = useGraphStore((s) => s.claudeAuth?.apiProvider);
  const authKnown = useGraphStore((s) => !!s.claudeAuth && !s.claudeAuth.error);
  const token = (apiProvider ?? '').trim().toLowerCase();
  const current: ClaudeCloudProvider | null = fromCredits
    ?? (token === 'bedrock' || token === 'vertex' || token === 'foundry' ? token : null);
  const status = current ? t(`panel.usage.creditPages.cloud.provider.${current}`)
    : authKnown ? t('panel.usage.creditPages.cloud.provider.anthropic') : t('panel.usage.creditPages.cloud.provider.unknown');
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
        <span className="text-gray-400">{t('panel.usage.creditPages.cloud.currentLabel')}</span>
        <span className={`font-semibold ${current ? 'text-amber-300' : 'text-gray-100'}`}>{status}</span>
      </div>
      <p className="text-[12px] leading-relaxed text-gray-400">
        {current ? t('panel.usage.creditPages.cloud.activeNote') : t('panel.usage.creditPages.cloud.inactiveNote')}
      </p>
      <ul className="flex flex-col gap-1.5 text-[12px]">
        {CLOUD_CONSOLES.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
            <span className={c.id === current ? 'font-semibold text-gray-100' : 'text-gray-300'}>{t(`panel.usage.creditPages.cloud.provider.${c.id}`)}</span>
            <ExternalLink url={c.url} label={c.site} />
          </li>
        ))}
      </ul>
      <ExternalLink url={CLOUD_DOCS_URL} label={t('panel.usage.creditPages.cloud.docs')} />
    </div>
  );
}

/**
 * 크레딧 페이지 묶음. `subscription` 을 주면(팝업) 구독 한도 페이지가 맨 앞에 선다.
 * 페이지 탭은 스크롤 상자 안에서 위에 붙어 있다(긴 페이지를 내려도 다른 지갑으로 바로 옮겨 간다).
 */
export function CreditPages({ variant, subscription, initialPage }: {
  variant: 'popup' | 'options';
  subscription?: ReactNode;
  /** 처음 열 페이지(기억한 페이지가 없을 때만). 없으면 팝업은 구독 한도, 옵션은 비즈니스. */
  initialPage?: CreditPageKey;
}): React.JSX.Element {
  const { t } = useTranslation();
  const claudeLoggedIn = useGraphStore((s) => s.claudeAuth?.loggedIn === true);
  const extraCredits = useGraphStore((s) => s.claudeUsage?.extraCredits);
  const pages: CreditPageKey[] = subscription ? ['subscription', 'personal', 'business', 'cloud'] : ['personal', 'business', 'cloud'];
  const [page, setPageState] = useState<CreditPageKey>(() => {
    const remembered = lastPage[variant];
    if (remembered && pages.includes(remembered)) return remembered;
    if (initialPage && pages.includes(initialPage)) return initialPage;
    return subscription ? 'subscription' : 'business';
  });
  const setPage = (next: CreditPageKey): void => { lastPage[variant] = next; setPageState(next); };

  const sticky = variant === 'popup' ? 'sticky top-0 z-10 bg-gray-900 px-4 pb-2 pt-3' : 'pb-1';
  const body = variant === 'popup' ? 'flex flex-col gap-3 px-4 pb-4' : 'flex flex-col gap-3';

  return (
    <div className="flex flex-col">
      <div role="tablist" aria-label={t('panel.usage.creditPages.tabsLabel')} className={`flex flex-wrap gap-1 ${sticky}`}>
        {pages.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={page === key}
            onClick={() => setPage(key)}
            className={`min-w-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors pointer-coarse:py-2 ${
              page === key ? 'bg-blue-600 text-white' : 'border border-gray-700 bg-gray-800/60 text-gray-300 hover:bg-gray-800 hover:text-gray-100'
            }`}
          >
            {t(`panel.usage.creditPages.${key}.tab`)}
          </button>
        ))}
      </div>

      <div role="tabpanel" className={body}>
        {page === 'subscription' && (
          <>
            {subscription}
            <PageIntro page="subscription" manage={<ExternalLink url={MANAGE_URLS.subscription} label="claude.ai" />} />
          </>
        )}
        {page === 'personal' && (
          <>
            {/* 종전 「계정 자원」 칸 그대로 — claude.ai 계정의 추가 사용량만 담는다(읽기 전용). */}
            <div className={variant === 'popup' ? '-mx-4 [&>section]:border-t-0' : 'rounded-lg border border-gray-700 [&>section]:border-t-0'}>
              <UsageResources provider="claude" claudeCredits={claudeLoggedIn ? extraCredits : undefined} />
            </div>
            <PageIntro page="personal" manage={<ExternalLink url={MANAGE_URLS.personal} label="claude.ai" />} />
          </>
        )}
        {page === 'business' && (
          <>
            <ConsoleSpendCard />
            <ApiCreditSection variant="options" />
            <PageIntro page="business" manage={<ExternalLink url={MANAGE_URLS.business} label="platform.claude.com" />} />
          </>
        )}
        {page === 'cloud' && (
          <>
            <CloudPage />
            <PageIntro page="cloud" manage={<span className="text-gray-300">AWS · Google Cloud · Azure</span>} />
          </>
        )}
      </div>
    </div>
  );
}
