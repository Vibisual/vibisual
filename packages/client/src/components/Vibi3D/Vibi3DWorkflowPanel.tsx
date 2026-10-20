import { useTranslation } from 'react-i18next';
import { creationErrorText } from '../Creation/creationErrors.js';
import { openWorkspaceFile } from '../IDE/useWorkspaceExplorer.js';
import { ScrollFade } from '../ScrollFade.js';
import { useVibi3DWorkflow } from './useVibi3DWorkflow.js';

export interface Vibi3DWorkflowPanelProps { projectId: string; documentId: string; revision: number }

/** Saved checks show their recorded status. Capturing an image never implies that an agent reviewed it. */
export function Vibi3DWorkflowPanel({ projectId, documentId, revision }: Vibi3DWorkflowPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const { run, error, refresh } = useVibi3DWorkflow(projectId, documentId, revision);
  const modeKeys = { commit: 'modeCommit', intermediate: 'modeIntermediate', candidate: 'modeCandidate' } as const;
  const checkKeys = { passed: 'checkPassed', failed: 'checkFailed', 'needs-review': 'checkNeedsReview' } as const;
  return <details className="mb-2 min-w-0 rounded border border-vb-code-border p-2 text-xs text-vb-code-fg">
    <summary className="cursor-pointer pointer-coarse:py-2">{t('panel.vibi3d.workflow.title')}</summary>
    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
      <span className="min-w-0 flex-1 truncate">{run
        ? t('panel.vibi3d.workflow.run', { count: run.stages.length, revision: run.baseRevision })
        : t('panel.vibi3d.workflow.empty')}</span>
      <button type="button" onClick={refresh} className="shrink-0 rounded bg-vb-sunken px-2 py-1.5 hover:bg-vb-raised pointer-coarse:py-2">
        {t('panel.gitStatus.refresh')}
      </button>
    </div>
    {!!error && <p className="mt-2 text-vb-code-fg font-medium" role="status">{creationErrorText(t, error)}</p>}
    {run && <ScrollFade maxHeight={300}>
      <ol className="mt-2 min-w-0 space-y-2">
        {run.stages.map(stage => <li key={stage.sourcePath} className="min-w-0 rounded bg-vb-sunken p-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate" title={stage.label}>{stage.label}</span>
            <span className="text-vb-code-fg/70">{t(`panel.vibi3d.workflow.${modeKeys[stage.mode]}`)}</span>
          </div>
          <p className="mt-1 text-vb-code-fg/70">{t('panel.vibi3d.production.savedStage', {
            revision: stage.revision, time: new Date(stage.createdAt).toLocaleString(),
          })}</p>
          <ul className="mt-1 space-y-1">
            {stage.captures.map(capture => <li key={capture.path} className="min-w-0">
              <button type="button" title={capture.path} onClick={() => openWorkspaceFile(projectId, capture.path)}
                className="w-full truncate text-left text-vb-code-fg underline hover:opacity-80 pointer-coarse:py-2">
                {capture.view} · {capture.mode} · {capture.width} × {capture.height}
              </button>
            </li>)}
          </ul>
          <ul className="mt-1 space-y-1 text-vb-code-fg/70">
            {stage.checks.map(check => <li key={check.id}>
              {t(`panel.vibi3d.workflow.${checkKeys[check.status]}`)} · {check.note ?? check.id}
              {check.evidencePath && <button type="button" title={check.evidencePath}
                onClick={() => openWorkspaceFile(projectId, check.evidencePath!)}
                className="ml-2 text-vb-code-fg underline hover:opacity-80 pointer-coarse:py-2">{t('panel.vibi3d.workflow.evidence')}</button>}
            </li>)}
          </ul>
        </li>)}
      </ol>
    </ScrollFade>}
  </details>;
}
