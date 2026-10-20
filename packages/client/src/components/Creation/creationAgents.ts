import { isReadOnlyHookAgent, type BubbleData, type ProjectInfo } from '@vibisual/shared';
import { sameClientPath } from '../../utils/platform.js';

/**
 * Agents that may receive a creation request for this project: our own (custom) agents only — hook bubbles are
 * read-only and trashed agents are gone. Shared by every creation app (§5.13 (R-10)).
 */
export function creationProjectAgents(
  agents: BubbleData[],
  agentProjects: Record<string, string>,
  projects: Record<string, ProjectInfo>,
  projectId: string,
): BubbleData[] {
  if (!projectId) return [];
  const resolve = (value: string): string => projects[value]?.path
    ?? Object.values(projects).find((p) => p.name === value)?.path ?? value;
  const target = resolve(projectId);
  return agents.filter((agent) => {
    const owner = agentProjects[agent.id];
    return agent.customCreated === true && !agent.trashed && !!agent.path && !isReadOnlyHookAgent(agent)
      && !!owner && sameClientPath(resolve(owner), target);
  });
}
