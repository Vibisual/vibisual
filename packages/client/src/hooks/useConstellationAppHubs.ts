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
 * §5.1 #2-1 (B) — 메인 캔버스의 **앱 노드 중심**들. 노드마다 그 노드가 선언한 파일(결과 · 지난 결과 · "연결된 것"의 파일 ·
 * 코드 소재)을 절대경로로 펴서 별자리 판정에 넘긴다 — 파일 버블의 `absolutePath` 와 같은 형식이라야 맞춰진다.
 *
 * - "연결된 것"은 **묻지 않고** 보이는 노드가 이미 읽어 둔 것을 빌려 쓴다(`peekAppLinkedItems`). 앱 노드가 화면에 들어와
 *   읽으면 전역 판본이 올라 여기도 다시 짓는다.
 * - 앱 노드는 끄는 동안 매 프레임 좌표가 바뀐다 — 좌표는 지문에서 빼고 **파일·크기·숨김**만 본다(끄는 내내 판정이 다시
 *   돌지 않게). 새 위성의 첫 자리는 BubbleMap 이 그 순간의 좌표로 따로 잡는다.
 * - 끄면(`enabled=false` — 폴더 안·휴지통 안) 빈 목록이다. 앱 노드는 메인에만 그려진다.
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
