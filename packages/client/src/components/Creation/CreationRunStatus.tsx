import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { QueuedCommand } from '@vibisual/shared';
import { useSessionStop } from '../../hooks/useSessionStop.js';
import { agentSessionInputKey, useGraphStore } from '../../stores/graphStore.js';

export interface CreationSubmission { agentId: string; prompt: string; submittedAt: number }

/** The command a creation panel sent (queued or finished), found by its text and send time. */
export function findCreationCommand(
  submission: CreationSubmission | null, queues: Record<string, QueuedCommand[]>, completed: Record<string, QueuedCommand[]>,
): QueuedCommand | undefined {
  if (!submission) return undefined;
  return [...(queues[submission.agentId] ?? []), ...(completed[submission.agentId] ?? [])]
    .find((command) => command.text === submission.prompt && command.timestamp >= submission.submittedAt - 2_000);
}

export function useCreationCommand(submission: CreationSubmission | null) {
  const queues = useGraphStore((s) => s.queuedCommands);
  const completed = useGraphStore((s) => s.completedCommands);
  const drafts = useGraphStore((s) => s.agentSessionInputs);
  const command = findCreationCommand(submission, queues, completed);
  const draft = submission ? drafts[agentSessionInputKey(submission.agentId, null)] : undefined;
  const sendFailed = !!submission && !!draft?.text.includes(submission.prompt) && (!!draft.sendFailure || !!draft.sendError);
  const running = command?.status === 'executing' || command?.status === 'queued';
  return { command, sendFailed, running };
}

function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * §5.13 (R-10) — shows only the limits the server actually applied (never a promised cost), and a stop button for the
 * running session (the main session too, so it never disappears for lack of a sub-session id).
 */
export function CreationRunStatus({ agentId, command }: { agentId: string; command: QueuedCommand | undefined }): React.JSX.Element | null {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());
  const running = command?.status === 'executing' || command?.status === 'queued';
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [running]);
  const stop = useSessionStop(agentId, command?.subAgentId ?? null);
  if (!command) return null;
  const started = command.startedAt ?? command.timestamp;
  const limits = command.runLimitsApplied;
  return <div className="mt-2 space-y-1 text-xs text-gray-400" role="status">
    {running && <div className="h-1 overflow-hidden rounded bg-white/10" aria-hidden="true">
      <div className="h-full w-1/3 animate-pulse rounded bg-amber-200/60" />
    </div>}
    <div className="flex flex-wrap items-center gap-2">
      <span>{t(command.status === 'queued' ? 'panel.creation.run.queued' : running ? 'panel.creation.run.running' : 'panel.creation.run.finished',
        { elapsed: clock((running ? now : command.timestamp) - started) })}</span>
      {limits && <span>{t('panel.creation.run.limits', {
        limits: [limits.maxTurns ? t('panel.creation.run.turns', { count: limits.maxTurns }) : '', limits.maxMinutes ? t('panel.creation.run.minutes', { count: limits.maxMinutes }) : '']
          .filter(Boolean).join(' · '),
      })}</span>}
      {command.runLimitHit === 'maxMinutes' && <span className="text-amber-200">{t('panel.creation.run.timeLimitHit')}</span>}
      {command.error?.code === 'maxTurns' && <span className="text-amber-200">{t('panel.creation.run.turnLimitHit')}</span>}
      {running && <button type="button" className="rounded bg-red-900/50 px-3 py-1 text-gray-100 disabled:opacity-40 pointer-coarse:py-2" disabled={stop.stopping} onClick={stop.stop}>
        {t('ide.mainArea.stop')}
      </button>}
    </div>
    {(stop.outcome.kind === 'failed' || stop.outcome.kind === 'nothing') && <p role="alert" className="text-amber-200">
      {stop.outcome.kind === 'nothing' ? t('ide.mainArea.stopNothing') : t('ide.mainArea.stopFailed', { status: stop.outcome.status ?? 0 })}
    </p>}
  </div>;
}
