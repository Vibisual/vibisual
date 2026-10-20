import { useTranslation } from 'react-i18next';
import type { ClaudeUsageExtraCredits, ProviderUsage } from '@vibisual/shared';

type OnlineProvider = 'codex' | 'claude';

// Official usage dashboards: purchases, redemption and billing settings stay on the provider site.
const USAGE_MANAGEMENT_URLS: Record<OnlineProvider, string> = {
  codex: 'https://chatgpt.com/codex/settings/usage',
  claude: 'https://claude.ai/settings/usage',
};

function ResourceValue({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
    <dt className="text-gray-400">{label}</dt>
    <dd className="min-w-0 break-words text-right font-medium tabular-nums text-gray-200">{children}</dd>
  </div>;
}

const knownAmount = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Read-only account resources. Missing measurements are never turned into zero balances. */
export function UsageResources({ provider, codexUsage, claudeCredits }: {
  provider: OnlineProvider;
  codexUsage?: ProviderUsage | null;
  claudeCredits?: ClaudeUsageExtraCredits;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const unknown = t('panel.usage.checkOnSite');
  const credits = codexUsage?.credits;
  const resetCredits = codexUsage?.resetCredits;
  const availablePasses = resetCredits?.credits?.filter(pass => pass.status === 'available') ?? [];
  const balance = !credits ? unknown : credits.unlimited ? t('panel.usage.creditUnlimited')
    : credits.balance !== undefined ? t('panel.usage.creditAmount', { amount: credits.balance })
      : t(credits.hasCredits ? 'panel.usage.creditAvailable' : 'panel.usage.creditNone');
  const money = (amount: number): string => {
    const currency = claudeCredits?.currency;
    if (currency) {
      try { return new Intl.NumberFormat(i18n.language, { style: 'currency', currency }).format(amount); }
      catch { /* Preserve the amount and source unit even when the currency is unrecognized. */ }
    }
    const formatted = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(amount);
    return currency ? `${formatted} ${currency}` : formatted;
  };
  const limit = claudeCredits?.monthlyLimit;
  const spent = claudeCredits?.usedCredits;

  return <section className="flex flex-col gap-3 border-t border-gray-700 px-4 py-3" aria-label={t('panel.usage.resourcesTitle')}>
    <h3 className="text-xs font-semibold text-gray-200">{t('panel.usage.resourcesTitle')}</h3>
    <dl className="flex flex-col gap-2.5">
      {provider === 'codex' ? <>
        <ResourceValue label={t('panel.usage.creditBalance')}>{balance}</ResourceValue>
        <ResourceValue label={t('panel.usage.resetPasses')}>
          {resetCredits ? t('panel.usage.resetPassCount', { count: resetCredits.availableCount }) : unknown}
        </ResourceValue>
      </> : <>
        <ResourceValue label={t('panel.usage.creditsTitle')}>
          {claudeCredits ? t(claudeCredits.enabled ? 'panel.usage.creditsOn' : 'panel.usage.creditsOff') : unknown}
        </ResourceValue>
        <ResourceValue label={t('panel.usage.prepaidBalance')}>{unknown}</ResourceValue>
        <ResourceValue label={t('panel.usage.monthlyBudget')}>{knownAmount(limit) ? money(limit) : unknown}</ResourceValue>
        {knownAmount(spent) && <ResourceValue label={t('panel.usage.creditsSpent')}>{money(spent)}</ResourceValue>}
        {knownAmount(limit) && knownAmount(spent) && <ResourceValue label={t('panel.usage.budgetRemaining')}>
          {money(Math.max(0, limit - spent))}
        </ResourceValue>}
        <ResourceValue label={t('panel.usage.resetPasses')}>{unknown}</ResourceValue>
      </>}
      <ResourceValue label={t('panel.usage.autoRecharge')}>{unknown}</ResourceValue>
    </dl>
    {provider === 'codex' && availablePasses.length > 0 && <ul className="flex flex-col gap-2">
      {availablePasses.map(pass => <li key={pass.id} className="rounded border border-gray-700 bg-gray-800/40 px-2.5 py-2 text-xs">
        <div className="break-words font-medium text-gray-200">{pass.title || t('panel.usage.resetPassDefault')}</div>
        {pass.description && <p className="mt-1 break-words text-gray-400">{pass.description}</p>}
        <p className="mt-1 text-gray-400">{pass.expiresAt === null ? t('panel.usage.noExpiry')
          : pass.expiresAt === undefined ? t('panel.usage.expiryUnknown')
            : t('panel.usage.expiresAt', { date: new Date(pass.expiresAt).toLocaleString(i18n.language) })}</p>
      </li>)}
    </ul>}
    {provider === 'claude' && claudeCredits?.enabled && knownAmount(claudeCredits.utilization) &&
      <p className="text-xs text-gray-400">{t('panel.usage.creditsUsed', { percent: Math.round(claudeCredits.utilization) })}</p>}
    {provider === 'claude' && knownAmount(limit) && <p className="text-xs leading-relaxed text-gray-400">{t('panel.usage.budgetHint')}</p>}
    <p className="text-xs leading-relaxed text-gray-500">{t('panel.usage.resourcesHint')}</p>
  </section>;
}

/** A single external action remains visible even when the resource list scrolls. */
export function UsageManagement({ provider }: { provider: OnlineProvider }): React.JSX.Element {
  const { t } = useTranslation();
  return <div className="flex shrink-0 flex-col gap-1.5 border-t border-gray-700 px-4 py-2.5">
    <a href={USAGE_MANAGEMENT_URLS[provider]} target="_blank" rel="noopener noreferrer"
      className="inline-flex min-h-7 max-w-full self-start items-center justify-center gap-1.5 rounded-md border border-gray-700/80 bg-gray-800/40 px-2.5 py-1 text-center text-xs font-medium leading-4 text-gray-300 transition-colors hover:border-gray-600 hover:bg-gray-800 hover:text-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400 pointer-coarse:min-h-9">
      {t('panel.usage.manageOnSite', { provider: t(`providers.${provider}`) })}
      <svg className="h-3 w-3 shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 3h6v6M21 3l-9 9M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />
      </svg>
    </a>
    <p className="text-xs leading-relaxed text-gray-400">{t('panel.usage.manageHint')}</p>
  </div>;
}
