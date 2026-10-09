import { useEffect, useMemo, useRef, useState } from 'react';
import type { AudioDoc } from '@vibisual/audio';
import { agentSessionInputKey, useGraphStore } from '../../stores/graphStore.js';
import { clientPathPlatform, sameClientPath } from '../../utils/platform.js';
import { audioDelegateAgents, buildAudioDelegatePrompt } from './audioDelegate.js';

export interface AudioDelegateProps {
  projectId: string;
  doc: AudioDoc | null;
  selectedClipId: string | null;
  selection: { start: number; end: number } | null;
  disabled?: boolean;
}

/** Delegate through the existing queue and wait for its snapshot before claiming acceptance. */
export function useAudioDelegate(input: AudioDelegateProps): {
  targets: { id: string; label: string }[];
  agentId: string;
  selectAgent: (id: string) => void;
  request: string;
  setRequest: (text: string) => void;
  status: 'idle' | 'submitting' | 'queued' | 'sendFailed';
  send: () => void;
} {
  const agents = useGraphStore((s) => s.agents);
  const projects = useGraphStore((s) => s.agentProjects);
  const configs = useGraphStore((s) => s.agentConfigs);
  const queues = useGraphStore((s) => s.queuedCommands);
  const completed = useGraphStore((s) => s.completedCommands);
  const drafts = useGraphStore((s) => s.agentSessionInputs);
  const [chosen, setChosen] = useState('');
  const [request, setRequest] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'queued' | 'sendFailed'>('idle');
  const pending = useRef<{ agentId: string; text: string } | null>(null);
  const targets = useMemo(() => audioDelegateAgents(agents, projects, configs, input.projectId, clientPathPlatform()), [agents, projects, configs, input.projectId]);
  const agentId = targets.some((agent) => agent.id === chosen) ? chosen : targets[0]?.id ?? '';
  useEffect(() => {
    const sent = pending.current;
    if (!sent) return;
    const accepted = [...(queues[sent.agentId] ?? []), ...(completed[sent.agentId] ?? [])].some((cmd) => cmd.text === sent.text);
    if (accepted) { pending.current = null; setStatus('queued'); return; }
    const draft = drafts[agentSessionInputKey(sent.agentId, null)];
    if (draft?.text.includes(sent.text) && (draft.sendFailure || draft.sendError)) {
      pending.current = null;
      setStatus('sendFailed');
    }
    if (!targets.some((agent) => agent.id === sent.agentId)) {
      pending.current = null;
      setStatus('sendFailed');
    }
  }, [queues, completed, drafts, targets]);
  const send = (): void => {
    if (input.disabled || !input.doc || !request.trim() || !agentId || pending.current) return;
    const state = useGraphStore.getState();
    // Recheck after a snapshot/project change, immediately before the side effect.
    if (!audioDelegateAgents(state.agents, state.agentProjects, state.agentConfigs, input.projectId, clientPathPlatform()).some((agent) => agent.id === agentId)) return;
    const text = buildAudioDelegatePrompt({ ...input, doc: input.doc, request, requestId: `sound-${crypto.randomUUID()}` });
    pending.current = { agentId, text };
    setStatus('submitting');
    if (state.activeProject && sameClientPath(state.activeProject, input.projectId)) {
      state.openIDEOverlay(agentId, { focus: { sessionId: null } });
    }
    state.addCommand(agentId, text, null);
  };
  return { targets, agentId, selectAgent: setChosen, request, setRequest: (text): void => {
    setRequest(text);
    if (!pending.current) setStatus('idle');
  }, status, send };
}
