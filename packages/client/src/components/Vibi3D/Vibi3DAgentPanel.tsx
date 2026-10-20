import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CREATION_QUALITY_LIMITS, WS_PATH, readVibi3DAuthoring, type CreationDoc, type Vibi3DSnapshot } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { useWebSocket } from '../../hooks/useWebSocket.js';
import { prepareVibi3DRun, vibi3DResumePrompt } from './vibi3dWorkflow.js';
import { requestsVibi3DBlender } from './vibi3dAuthoringChoice.js';
import { AppAgentPreparationError } from '../../apps/registry.js';
import { creationErrorText } from '../Creation/creationErrors.js';
import { vibi3dCandidatePrompt } from './vibi3dCandidatePrompt.js';
import { vibi3dAgentPrompt } from './vibi3dAgentPrompt.js';
import { creationProjectAgents } from '../Creation/creationAgents.js';
import { CreationAgentSettings } from '../Creation/CreationAgentSettings.js';
import { CreationRunStatus, useCreationCommand, type CreationSubmission } from '../Creation/CreationRunStatus.js';
import { Vibi3DProductionPanel } from './Vibi3DProductionPanel.js';
import type { ProductionParameterRequest } from './vibi3dProduction.js';

export interface Vibi3DAgentPanelProps {
  projectId: string;
  snapshot: Vibi3DSnapshot | null;
  connected: boolean;
  onBeforeSend: () => Promise<void>;
  sourceDoc?: CreationDoc | null;
  sourceDirty?: boolean;
  sourceBusy?: boolean;
  /** The agent work branch has durably saved its current revision, independently of the source. */
  draftSaved?: boolean;
}

function retainedNativeDraft(props: Vibi3DAgentPanelProps, request: string, parameterRequest?: ProductionParameterRequest): boolean {
  return !!props.sourceDoc && !!props.sourceDirty && props.draftSaved === true && !parameterRequest
    && !readVibi3DAuthoring(props.sourceDoc.payload) && !requestsVibi3DBlender(request);
}

function sourceNeedsSave(props: Vibi3DAgentPanelProps, request: string, propose: boolean, parameterRequest?: ProductionParameterRequest): boolean {
  const requiresCommittedSource = !!parameterRequest || !!readVibi3DAuthoring(props.sourceDoc?.payload) || requestsVibi3DBlender(request);
  return !!props.sourceDoc && !!props.sourceDirty && (propose || requiresCommittedSource)
    && !retainedNativeDraft(props, request, parameterRequest);
}

function StandaloneAgentConnection(): null {
  useWebSocket(`${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${WS_PATH}`);
  return null;
}

