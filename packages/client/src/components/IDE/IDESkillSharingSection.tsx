import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSkillSharing, type SkillSharingOptions } from './useSkillSharing.js';

interface IDESkillSharingSectionProps extends SkillSharingOptions {
  query?: string;
}

const PROVIDER_LABELS = { claude: 'Claude', codex: 'Codex' };
const STATUS_TONES = {
  available: 'text-sky-300', shared: 'text-emerald-300', conflict: 'text-amber-300', unsupported: 'text-gray-400',
};

/** Both providers use the same sharing control, inside their existing ScrollFade. */
export const IDESkillSharingSection = memo(function IDESkillSharingSection(
  props: IDESkillSharingSectionProps,
): React.JSX.Element {
  const { t } = useTranslation();
  const { skills, loading, busyId, error, used, refresh, useSkill } = useSkillSharing(props);
  const sourceProvider = PROVIDER_LABELS[props.provider === 'claude' ? 'codex' : 'claude'];
  const targetProvider = PROVIDER_LABELS[props.provider];
  const query = props.query?.trim().toLocaleLowerCase() ?? '';
  const visible = useMemo(() => skills.filter((skill) => !query
    || `${skill.name}\n${skill.description}`.toLocaleLowerCase().includes(query)), [skills, query]);
  return (
    <section className="mt-2 border-t border-gray-700/60 px-1 pt-2 text-[12px]" aria-label={t('ide.skillSharing.title', { provider: sourceProvider })}>
      <div className="flex items-center gap-1">
        <h3 className="min-w-0 flex-1 font-semibold text-gray-300">{t('ide.skillSharing.title', { provider: sourceProvider })}</h3>
        <button type="button" onClick={refresh} disabled={loading || busyId !== null}
          title={t('ide.skillSharing.refresh')} aria-label={t('ide.skillSharing.refresh')}
          className="app-nodrag rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-gray-200 disabled:opacity-50">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}>
            <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
          </svg>
        </button>
      </div>
      <p className="py-1 text-gray-500">{t('ide.skillSharing.hint', { provider: targetProvider })}</p>
      {loading && <p role="status" className="py-2 text-gray-400">{t('ide.skillSharing.loading')}</p>}
      {error && <div role="alert" className="py-1 text-amber-300">
        <p>{t(error.action === 'load' ? 'ide.skillSharing.loadFailed' : 'ide.skillSharing.shareFailed', {
          reason: error.invalidResponse ? t('ide.skillSharing.invalidResponse') : error.reason,
        })}</p>
        {error.action === 'load' && <button type="button" onClick={refresh} className="app-nodrag mt-1 rounded border border-gray-600 px-2 py-1 text-gray-200 hover:bg-gray-700">{t('ide.skillSharing.retry')}</button>}
      </div>}
      {!loading && !error && visible.length === 0 && <p className="py-2 text-gray-500">
        {query ? t('ide.skillSharing.noMatch', { query: props.query }) : t('ide.skillSharing.empty', { provider: sourceProvider })}
      </p>}
      {used && <p role="status" className="py-1 text-emerald-300">{t('ide.skillSharing.sharedHint')}</p>}
      <ul className="flex flex-col gap-1 pb-2">
        {visible.map((skill) => {
          const blocked = skill.status === 'conflict' || skill.status === 'unsupported';
          const issueFallback = skill.status === 'conflict'
            ? t('ide.skillSharing.conflictHint') : t('ide.skillSharing.unsupportedHint', { provider: targetProvider });
          return (
            <li key={skill.id} className="rounded border border-gray-700/50 px-2 py-1.5">
              <p className="truncate font-mono font-semibold text-gray-200" title={skill.name}>{skill.name}</p>
              {skill.description && <p className="mt-0.5 line-clamp-2 text-gray-400" title={skill.description}>{skill.description}</p>}
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-gray-500">
                <span>{PROVIDER_LABELS[skill.sourceProvider]}</span>
                <span>{t(`ide.skillSharing.${skill.scope}`)}</span>
                <span className={STATUS_TONES[skill.status]}>{t(`ide.skillSharing.${skill.status}`)}</span>
              </div>
              <p className="mt-0.5 truncate text-gray-500" title={skill.sourcePath}>{skill.sourcePath}</p>
              {skill.issues.map((issue) => <p key={issue} className="mt-1 text-amber-300">{t(`ide.skillSharing.issues.${issue}`, { defaultValue: issueFallback })}</p>)}
              {blocked && skill.issues.length === 0 && <p className="mt-1 text-amber-300">{issueFallback}</p>}
              <button type="button" onClick={() => { void useSkill(skill); }}
                disabled={blocked || loading || busyId !== null || !props.agentId}
                title={blocked ? issueFallback : undefined}
                className="app-nodrag mt-1.5 rounded border border-gray-600 px-2 py-1 text-gray-200 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50">
                {busyId === skill.id ? t('ide.skillSharing.sharing') : skill.status === 'shared' ? t('ide.skillSharing.use') : t('ide.skillSharing.shareAndUse')}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
});
