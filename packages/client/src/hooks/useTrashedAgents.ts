import { useMemo } from 'react';
import type { BubbleData } from '@vibisual/shared';
import { useGraphStore } from '../stores/graphStore.js';

/**
 * §5.10 — 현재 프로젝트의 버려진(trashed) 커스텀 에이전트 목록.
 *
 * 휴지통은 **뚜껑(개수 배지)·속(내부 뷰 목록)·삭제 대상이 전부 같은 배열에서 나와야** 한다(v3.73).
 * 버블맵(내부 뷰 콘텐츠·배지)과 휴지통 툴바([모두 삭제])가 각자 필터를 짜면 그 순간 둘이 어긋나므로
 * 스코프 계산을 이 훅 하나로 모은다.
 *
 * 스코프 규칙은 캔버스 에이전트 필터와 같다 — worktree 버블 내부로 드릴다운 중이면 그 worktree
 * 프로젝트, 아니면 활성 프로젝트(전 프로젝트 합산 ❌ — §3.5 프로젝트 독립성).
 */
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
