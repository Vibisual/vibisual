import { useMemo } from 'react';
import type { BubbleData } from '@vibisual/shared';
import { useGraphStore } from '../stores/graphStore.js';

/** §5.10 — 현재 프로젝트의 버려진 커스텀 에이전트 — 휴지통 배지·내부 뷰·[모두 삭제]가 **같은 배열**을 써야 해 이 훅 하나로. 스코프: worktree 버블 안이면 그 worktree, 아니면 활성 프로젝트(합산 ❌ — §3.5). */
export function useTrashedAgents(): BubbleData[] {
  const allAgents = useGraphStore((s) => s.agents);
  const agentProjects = useGraphStore((s) => s.agentProjects);
  const activeProject = useGraphStore((s) => s.activeProject);
  const worktreeProjects = useGraphStore((s) => s.worktreeProjects);
  const currentFolderId = useGraphStore((s) => s.currentFolderId);

  return useMemo(() => {
    const project = (currentFolderId && worktreeProjects[currentFolderId]) || activeProject;
    const inProject = !project ? allAgents : allAgents.filter((a) => agentProjects[a.id] === project);
    return inProject.filter((a) => a.trashed);
  }, [allAgents, agentProjects, activeProject, worktreeProjects, currentFolderId]);
}
