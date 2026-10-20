import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CREATION_QUALITY_LIMITS, WS_PATH } from '@vibisual/shared';
import { useWebSocket } from '../../hooks/useWebSocket.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { creationProjectAgents } from '../Creation/creationAgents.js';
import { CreationAgentSettings } from '../Creation/CreationAgentSettings.js';
import { CreationRunStatus, useCreationCommand, type CreationSubmission } from '../Creation/CreationRunStatus.js';
import { imageAgentPrompt } from './imageAgentBrief.js';
import type { ImageSourceDoc } from './imageApi.js';
import { imageLabelKey } from './imageLabels.js';

interface ImageAgentPanelProps {
  root: string;
  selected: string;
  doc: ImageSourceDoc | null;
  busy: boolean;
  onSave: (request?: string, selectedIds?: string[]) => Promise<ImageSourceDoc | null>;
  onAgent: (id: string) => void;
}
function ImageAgentConnection(): null {
  useWebSocket(`${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${WS_PATH}`);
  return null;
}
export function ImageAgentPanel({ root, selected, doc, busy, onSave, onAgent }: ImageAgentPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const key = (label: string): string => t(imageLabelKey(label));
  const agents = useGraphStore((s) => s.agents);
  const owners = useGraphStore((s) => s.agentProjects);
  const projects = useGraphStore((s) => s.projects);
  const connection = useGraphStore((s) => s.connectionStatus);
  const eligible = useMemo(() => creationProjectAgents(agents, owners, projects, root), [agents, owners, projects, root]);
  const [chosen, setChosen] = useState('');
  const agentId = eligible.some((agent) => agent.id === chosen) ? chosen : eligible[0]?.id ?? '';
  const [request, setRequest] = useState(typeof doc?.parameters.imageRequest === 'string' ? doc.parameters.imageRequest : '');
  const [quality, setQuality] = useState<'draft' | 'refine'>('draft');
  const [submitted, setSubmitted] = useState<CreationSubmission | null>(null);
  const [sending, setSending] = useState(false);
  const [deliveryError, setDeliveryError] = useState(false);
  const previousDoc = useRef(doc?.id);
  useEffect(() => {
    if (doc?.id === previousDoc.current) return;
    // The initial save must not clear the text the user is currently sending.
    if (previousDoc.current || !request) setRequest(typeof doc?.parameters.imageRequest === 'string' ? doc.parameters.imageRequest : '');
    previousDoc.current = doc?.id; if (!sending) setSubmitted(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id]);
  useEffect(() => { onAgent(agentId); }, [agentId, onAgent]);
  const { command, sendFailed, running } = useCreationCommand(submitted);
  const standalone = new URLSearchParams(window.location.hash.slice(1)).get('app') === 'vibimage';
  const blocked = !agentId || !request.trim() || sending || busy || running || connection !== 'connected';
  const status = sending ? 'sending' : sendFailed || deliveryError ? 'deliveryFailed' : command?.status === 'error' ? 'taskFailed'
    : running ? 'working' : submitted ? 'reviewHint' : 'agentHint';
  return <section className="shrink-0 border-t border-white/10 p-3 text-xs">
    {standalone && <ImageAgentConnection />}
    <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => {
      event.preventDefault(); if (blocked) return;
      setSending(true); setDeliveryError(false);
      void onSave(request, selected ? [selected] : []).then((saved) => {
        if (!saved || useGraphStore.getState().connectionStatus !== 'connected') { setDeliveryError(true); return; }
        const prompt = imageAgentPrompt(saved, root, request, selected, quality);
        setSubmitted({ agentId, prompt, submittedAt: Date.now() }); onAgent(agentId);
        // The stage choice is a real per-command limit (turns/time) where the engine supports it.
        void useGraphStore.getState().addCommand(agentId, prompt, null, undefined, { runLimits: CREATION_QUALITY_LIMITS[quality] });
      }).catch(() => { setDeliveryError(true); }).finally(() => setSending(false));
    }}>
      <select aria-label={key('agent')} className="max-w-40 rounded bg-gray-900 p-2" value={agentId} onChange={(event) => { setChosen(event.target.value); onAgent(event.target.value); }}>
        {!eligible.length && <option value="">{key('noAgent')}</option>}{eligible.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}
      </select>
      <input className="min-w-36 flex-1 rounded border border-white/15 bg-gray-900 p-2" aria-label={key('request')} placeholder={key('request')} value={request}
        maxLength={8000} onChange={(e) => setRequest(e.target.value)} />
      <select className="rounded bg-gray-900 p-2" aria-label={key('quality')} value={quality} onChange={(e) => setQuality(e.target.value as 'draft' | 'refine')}>
        <option value="draft">{key('draft')}</option><option value="refine">{key('refine')}</option>
      </select>
      <CreationAgentSettings agentId={agentId} />
      <button className="rounded bg-amber-200/20 px-3 py-2 disabled:opacity-40" disabled={blocked}>{key('ask')}</button>
    </form>
    <p role="status" className="mt-2 text-gray-400">{key(status)}</p>
    {submitted && <CreationRunStatus agentId={submitted.agentId} command={command} />}
  </section>;
}
