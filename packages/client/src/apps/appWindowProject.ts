import type { ProjectInfo } from '@vibisual/shared';
import { sameClientPath } from '../utils/platform.js';

export interface AppWindowProjectState {
  activeProject: string | null;
  activeIframeId: string | null;
  projects: Record<string, ProjectInfo>;
  stubProjects: Record<string, { project: ProjectInfo }>;
}

/** Tabs own their worktrees too; folder navigation must not move an editor to another tab. */
export function isAppWindowVisible(projectId: string, state: AppWindowProjectState): boolean {
  if (state.activeIframeId !== null || !state.activeProject) return false;
  const active = state.projects[state.activeProject] ?? state.stubProjects[state.activeProject]?.project;
  if (!active) return false;
  if (sameClientPath(projectId, active.path)) return true;

  const projects = [...Object.values(state.projects), ...Object.values(state.stubProjects).map(stub => stub.project)];
  // Resolve legacy name targets too, but never infer ownership from a directory prefix.
  const owner = projects.find(project => sameClientPath(project.path, projectId))
    ?? state.projects[projectId] ?? state.stubProjects[projectId]?.project;
  return !!owner && (sameClientPath(owner.path, active.path)
    || (!!owner.parentProjectPath && sameClientPath(owner.parentProjectPath, active.path)));
}
