import type { AutoGoalSettings } from '@vibisual/shared';
import { buildAutoGoalPromptBlock } from './autoGoalService.js';
import { buildAutoGoalAgentProtocol } from './autoGoalAgentProtocol.js';

export interface AutoGoalHookContextDeps {
  agentBySession: (sessionId: string) => { id: string; customCreated?: boolean } | null;
  /** Managed sessions already receive this context through command dispatch. */
  isManagedSession: (sessionId: string) => boolean;
  /** Returns the loaded canonical project root; hook cwd is never storage authority. */
  rootForAgent: (agentId: string) => string | null;
  settings: (root: string) => AutoGoalSettings | undefined;
  contextEnabled: (agentId: string, sessionId: string) => boolean;
  identityFile?: string;
  log?: (error: unknown) => void;
}

/** UserPromptSubmit is the only prompt channel for an externally connected Claude session. */
export function buildAutoGoalHookContext(
  input: { session_id: string; prompt?: string }, deps: AutoGoalHookContextDeps,
): string {
  try {
    if (deps.isManagedSession(input.session_id)) return '';
    const agent = deps.agentBySession(input.session_id);
    if (!agent || agent.customCreated || !deps.contextEnabled(agent.id, input.session_id)) return '';
    const root = deps.rootForAgent(agent.id);
    if (!root) return '';
    const ids = { agentId: agent.id, subAgentId: input.session_id };
    const block = buildAutoGoalPromptBlock(root, deps.settings(root), ids, input.prompt ?? '');
    if (!block) return '';
    return `${block}\n\n${buildAutoGoalAgentProtocol({ ...ids, root, ...(deps.identityFile ? { identityFile: deps.identityFile } : {}) })}`;
  } catch (error) {
    deps.log?.(error);
    return '';
  }
}