export function Vibi3DAgentPanel(props: Vibi3DAgentPanelProps): React.JSX.Element {
  const { projectId, snapshot, connected, onBeforeSend } = props;
  const { t } = useTranslation();
  const agents = useGraphStore((s) => s.agents);
  const agentProjects = useGraphStore((s) => s.agentProjects);
  const projects = useGraphStore((s) => s.projects);
  const connectionStatus = useGraphStore((s) => s.connectionStatus);
  const [agentId, setAgentId] = useState('');
  const [reviewMode, setReviewMode] = useState(true);
  const [quality, setQuality] = useState<'draft' | 'refine'>('draft');
  const [request, setRequest] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submission, setSubmission] = useState<CreationSubmission | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const mounted = useRef(true);
  const currentProps = useRef(props);
  currentProps.current = props;
  const eligible = useMemo(() => creationProjectAgents(agents, agentProjects, projects, projectId),
    [agents, agentProjects, projects, projectId]);
  const selectedAgentId = eligible.some((agent) => agent.id === agentId) ? agentId : eligible[0]?.id ?? '';
  const standalone = typeof window !== 'undefined'
    && new URLSearchParams(window.location.hash.slice(1)).get('app') === 'vibi3d';

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setSubmission(null); setUnconfirmed(false); setError(null); }, [snapshot?.sessionId]);

  const { command: sentCommand, sendFailed, running } = useCreationCommand(submission);
  const delivering = !!submission && !sentCommand && !sendFailed && !unconfirmed;
  // One request at a time: the next waits until the running one finished or was stopped.
  const waiting = delivering || running;

  useEffect(() => {
    if (!submission || sentCommand || sendFailed) return undefined;
    const timer = setTimeout(() => setUnconfirmed(true), 20_000);
    return () => clearTimeout(timer);
  }, [submission, sentCommand, sendFailed]);

  const send = async (text: string, parameterRequest?: ProductionParameterRequest): Promise<void> => {
    const propose = reviewMode || !!parameterRequest;
    if (sourceNeedsSave(props, text, propose, parameterRequest) || props.sourceBusy || !snapshot || !connected || connectionStatus !== 'connected' || !text.trim() || !selectedAgentId || preparing || waiting) return;
    setPreparing(true);
    setError(null);
    try {
      await onBeforeSend();
      if (!mounted.current) return;
      const latest = currentProps.current;
      if (!latest.connected || latest.snapshot?.sessionId !== snapshot.sessionId) throw new Error(t('panel.vibi3d.agentSceneChanged', { defaultValue: 'The scene changed. Send your request again for the current model.' }));
      if (sourceNeedsSave(latest, text, propose, parameterRequest) || latest.sourceBusy) throw new Error(t('panel.creation.saveFirst'));
      if (parameterRequest && (latest.sourceDoc?.id !== parameterRequest.documentId || latest.sourceDoc.revision !== parameterRequest.revision)) {
        throw new Error(t('panel.vibi3d.agentSceneChanged'));
      }
      const state = useGraphStore.getState();
      const available = creationProjectAgents(state.agents, state.agentProjects, state.projects, latest.projectId);
      if (state.connectionStatus !== 'connected' || !available.some((agent) => agent.id === selectedAgentId)) {
        throw new Error(t('panel.vibi3d.agentUnavailable', { defaultValue: 'The selected agent is unavailable. Check the connection and try again.' }));
      }
      const limits = CREATION_QUALITY_LIMITS[quality];
      const direction = quality === 'draft'
        ? 'Make a quick editable draft with modest geometry complexity. Preserve all unrelated elements.'
        : 'Refine the selected elements with more careful geometry and material detail, preserving unrelated elements.';
      const native = !parameterRequest && !readVibi3DAuthoring(latest.sourceDoc?.payload) && !requestsVibi3DBlender(text);
      // A retained work draft is not the committed document. Preparing a new document run
      // would reopen that older source or require an implicit commit of this branch.
      const prepared = native && latest.sourceDoc && !latest.sourceDirty ? await prepareVibi3DRun(latest.projectId, latest.sourceDoc.id) : null;
      if (!mounted.current) return;
      if (currentProps.current.snapshot?.sessionId !== latest.snapshot.sessionId || currentProps.current.sourceDoc?.id !== latest.sourceDoc?.id) {
        throw new Error(t('panel.vibi3d.agentSceneChanged'));
      }
      const liveSnapshot = prepared?.snapshot ?? latest.snapshot;
      const continuingDraft = retainedNativeDraft(latest, text, parameterRequest);
      const base = continuingDraft
        ? vibi3dAgentPrompt(liveSnapshot, text, { workDraft: true })
        : propose && latest.sourceDoc ? vibi3dCandidatePrompt(liveSnapshot, latest.sourceDoc, text, !!parameterRequest) : vibi3dAgentPrompt(liveSnapshot, text);
      const prompt = `${base}\n${vibi3DResumePrompt(prepared?.previousRun ?? null)}\n\nProduction stage: ${quality}. ${direction} This request runs with a limit of ${limits.maxMinutes} minutes`
        + ` (and ${limits.maxTurns} turns where the engine supports it); finish a usable result within it and never claim a fixed cost.`;
      setSubmission({ agentId: selectedAgentId, prompt, submittedAt: Date.now() });
      setUnconfirmed(false);
      // The stage is a real per-command limit (turns on engines that support it, time on every engine).
      void state.addCommand(selectedAgentId, prompt, null, undefined, { runLimits: limits, ...(native ? { executionRequirements: { localTransport: true } } : {}) });
    } catch (failure) {
      if (mounted.current) setError(failure instanceof AppAgentPreparationError ? creationErrorText(t, failure) : failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (mounted.current) setPreparing(false);
    }
  };
  const submit = async (event: FormEvent): Promise<void> => { event.preventDefault(); await send(request); };

  const draftCanContinue = retainedNativeDraft(props, request);
  const disabled = sourceNeedsSave(props, request, reviewMode) || !!props.sourceBusy || !snapshot || !connected || connectionStatus !== 'connected' || !selectedAgentId || preparing || waiting;
  const projectRoot = projects[projectId]?.path ?? Object.values(projects).find((project) => project.path === projectId)?.path ?? projectId;
  let status = t('panel.vibi3d.agentHint', { defaultValue: 'Select an object, then describe the change. The agent reads the current scene and view.' });
  if (!snapshot) status = t('panel.vibi3d.agentOpenFirst', { defaultValue: 'Open a model to ask an agent for changes.' });
  else if (!connected || connectionStatus !== 'connected') status = t('panel.vibi3d.agentConnecting', { defaultValue: 'Connecting to the scene and agents…' });
  else if (!eligible.length) status = t('panel.vibi3d.agentNone', { defaultValue: 'Create an agent in this project to request changes.' });
  else if (preparing || delivering) status = t('panel.vibi3d.agentSending', { defaultValue: 'Sending request…' });
  else if (sendFailed || unconfirmed) status = t('panel.vibi3d.agentSendFailed', { defaultValue: 'Request delivery could not be confirmed. Check the agent conversation before retrying. Your text is kept here.' });
  else if (sentCommand?.status === 'error') status = t('panel.vibi3d.agentTaskFailed', { defaultValue: 'The agent stopped with an error. Check its conversation for details.' });
  else if (sentCommand?.status === 'completed') status = t('panel.vibi3d.agentResponded', { defaultValue: 'The agent has responded. Review the scene and its conversation.' });
  else if (sentCommand) status = t('panel.vibi3d.agentQueued', { defaultValue: 'Request accepted. Follow progress in the selected agent conversation.' });

  return (
    <section className="shrink-0 border-t border-white/10 bg-gray-950 px-3 py-2" aria-label={t('panel.vibi3d.agentTitle', { defaultValue: 'Ask AI' })}>
      {standalone && <StandaloneAgentConnection />}
      {props.sourceDoc && <Vibi3DProductionPanel doc={props.sourceDoc} projectRoot={projectRoot} disabled={disabled || !!props.sourceDirty}
        dirty={!!props.sourceDirty} onApply={(change) => send(change.text, change)} />}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-300">
        <select aria-label={t('panel.vibi3d.review.stage')} value={quality} onChange={(event) => setQuality(event.target.value as 'draft' | 'refine')} disabled={preparing || waiting} className="rounded bg-gray-900 px-2 py-1 pointer-coarse:py-2">
          <option value="draft">{t('panel.vibi3d.review.draft')}</option><option value="refine">{t('panel.vibi3d.review.refine')}</option>
        </select>
        <CreationAgentSettings agentId={selectedAgentId} />
      </div>
      {props.sourceDoc && <label className="mb-2 flex items-center gap-2 text-xs text-gray-300">
        <input type="checkbox" checked={reviewMode} onChange={(e) => setReviewMode(e.target.checked)} disabled={preparing || waiting} />
        {t('panel.vibi3d.review.propose')} {reviewMode && props.sourceDirty && !draftCanContinue && <span className="text-amber-300">{t('panel.creation.saveFirst')}</span>}
      </label>}
      <form onSubmit={(event) => { void submit(event); }} className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-28 flex-col gap-1 text-xs text-gray-400">
          {t('panel.vibi3d.agentTitle', { defaultValue: 'Ask AI' })}
          <select value={selectedAgentId} onChange={(event) => setAgentId(event.target.value)} disabled={!eligible.length || preparing || waiting}
            className="max-w-48 rounded border border-white/15 bg-gray-900 px-2 py-1.5 text-xs text-gray-200 disabled:opacity-50 pointer-coarse:py-2">
            {!eligible.length && <option value="">{t('panel.vibi3d.agentChoose', { defaultValue: 'Choose an agent' })}</option>}
            {eligible.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}
          </select>
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-gray-400">
          <span className="sr-only">{t('panel.vibi3d.agentRequestLabel', { defaultValue: 'Describe a scene change' })}</span>
          <input value={request} onChange={(event) => { setRequest(event.target.value); setError(null); }}
            placeholder={t('panel.vibi3d.agentPlaceholder', { defaultValue: 'Move this a little to the right and make it blue' })}
            className="w-full rounded border border-white/15 bg-gray-900 px-2 py-1.5 text-xs text-gray-100 placeholder:text-gray-500 focus:border-violet-400 focus:outline-none pointer-coarse:py-2"
            maxLength={8_000} />
        </label>
        <button type="submit" disabled={disabled || !request.trim()}
          className="rounded bg-violet-500/25 px-3 py-1.5 text-xs text-violet-100 hover:bg-violet-500/40 disabled:cursor-not-allowed disabled:opacity-40 pointer-coarse:py-2">
          {t('panel.vibi3d.agentSend', { defaultValue: 'Request change' })}
        </button>
      </form>
      <p role={error || sendFailed || unconfirmed ? 'alert' : 'status'} className={`mt-1.5 text-xs ${error || sendFailed || unconfirmed ? 'text-amber-300' : 'text-gray-500'}`}>
        {error ?? status}
      </p>
      {submission && <CreationRunStatus agentId={submission.agentId} command={sentCommand} />}
    </section>
  );
}
