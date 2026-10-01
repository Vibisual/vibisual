import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SkillSharingState } from './useSkillSharing.js';
import { SKILL_PROVIDER_LABELS, otherSkillProvider, type SkillProvider } from './IDESkillProviderTabs.js';

interface IDESkillSharingSectionProps {
  /** 부모가 `useSkillSharing` 으로 쥔 상태 — 탭 개수와 머리줄 새로고침이 같은 한 벌을 본다. */
  sharing: SkillSharingState;
  /** 공유받는 쪽(지금 에이전트의 엔진). 원본은 그 반대 엔진이다. */
  provider: SkillProvider;
  agentId: string | null;
  query?: string;
}

const STATUS_TONES = {
  available: 'text-sky-300', shared: 'text-emerald-300', conflict: 'text-amber-300', unsupported: 'text-gray-400',
};

/**
 * 두 엔진의 스킬 칸이 공유 탭에 같은 목록을 그린다. 제목·새로고침은 탭과 칸 머리줄이 이미 갖고
 * 있어 여기엔 두지 않는다(같은 손잡이 두 벌 ❌).
 */
export function IDESkillSharingSection(props: IDESkillSharingSectionProps): React.JSX.Element {
  const { t } = useTranslation();
  const { skills, loading, busyId, error, used, refresh, useSkill } = props.sharing;
  const sourceProvider = SKILL_PROVIDER_LABELS[otherSkillProvider(props.provider)];
  const targetProvider = SKILL_PROVIDER_LABELS[props.provider];
  const query = props.query?.trim().toLocaleLowerCase() ?? '';
  const visible = useMemo(() => skills.filter((skill) => !query
    || `${skill.name}\n${skill.description}`.toLocaleLowerCase().includes(query)), [skills, query]);
  return (
    <section className="px-1 text-[12px]" aria-label={t('ide.skillSharing.title', { provider: sourceProvider })}>
      <p className="px-1 pb-1.5 pt-1 text-gray-500">{t('ide.skillSharing.hint', { provider: targetProvider })}</p>
      {loading && <p role="status" className="px-1 py-2 text-gray-400">{t('ide.skillSharing.loading')}</p>}
      {error && <div role="alert" className="px-1 py-1 text-amber-300">
        <p>{t(error.action === 'load' ? 'ide.skillSharing.loadFailed' : 'ide.skillSharing.shareFailed', {
          reason: error.invalidResponse ? t('ide.skillSharing.invalidResponse') : error.reason,
        })}</p>
        {error.action === 'load' && <button type="button" onClick={refresh} className="app-nodrag mt-1 rounded border border-gray-600 px-2 py-1 text-gray-200 hover:bg-gray-700">{t('ide.skillSharing.retry')}</button>}
      </div>}
      {!loading && !error && visible.length === 0 && <p className="px-1 py-2 text-gray-500">
        {query ? t('ide.skillSharing.noMatch', { query: props.query }) : t('ide.skillSharing.empty', { provider: sourceProvider })}
      </p>}
      {used && <p role="status" className="px-1 py-1 text-emerald-300">{t('ide.skillSharing.sharedHint')}</p>}
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
                <span>{SKILL_PROVIDER_LABELS[skill.sourceProvider]}</span>
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
}
