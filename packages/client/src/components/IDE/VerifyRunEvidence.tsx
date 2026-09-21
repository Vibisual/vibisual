import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VerificationDemo, VerificationRun } from '@vibisual/shared';
import { VERIFICATION_DEMO_MAX_PER_SESSION } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { useVerifyDemoStore } from '../../stores/verifyDemo.js';
import { verificationEvidenceUrl, verificationOperationKey, verificationStepCoverage, verificationTargetLabel } from './verificationConnection.js';

export function VerifyRunEvidence({ run, readOnly }: { run: VerificationRun; readOnly: boolean }): React.JSX.Element | null {
  const { t } = useTranslation();
  const openImage = useGraphStore((s) => s.openImageLightbox);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  if (!run.target) return null;
  const events = run.toolEvents ?? [];
  const evidence = run.evidence ?? [];
  const save = async (): Promise<void> => {
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/verification-runs/${encodeURIComponent(run.id)}/save-procedure`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const result = await response.json() as { ok?: boolean; demo?: VerificationDemo; error?: string };
      if (!response.ok || !result.ok || !result.demo) throw new Error(result.error || 'failed');
      const demo = result.demo;
      // The HTTP response may precede its snapshot, as with startVerification.
      useGraphStore.setState((state) => {
        const current = state.verificationDemos[run.subAgentId] ?? [];
        return current.some((entry) => entry.id === demo.id) ? state : {
          verificationDemos: { ...state.verificationDemos, [run.subAgentId]: [demo, ...current].slice(0, VERIFICATION_DEMO_MAX_PER_SESSION) },
        };
      });
      useVerifyDemoStore.getState().setPickedDemo(run.subAgentId, demo.id);
      if (demo.target) useVerifyDemoStore.getState().setTarget(run.subAgentId, demo.target);
      setSaved(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'network'); }
    finally { setSaving(false); }
  };
  return (
    <div className="mt-1.5 flex flex-col gap-1.5 border-t border-gray-700 pt-1.5">
      <p className="break-all text-[12px] text-gray-500">{verificationTargetLabel(run.target)}</p>
      {run.expected && <p className="break-words text-[12px] text-gray-400">{t('ide.verify.execution.expected', { expected: run.expected })}</p>}
      {!!run.requiredSteps && <p className="text-[12px] text-gray-400">{t('ide.verify.execution.coverage', { done: verificationStepCoverage(run), total: run.requiredSteps })}</p>}
      <details open={run.status === 'running'}>
        <summary className="cursor-pointer text-[12px] text-gray-300">{t('ide.verify.execution.events', { count: events.length })}</summary>
        <ol className="mt-1 flex max-h-60 flex-col gap-1 overflow-auto">
          {events.map((event) => (
            <li key={event.id} className="rounded bg-gray-900/60 p-1 text-[12px]">
              <span className={event.ok ? 'text-emerald-400' : 'text-rose-400'}>
                {t(verificationOperationKey(event.action?.kind ?? event.check?.kind ?? event.operation))}
                {event.stepIndex !== undefined ? ` · ${event.stepIndex + 1}` : ''}
              </span>
              <p className="break-words text-gray-400">{event.detail}</p>
              {event.evidenceId && <button type="button" onClick={() => openImage(verificationEvidenceUrl(run.id, event.evidenceId!))} className="text-sky-400">{t('ide.verify.execution.evidence')}</button>}
            </li>
          ))}
        </ol>
      </details>
      {evidence.length > 0 && (
        <div className="grid grid-cols-2 gap-1">
          {evidence.map((frame, index) => (
            <button type="button" key={frame.id} title={frame.title ?? t('ide.verify.execution.frame', { index: index + 1 })}
              onClick={() => openImage(verificationEvidenceUrl(run.id, frame.id))} className="overflow-hidden rounded border border-gray-700 hover:border-sky-400">
              <img src={verificationEvidenceUrl(run.id, frame.id)} alt={t('ide.verify.execution.frame', { index: index + 1 })} loading="lazy" className="aspect-video w-full bg-black object-contain" />
            </button>
          ))}
        </div>
      )}
      {run.status === 'done' && run.verdict === 'pass' && events.some((event) => event.ok && event.operation === 'act') && !readOnly && (
        <button type="button" onClick={() => void save()} disabled={saving || saved} className="rounded border border-sky-600/60 px-1.5 py-1 text-[12px] text-sky-300 hover:border-sky-400 disabled:opacity-50">
          {t(`ide.verify.execution.${saved ? 'saved' : saving ? 'saving' : 'saveProcedure'}`)}
        </button>
      )}
      {error && <p role="alert" className="break-words text-[12px] text-rose-400">{t(`ide.verify.error.${error.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}`, { defaultValue: error })}</p>}
    </div>
  );
}
