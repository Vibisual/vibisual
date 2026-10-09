import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { WS_PATH, type Vibi3DSnapshot } from '@vibisual/shared';
import { useGraphStore, agentSessionInputKey } from '../../stores/graphStore.js';
import { useWebSocket } from '../../hooks/useWebSocket.js';
import { vibi3dAgentPrompt, vibi3dProjectAgents } from './vibi3dAgentPrompt.js';

export interface Vibi3DAgentPanelProps {
  projectId: string;
  snapshot: Vibi3DSnapshot | null;
  connected: boolean;
  onBeforeSend: () => Promise<void>;
}

function StandaloneAgentConnection(): null {
  useWebSocket(`${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${WS_PATH}`);
  return null;
}

interface Submission { agentId: string; prompt: string; submittedAt: number }

export function Vibi3DAgentPanel(props: Vibi3DAgentPanelProps): React.JSX.Element {
  const { projectId, snapshot, connected, onBeforeSend } = props;
  const { t } = useTranslation();
  const agents = useGraphStore((s) => s.agents);
  const agentProjects = useGraphStore((s) => s.agentProjects);
  const projects = useGraphStore((s) => s.projects);
  const connectionStatus = useGraphStore((s) => s.connectionStatus);
  const queues = useGraphStore((s) => s.queuedCommands);
  const completed = useGraphStore((s) => s.completedCommands);
  const drafts = useGraphStore((s) => s.agentSessionInputs);
  const [agentId, setAgentId] = useState('');
  const [request, setRequest] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const mounted = useRef(true);
  const currentProps = useRef(props);
  currentProps.current = props;
  const eligible = useMemo(() => vibi3dProjectAgents(agents, agentProjects, projects, projectId),
    [agents, agentProjects, projects, projectId]);
  const selectedAgentId = eligible.some((agent) => agent.id === agentId) ? agentId : eligible[0]?.id ?? '';
  const standalone = typeof window !== 'undefined'
    && new URLSearchParams(window.location.hash.slice(1)).get('app') === 'vibi3d';

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setSubmission(null); setUnconfirmed(false); setError(null); }, [snapshot?.sessionId]);

  const sentCommand = submission ? [...(queues[submission.agentId] ?? []), ...(completed[submission.agentId] ?? [])]
    .find((command) => command.text === submission.prompt && command.timestamp >= submission.submittedAt - 2_000) : undefined;
  const draft = submission ? drafts[agentSessionInputKey(submission.agentId, null)] : undefined;
  const sendFailed = !!submission && !!draft?.text.includes(submission.prompt) && (!!draft.sendFailure || !!draft.sendError);
  const waiting = !!submission && !sentCommand && !sendFailed && !unconfirmed;

  useEffect(() => {
    if (!submission || sentCommand || sendFailed) return undefined;
    const timer = setTimeout(() => setUnconfirmed(true), 20_000);
    return () => clearTimeout(timer);
  }, [submission, sentCommand, sendFailed]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!snapshot || !connected || connectionStatus !== 'connected' || !request.trim() || !selectedAgentId || preparing || waiting) return;
    setPreparing(true);
    setError(null);
    try {
      await onBeforeSend();
      if (!mounted.current) return;
      const latest = currentProps.current;
      if (!latest.connected || latest.snapshot?.sessionId !== snapshot.sessionId) throw new Error(t('panel.vibi3d.agentSceneChanged', { defaultValue: 'The scene changed. Send your request again for the current model.' }));
      const state = useGraphStore.getState();
      const available = vibi3dProjectAgents(state.agents, state.agentProjects, state.projects, latest.projectId);
      if (state.connectionStatus !== 'connected' || !available.some((agent) => agent.id === selectedAgentId)) {
        throw new Error(t('panel.vibi3d.agentUnavailable', { defaultValue: 'The selected agent is unavailable. Check the connection and try again.' }));
      }
      const prompt = vibi3dAgentPrompt(latest.snapshot, request);
      setSubmission({ agentId: selectedAgentId, prompt, submittedAt: Date.now() });
      setUnconfirmed(false);
      state.addCommand(selectedAgentId, prompt, null);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (mounted.current) setPreparing(false);
    }
  };

  const disabled = !snapshot || !connected || connectionStatus !== 'connected' || !selectedAgentId || preparing || waiting;
  let status = t('panel.vibi3d.agentHint', { defaultValue: 'Select an object, then describe the change. The agent reads the current scene and view.' });
  if (!snapshot) status = t('panel.vibi3d.agentOpenFirst', { defaultValue: 'Open a model to ask an agent for changes.' });
  else if (!connected || connectionStatus !== 'connected') status = t('panel.vibi3d.agentConnecting', { defaultValue: 'Connecting to the scene and agents…' });
  else if (!eligible.length) status = t('panel.vibi3d.agentNone', { defaultValue: 'Create an agent in this project to request changes.' });
  else if (preparing || waiting) status = t('panel.vibi3d.agentSending', { defaultValue: 'Sending request…' });
  else if (sendFailed || unconfirmed) status = t('panel.vibi3d.agentSendFailed', { defaultValue: 'Request delivery could not be confirmed. Check the agent conversation before retrying. Your text is kept here.' });
  else if (sentCommand?.status === 'error') status = t('panel.vibi3d.agentTaskFailed', { defaultValue: 'The agent stopped with an error. Check its conversation for details.' });
  else if (sentCommand?.status === 'completed') status = t('panel.vibi3d.agentResponded', { defaultValue: 'The agent has responded. Review the scene and its conversation.' });
  else if (sentCommand) status = t('panel.vibi3d.agentQueued', { defaultValue: 'Request accepted. Follow progress in the selected agent conversation.' });

  return (
    <section className="shrink-0 border-t border-white/10 bg-gray-950 px-3 py-2" aria-label={t('panel.vibi3d.agentTitle', { defaultValue: 'Ask AI' })}>
      {standalone && <StandaloneAgentConnection />}
      <form onSubmit={(event) => { void submit(event); }} className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-28 flex-col gap-1 text-[11px] text-gray-400">
          {t('panel.vibi3d.agentTitle', { defaultValue: 'Ask AI' })}
          <select value={selectedAgentId} onChange={(event) => setAgentId(event.target.value)} disabled={!eligible.length || preparing || waiting}
            className="max-w-48 rounded border border-white/15 bg-gray-900 px-2 py-1.5 text-xs text-gray-200 disabled:opacity-50">
            {!eligible.length && <option value="">{t('panel.vibi3d.agentChoose', { defaultValue: 'Choose an agent' })}</option>}
            {eligible.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}
          </select>
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-[11px] text-gray-400">
          <span className="sr-only">{t('panel.vibi3d.agentRequestLabel', { defaultValue: 'Describe a scene change' })}</span>
          <input value={request} onChange={(event) => { setRequest(event.target.value); setError(null); }}
            placeholder={t('panel.vibi3d.agentPlaceholder', { defaultValue: 'Move this a little to the right and make it blue' })}
            className="w-full rounded border border-white/15 bg-gray-900 px-2 py-1.5 text-xs text-gray-100 placeholder:text-gray-500 focus:border-violet-400 focus:outline-none"
            maxLength={8_000} />
        </label>
        <button type="submit" disabled={disabled || !request.trim()}
          className="rounded bg-violet-500/25 px-3 py-1.5 text-xs text-violet-100 hover:bg-violet-500/40 disabled:cursor-not-allowed disabled:opacity-40">
          {t('panel.vibi3d.agentSend', { defaultValue: 'Request change' })}
        </button>
      </form>
      <p role={error || sendFailed || unconfirmed ? 'alert' : 'status'} className={`mt-1.5 text-[11px] ${error || sendFailed || unconfirmed ? 'text-amber-300' : 'text-gray-500'}`}>
        {error ?? status}
      </p>
    </section>
  );
}
