import { hasSessionWork, isSessionRunning, type SessionRunInputs } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { buildSessionRunInputs } from '../../utils/sessionStatus.js';

/** Display scope only: the card's command destination is still chosen by pickCardSession. */
export function useAgentCardWork(agentId: string, sessionId: string | null): 'running' | 'waiting' | 'idle' {
  return useGraphStore((state) => {
    const subs = state.subAgents[agentId] ?? [];
    const commands = state.queuedCommands[agentId];
    const runningTasks = state.runningSubagentTasks[agentId];
    const inputs: SessionRunInputs[] = [];
    if (sessionId !== null) {
      const sub = subs.find((candidate) => candidate.id === sessionId);
      if (!sub) return 'idle';
      inputs.push(buildSessionRunInputs({ sub, commands, runningTasks, acknowledged: false }));
    } else if (subs.length === 0) {
      inputs.push(buildSessionRunInputs({
        sub: null, commands, runningTasks, acknowledged: false,
        agentStatus: state.agents.find((agent) => agent.id === agentId)?.status,
      }));
    } else {
      // A custom parent's active status is retained while commands wait in its queue.
      // Known sessions must therefore use their own status, including zombie-execution filtering.
      const knownIds = new Set(subs.map((sub) => sub.id));
      for (const sub of subs) {
        inputs.push(buildSessionRunInputs({ sub, commands, runningTasks: undefined, acknowledged: false }));
      }
      // Count all model children once, including those whose owner could not be resolved.
      // The shared builder excludes background shells. Unknown command owners retain its fallback.
      inputs.push(buildSessionRunInputs({
        sub: null,
        commands: commands?.filter((command) => command.subAgentId === null || !knownIds.has(command.subAgentId)),
        runningTasks,
        acknowledged: false,
      }));
    }
    if (inputs.some(isSessionRunning)) return 'running';
    return inputs.some(hasSessionWork) ? 'waiting' : 'idle';
  });
}
