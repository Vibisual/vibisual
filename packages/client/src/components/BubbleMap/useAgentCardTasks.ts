import { useEffect, useMemo } from 'react';
import { useGraphStore } from '../../stores/graphStore.js';
import { cardTaskKey, loadCardTasks, useCardTaskStore, type CardTaskEntry } from './agentCardTaskState.js';
import { runReservedCardTask } from './agentCardTaskFlow.js';

const EMPTY: CardTaskEntry = {};
let scheduled = false;
function scheduleReservations(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    for (const [key, entry] of Object.entries(useCardTaskStore.getState().entries)) {
      if (entry.book?.pending?.status !== 'waiting') continue;
      const [projectId, agentId] = JSON.parse(key) as [string, string];
      void runReservedCardTask(projectId, agentId);
    }
  });
}
// The reservation outlives a culled canvas card. Only server CAS can claim it.
useGraphStore.subscribe(scheduleReservations);
useCardTaskStore.subscribe(scheduleReservations);

export function useAgentCardTasks(agentId: string): { projectId: string | undefined; entry: CardTaskEntry; key: string } {
  const projectId = useGraphStore((state) => {
    const name = state.agentProjects[agentId] ?? state.activeProject;
    return Object.values(state.projects).find((project) => project.name === name)?.path;
  });
  const key = cardTaskKey(projectId ?? '', agentId);
  const entry = useCardTaskStore((state) => state.entries[key] ?? EMPTY);
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    const refresh = (): void => {
      void loadCardTasks(projectId, agentId).catch(() => {
        if (alive) useCardTaskStore.getState().patch(key, { loading: false, error: 'history-unavailable' });
      });
    };
    useCardTaskStore.getState().patch(key, { loading: !useCardTaskStore.getState().entries[key]?.book });
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [projectId, agentId, key]);
  return useMemo(() => ({ projectId, entry, key }), [projectId, entry, key]);
}
