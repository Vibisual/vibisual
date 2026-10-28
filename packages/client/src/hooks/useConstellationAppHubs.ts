import { useMemo, useSyncExternalStore } from 'react';
import type { AppBubble, ProjectInfo } from '@vibisual/shared';
import { linkedFileName } from '@vibisual/shared';

import { appLinkedItemsVersion, peekAppLinkedItems, subscribeAppLinkedItemsVersion } from '../apps/appLinkedItems.js';
import { appNodeForm, appNodeSize } from '../apps/appNodeForm.js';
import { getInternalApp } from '../apps/registry.js';
import { useGraphStore } from '../stores/graphStore.js';
import type { ConstellationAppHubView } from '../utils/constellationView.js';
import type { AppWorkPlan } from '../utils/appWorkView.js';

/**
 * §5.1 #2-1 (B) — 메인 캔버스의 **앱 노드 중심**들 — 노드가 선언한 파일을 파일 버블 `absolutePath` 와 같은 절대경로로 펴 별자리 판정에 넘긴다.
 * "연결된 것"은 묻지 않고 보이는 노드가 읽은 것을 빌린다(`peekAppLinkedItems`). 끄는 동안 좌표가 매 프레임 바뀌어 지문엔 파일·크기·숨김만. `enabled=false` 면 빈 목록.
 */
const EMPTY: readonly ConstellationAppHubView[] = [];

function joinRoot(root: string, rel: string): string {
  return `${root.replace(/[\\/]+$/, '')}/${rel}`;
}

function projectRootOf(projects: Record<string, ProjectInfo>, projectName: string): string | null {
  for (const p of Object.values(projects)) if (p.name === projectName) return p.path;
  return null;
}

function hubOf(b: AppBubble, root: string, workPlan: AppWorkPlan | undefined): ConstellationAppHubView {
  const app = getInternalApp(b.appId);
  const size = appNodeSize(app, appNodeForm(b), b);
  const results = [b.file, ...(b.pastFiles ?? []).map((p) => p.file)]
    .filter((f): f is string => typeof f === 'string' && f !== '')
    .map((f) => joinRoot(root, f));
  const items = peekAppLinkedItems(b.appId, { projectId: root, projectName: b.projectName, ref: b.ref, file: b.file });
  const parts: string[] = [];
  const codeParts: string[] = [];
  for (const item of items) {
    if (item.group !== 'part' || item.file === undefined || item.file === '') continue;
    (item.kind === 'code' ? codeParts : parts).push(joinRoot(root, item.file));
  }
  const label = b.title?.trim() || (b.file ? linkedFileName(b.file) : '') || app?.name || b.appId;
  // §5.4 #36 (I) · §5.1 #2-1 (F) ④ — 앱 작업 보기의 초점 노드면 그 작업 파일이 이 노드를 돌고, 위쪽 반원에 역할 순으로 앉는다.
  const work = workPlan?.hubs.get(b.id);
  return {
    id: b.id,
    results,
    parts,
    codeParts,
    label,
    size: Math.max(size.width, size.height),
    linksHidden: b.linksHidden === true,
    ...(work ? {
      work: work.work.map((f) => f.path),
      workSeat: { appName: work.app.name, ring: work.app.glow, appKind: work.app.kind, meta: work.meta },
    } : {}),
  };
}

export function useConstellationAppHubs(enabled: boolean, workPlan?: AppWorkPlan): readonly ConstellationAppHubView[] {
  const appBubbles = useGraphStore((s) => s.appBubbles);
  const projects = useGraphStore((s) => s.projects);
  const activeProject = useGraphStore((s) => s.activeProject);
  const linkedVersion = useSyncExternalStore(subscribeAppLinkedItemsVersion, appLinkedItemsVersion);

  // 좌표를 뺀 지문 — 끄는 동안 같은 문자열이라 아래 memo 가 다시 돌지 않는다.
  const fingerprint = useMemo(() => {
    if (!enabled) return '';
    const scoped = activeProject ? appBubbles.filter((b) => b.projectName === activeProject) : appBubbles;
    return JSON.stringify(scoped.map((b) => [
      b.id, b.appId, b.projectName, b.ref ?? '', b.file ?? '', (b.pastFiles ?? []).map((p) => p.file),
      b.title ?? '', b.linksHidden === true, b.sizedForm ?? '', b.width, b.height, (b.linkedAgentIds ?? []).length > 0,
    ]));
  }, [enabled, appBubbles, activeProject]);

  return useMemo(() => {
    if (fingerprint === '') return EMPTY;
    const scoped = activeProject
      ? useGraphStore.getState().appBubbles.filter((b) => b.projectName === activeProject)
      : useGraphStore.getState().appBubbles;
    const out: ConstellationAppHubView[] = [];
    for (const b of scoped) {
      const root = projectRootOf(projects, b.projectName);
      if (root === null) continue;
      out.push(hubOf(b, root, workPlan));
    }
    return out.length === 0 ? EMPTY : out;
    // `linkedVersion` — "연결된 것"이 새로 읽히면 다시 짓는다(값 자체는 읽지 않는다).
  }, [fingerprint, projects, activeProject, linkedVersion, workPlan]); // eslint-disable-line react-hooks/exhaustive-deps
}
