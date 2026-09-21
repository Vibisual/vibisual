import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AutoGoalSkillStatus, AutoGoalSkillSummary } from '@vibisual/shared';
import { ScrollFade } from '../ScrollFade.js';
import { fetchAutoGoalResponse } from './autoGoalClient.js';
import { formatAutoGoalReason } from './autoGoalReason.js';

const STATUS_TONES: Record<AutoGoalSkillStatus, string> = {
  candidate: 'text-amber-300', active: 'text-emerald-400', 'needs-review': 'text-amber-300',
  retired: 'text-gray-400', superseded: 'text-gray-400',
};

/** Fetch the original only when the row is expanded. A revision change gets its own request. */
function SkillBody({ rootPath, skillId }: { rootPath: string; skillId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const [body, setBody] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    setBody(null);
    const query = new URLSearchParams({ projectPath: rootPath });
    void fetchAutoGoalResponse(`/api/auto-goal/skills/${encodeURIComponent(skillId)}?${query}`, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        if (typeof response.body !== 'string') throw new Error('Missing procedure body');
        setBody(response.body);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [rootPath, skillId, attempt]);
  if (failed) return (
    <div role="alert" className="text-[12px] text-rose-300">
      <p>{t('ide.autoGoal.bodyFailed')}</p>
      <button type="button" onClick={() => setAttempt((n) => n + 1)} className="rounded py-1 underline">{t('ide.autoGoal.details')}</button>
    </div>
  );
  if (body === null) return <p role="status" className="text-[12px] text-gray-500">{t('ide.autoGoal.loading')}</p>;
  return <ScrollFade maxHeight={280}><pre className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-gray-300">{body}</pre></ScrollFade>;
}

interface AutoGoalSkillRowProps {
  skill: AutoGoalSkillSummary;
  rootPath: string | null;
  disabled: boolean;
  onRemove: () => void;
  onRetire: () => void;
  onRequestReview: () => void;
}

export const AutoGoalSkillRow = memo(function AutoGoalSkillRow({
  skill, rootPath, disabled, onRemove, onRetire, onRequestReview,
}: AutoGoalSkillRowProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  // Older servers never imply that an unreviewed file is active.
  const status = skill.status ?? 'candidate';
  const stopped = status === 'retired' || status === 'superseded';
  return (
    <li className="min-w-0 rounded border border-gray-800 p-2 text-[12px]" data-procedure-status={status}>
      <button type="button" onClick={() => setExpanded((open) => !open)} aria-expanded={expanded}
        title={t(expanded ? 'ide.autoGoal.hideDetails' : 'ide.autoGoal.details')}
        className="flex w-full items-start gap-1.5 text-left">
        <svg className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d={expanded ? 'm6 9 6 6 6-6' : 'm9 6 6 6-6 6'} />
        </svg>
        <span className="min-w-0 flex-1 break-words text-gray-200">{skill.name}</span>
      </button>
      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
        <span className={STATUS_TONES[status]}>{t(`ide.autoGoal.status.${status}`)}</span>
        <span className="text-gray-500">{t('ide.autoGoal.skillMeta', { steps: skill.steps, runs: skill.runs })}</span>
      </div>
      {skill.reason && <p className="mt-1 break-words text-gray-400">{t('ide.autoGoal.reason')}: {formatAutoGoalReason(skill.reason, t)}</p>}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {!stopped && <button type="button" disabled={disabled} onClick={onRetire} className="rounded py-0.5 text-gray-400 hover:text-amber-300 disabled:opacity-40">{t('ide.autoGoal.pause')}</button>}
        {(status === 'active' || status === 'retired') && <button type="button" disabled={disabled} onClick={onRequestReview} title={t('ide.autoGoal.reviewHint')} className="rounded py-0.5 text-sky-400 hover:text-sky-300 disabled:opacity-40">{t('ide.autoGoal.requestReview')}</button>}
        <button type="button" disabled={disabled} onClick={onRemove} title={t('ide.autoGoal.removeSkill')} aria-label={t('ide.autoGoal.removeSkill')}
          className="ml-auto rounded p-1 text-gray-500 hover:text-rose-400 disabled:opacity-40">
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      {expanded && <div className="mt-2 flex flex-col gap-2 border-t border-gray-800 pt-2">
        <p className="break-words text-gray-400">{skill.description}</p>
        {skill.applicability && <p className="break-words text-gray-300">{t('ide.autoGoal.applicability')}: {skill.applicability}</p>}
        {skill.reviewedAt !== undefined && <p className="text-gray-500">{t('ide.autoGoal.reviewed', { date: new Date(skill.reviewedAt).toLocaleDateString(i18n.language) })}</p>}
        {skill.supersededBy && <p className="break-words text-gray-500">{t('ide.autoGoal.supersededBy', { name: skill.supersededBy })}</p>}
        <div className="flex flex-wrap gap-x-3 gap-y-1 tabular-nums text-gray-400">
          {skill.reuseCount !== undefined && <span>{t('ide.autoGoal.metrics.reuse', { count: skill.reuseCount })}</span>}
          {skill.skipCount !== undefined && <span>{t('ide.autoGoal.metrics.skip', { count: skill.skipCount })}</span>}
          {skill.failureCount !== undefined && <span>{t('ide.autoGoal.metrics.failure', { count: skill.failureCount })}</span>}
          {skill.revisionCount !== undefined && <span>{t('ide.autoGoal.metrics.revision', { count: skill.revisionCount })}</span>}
        </div>
        {rootPath && <SkillBody key={`${rootPath}:${skill.id}:${skill.revision ?? ''}`} rootPath={rootPath} skillId={skill.id} />}
        {skill.path && <p className="break-all font-mono text-gray-600">{skill.path}</p>}
        {skill.revision && <p className="break-all text-gray-600">{t('ide.autoGoal.revision', { revision: skill.revision })}</p>}
      </div>}
    </li>
  );
});
