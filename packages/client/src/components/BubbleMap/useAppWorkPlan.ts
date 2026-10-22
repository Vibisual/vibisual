import { useMemo, useRef } from 'react';
import type { AppBubble, BubbleData } from '@vibisual/shared';
import { appKindOfExtensions } from '@vibisual/shared';

import { appOutputExtensions, getInternalApp } from '../../apps/registry.js';
import { cardTaskKey, useCardTaskStore } from './agentCardTaskState.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { clientPathPlatform } from '../../utils/platform.js';
import {
  EMPTY_APP_WORK_PLAN,
  appWorkPlanKey,
  planAppWork,
  type AppWorkAppInfo,
  type AppWorkPlan,
} from '../../utils/appWorkView.js';

/**
 * §5.4 #36 (I) — 메인 캔버스의 **앱 작업 보기** 판정(`planAppWork`)을 스토어에서 모아 부른다.
 *
 * - 앱 노드의 정보는 레지스트리에서 파생한다(이름 · 색 · 받는 확장자 · 다루는 종류 — 코어는 앱 이름을 모른다, §5.13 (P-4)).
 * - 결과·지난 결과는 파일 노드와 같은 절대 경로 형식으로 편다(별자리 판정과 같은 열쇠).
 * - 같은 그림이면 같은 객체를 돌려준다(`appWorkPlanKey`) — 스냅샷마다 별자리·배치를 다시 짓지 않게.
 *
 * 꺼져 있으면(폴더 안 · 휴지통 안) 빈 판정이다 — 앱 노드는 메인에만 그려진다.
 */
function joinRoot(root: string, rel: string): string {
  return `${root.replace(/[\\/]+$/, '')}/${rel}`;
}

export function useAppWorkPlan(input: {
  readonly enabled: boolean;
  readonly agents: readonly BubbleData[];
  readonly folders: readonly BubbleData[];
  readonly satellites: Readonly<Record<string, readonly BubbleData[]>>;
  readonly appBubbles: readonly AppBubble[];
}): AppWorkPlan {
  const queued = useGraphStore((s) => s.queuedCommands);
  const completed = useGraphStore((s) => s.completedCommands);
  const projects = useGraphStore((s) => s.projects);
  const agentProjects = useGraphStore((s) => s.agentProjects);
  const activeProject = useGraphStore((s) => s.activeProject);
  const cardEntries = useCardTaskStore((s) => s.entries);
  const held = useRef<{ key: string; plan: AppWorkPlan }>({ key: '', plan: EMPTY_APP_WORK_PLAN });

  return useMemo(() => {
    if (!input.enabled) return EMPTY_APP_WORK_PLAN;
    const rootOf = (projectName: string): string | null => {
      for (const p of Object.values(projects)) if (p.name === projectName) return p.path;
      return null;
    };
    const scoped = activeProject ? input.appBubbles.filter((b) => b.projectName === activeProject) : input.appBubbles;
    const apps: AppWorkAppInfo[] = [];
    for (const b of scoped) {
      if (!b.linkedAgentIds || b.linkedAgentIds.length === 0) continue;
      const app = getInternalApp(b.appId);
      const root = rootOf(b.projectName);
      const exts = app ? appOutputExtensions(app) : [];
      const results = root === null ? [] : [b.file, ...(b.pastFiles ?? []).map((p) => p.file)]
        .filter((f): f is string => typeof f === 'string' && f !== '')
        .map((f) => joinRoot(root, f));
      apps.push({
        id: b.id,
        name: app?.name ?? b.appId,
        glow: app?.glow ?? '#C4B5FD',
        exts,
        kind: appKindOfExtensions(exts),
        linkedAgentIds: b.linkedAgentIds,
        results,
      });
    }
    if (apps.length === 0) {
      held.current = { key: '', plan: EMPTY_APP_WORK_PLAN };
      return EMPTY_APP_WORK_PLAN;
    }
    const files: BubbleData[] = [];
    for (const f of input.folders) if (f.bubbleType === 'file') files.push(f);
    // Match useBubbleLayout's collectSatellites scope: cached files under off-view
    // parents never become canvas nodes and must not create an empty work orbit.
    for (const parent of [...input.agents, ...input.folders]) {
      const list = input.satellites[parent.id] ?? [];
      for (const f of list) if (f && f.bubbleType === 'file') files.push(f);
    }
    const plan = planAppWork({
      agents: input.agents.map((a) => ({ id: a.id, linkLens: a.linkLens, bubblesHidden: a.bubblesHidden })),
      apps,
      files,
      queued,
      completed,
      activeTaskNodes: (agentId) => {
        const root = rootOf(agentProjects[agentId] ?? activeProject ?? '');
        if (root === null) return null;
        const book = cardEntries[cardTaskKey(root, agentId)]?.book;
        const task = book?.tasks.find((t) => t.id === book.activeTaskId);
        return task ? task.nodeIds : null;
      },
      platform: clientPathPlatform(),
    });
    const key = appWorkPlanKey(plan);
    if (key === held.current.key) return held.current.plan;
    held.current = { key, plan };
    return plan;
  }, [input.enabled, input.agents, input.folders, input.satellites, input.appBubbles,
    queued, completed, projects, agentProjects, activeProject, cardEntries]);
}
