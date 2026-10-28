import { useMemo } from 'react';
import type { Edge } from '@xyflow/react';
import type { BubbleData, ActivityEdge, PipelineState } from '@vibisual/shared';
import { BUBBLE_COLORS, LAYOUT_CENTER_X, LAYOUT_CENTER_Y, PIPELINE_PARENT_BUBBLE_ID } from '@vibisual/shared';
import { collectSatellites } from '../utils/satellite.js';
import { withBundleUsageRange, withScreenFileRange } from '../utils/sizeCalc.js';
import { packBundleInterior } from '../utils/bundleInteriorLayout.js';
import type { InteriorView } from '../stores/graphStore.js';
import { applyConstellations, type ConstellationAppHubView } from '../utils/constellationView.js';
import { clientPathPlatform } from '../utils/platform.js';
import { useHeatScale } from './useHeatScale.js';
import {
  radialLayout,
  radialItemsOf,
  buildFlowEdge,
  findRadius,
  buildSatelliteEdges,
  appendSatelliteBubbles,
  EMPTY_VIEW_DATA,
  type ViewData,
} from '../utils/flowBuilder.js';

// ─── 메인 뷰 데이터 Hook ───

interface UseBubbleLayoutProps {
  agents: BubbleData[];
  folders: BubbleData[];
  edges: ActivityEdge[];
  satellites: Record<string, BubbleData[]>;
  satellitePositions?: Record<string, { x: number; y: number }>;
  /** §5.10 — 최상위 캔버스 상주 버블(`__trash__`). 폴더 내부에는 표시 ❌. */
  residentBubbles?: BubbleData[];
  /** §5.1 #2-1 (B) — 메인 캔버스의 앱 노드 중심(그 노드가 선언한 파일들). 없으면 파일 중심만. */
  appHubs?: readonly ConstellationAppHubView[];
  /** §5.1 #2-1 (B) — 최상위 파일 묶음(프로젝트 루트)의 이름 = 지금 탭의 프로젝트 이름. */
  rootLabel?: string | null;
  /** §5.1 #2-1 (B) — 폴더 위성 묶음의 구성을 지금 턴의 것만으로(캔버스만 — IDE 세션 지도는 턴 표시가 없다). */
  openTurnOnly?: boolean;
}

const NO_APP_HUBS: readonly ConstellationAppHubView[] = [];
const NO_BUBBLES: BubbleData[] = [];

/** 폴더 안 내비게이션 버블 — `← Back`(한 단계 위) · `Root→`(이 폴더의 홈). */
const FOLDER_BACK_ID = '__root_back__';
const FOLDER_HOME_ID = '__root_home__';

/** §5.1 #2-2 — 폴더 안 내비게이션 버블 id. 배치(`radialLayout` 중심)가 세우는 고정물이라 등장 영역 규칙(`isSpawnZoneSeated`)에서 뺀다. */
export const FOLDER_NAV_IDS: ReadonlySet<string> = new Set([FOLDER_BACK_ID, FOLDER_HOME_ID]);

const NO_BUNDLED: ReadonlyMap<string, string> = new Map();

/**
 * §5.1 #2-1 (B) — 위성이 된 직속 파일로 오던 선을 새 노드로 옮긴다(`dropWith` 면 그 노드와 위성 사이 선은 버린다).
 * 묶음에 든 파일의 선은 묶음 버블로 옮기고 같은 끝점은 하나만 남긴다(하나라도 `animated` 면 도는 선).
 */
export function remapConverted(
  edges: Edge[],
  converted: ReadonlyMap<string, string>,
  dropWith?: string,
  bundled: ReadonlyMap<string, string> = NO_BUNDLED,
): Edge[] {
  if (converted.size === 0 && bundled.size === 0) return edges;
  const out: Edge[] = [];
  /** 묶음으로 옮긴 선의 끝점 쌍 → `out` 안의 자리. */
  const bundledAt = new Map<string, number>();
  for (const e of edges) {
    const cs = converted.get(e.source);
    const ct = converted.get(e.target);
    const bs = bundled.get(e.source);
    const bt = bundled.get(e.target);
    if (cs === undefined && ct === undefined && bs === undefined && bt === undefined) {
      out.push(e);
      continue;
    }
    if ((cs !== undefined || ct !== undefined) && dropWith !== undefined && (e.source === dropWith || e.target === dropWith)) continue;
    const moved = { ...e, source: cs ?? bs ?? e.source, target: ct ?? bt ?? e.target };
    if (bs === undefined && bt === undefined) {
      out.push(moved);
      continue;
    }
    const key = `${moved.source}\u0000${moved.target}`;
    const at = bundledAt.get(key);
    if (at === undefined) {
      bundledAt.set(key, out.length);
      out.push(moved);
    } else if (moved.animated === true && out[at]!.animated !== true) {
      out[at] = moved;
    }
  }
  return out;
}

/** 메인 뷰 레이아웃 — agents·folders·edges·satellites 로 React Flow 노드/엣지를 짓는다. */
export function useBubbleLayout({
  agents,
  folders,
  edges,
  satellites,
  satellitePositions,
  residentBubbles = [],
  appHubs = NO_APP_HUBS,
  rootLabel = null,
  openTurnOnly = false,
}: UseBubbleLayoutProps): ViewData {
  // §5.24 — 히트맵이 켜져 있으면 배치도 렌더와 **같은 자**를 써야 한다(안 그러면 화살표가 빗나간다).
  const heat = useHeatScale();
  return useMemo(() => {
    if (agents.length === 0 && folders.length === 0 && residentBubbles.length === 0) return EMPTY_VIEW_DATA;

    const cx = LAYOUT_CENTER_X;
    const cy = LAYOUT_CENTER_Y;

    // §5.1 #2-1 (B) — 작업물 별자리. 위성이 된 최상위 파일은 원 둘레에서 빠지므로 `radialLayout` 은 그 **뒤의** 목록으로 짓는다.
    // 같은 종류 둘 이상인 최상위 파일은 묶음 하나(이름은 프로젝트 이름)로 선다.
    const rawSatInfos = collectSatellites([...agents, ...folders], satellites, heat, satellitePositions);
    const cv = applyConstellations({
      radial: folders,
      satInfos: rawSatInfos,
      appHubs,
      heat,
      platform: clientPathPlatform(),
      satellitePositions,
      openTurnOnly,
      ...(rootLabel ? { rootLabel } : {}),
    });
    // §2.3 · §5.1 #2-1 (A) — 원 둘레에 선 파일은 같은 화면의 원 둘레 파일끼리 견준다(종전 — 프로젝트 전체 위성의 범위).
    const radialFolders = withScreenFileRange(cv.radial);
    const satInfos = cv.satInfos;

    // §5.10 — 상주 버블(휴지통)은 폴더처럼 홈 주변을 공전(items)하되 물리 standalone.
    const foldersWithResident = [...radialFolders, ...residentBubbles];
    const allBubbles = [...agents, ...foldersWithResident];
    // §5.23 — 웹 버블은 이 원에 세우지 않는다(`radialItemsOf` — 원이 부풀어 함께 선 항목을 벽으로 민다).
    //   새 버블의 첫 자리는 이 원이 아니라 BubbleMap 이 주인 둘레 등장 영역에서 정한다(§5.1 #2-2 `spawnZoneSeating.ts`).
    const layout = radialLayout(agents, radialItemsOf(foldersWithResident), cx, cy, heat);

    // 선 끝점 반경 폴백은 위성이 된 파일도 찾을 수 있게 위성 사본까지 함께 본다. 묶음에 든 파일은 그 묶음으로 잰다.
    const radiusPool = cv.converted.size > 0 ? [...allBubbles, ...satInfos.map((s) => s.bubble)] : allBubbles;
    const endOf = (id: string): string => cv.converted.get(id) ?? cv.bundled.get(id) ?? id;
    const flowEdges = remapConverted(edges.map((e) => {
      const folder = radialFolders.find((f) => f.id === endOf(e.target))
        ?? radialFolders.find((f) => f.id === endOf(e.source));
      return buildFlowEdge({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        isActive: e.isActive,
        color: folder ? BUBBLE_COLORS[folder.bubbleType] : '#64748b',
        sourceRadius: findRadius(radiusPool, endOf(e.source), heat),
        targetRadius: findRadius(radiusPool, endOf(e.target), heat),
      });
    }), cv.converted, undefined, cv.bundled);

    const satFlowEdges = buildSatelliteEdges(satInfos);

    return {
      bubbles: appendSatelliteBubbles(allBubbles, satInfos),
      layout,
      flowEdges: [...flowEdges, ...satFlowEdges],
      satInfos,
    };
  }, [agents, folders, edges, satellites, satellitePositions, residentBubbles, heat, appHubs, rootLabel, openTurnOnly]);
}

// ─── §5.10 기억/휴지통 내부 뷰 데이터 Hook ───


interface UseInteriorLayoutProps {
  /** 내부 뷰 — 휴지통(버려진 에이전트 나열) · 묶음 안(§5.1 #2-1 (B) — 구성 파일만). */
  view: InteriorView | null;
  /** trash: 버려진(trashed) 커스텀 에이전트 버블. */
  trashedAgents: BubbleData[];
  /** bundle: 그 묶음의 구성 파일 노드(호출부가 `memberIds` 로 스토어에서 찾은 것 — 사라진 것은 빠져 있다). */
  bundleMembers?: BubbleData[];
}

/** §5.10 (J) 내부 뷰 — 휴지통(`← Back` + 버려진 에이전트 방사형)과 §5.1 #2-1 (B) 묶음 안. currentFolderId 계층과 독립인 interiorView 축. */
export function useInteriorLayout({ view, trashedAgents, bundleMembers = NO_BUBBLES }: UseInteriorLayoutProps): ViewData {
  const heat = useHeatScale();
  return useMemo(() => {
    if (!view) return EMPTY_VIEW_DATA;
    const cx = LAYOUT_CENTER_X;
    const cy = LAYOUT_CENTER_Y;

    const backBubble: BubbleData = {
      id: '__interior_back__',
      label: '← Back',
      bubbleType: 'back',
      path: '',
      status: 'idle',
      activity: 1,
    };

    // §5.1 #2-1 (B) — 묶음 안: 구성 파일만 선다. 지름은 구성끼리 견준 사용 횟수(`_usageRange`), 자리는 많이 쓴 것이 가운데인 무리.
    // 파일의 선·위성은 바깥 화면의 것이라 긋지 않는다.
    if (view.kind === 'bundle') {
      const members = withBundleUsageRange(bundleMembers);
      const navBubbles = [backBubble];
      const layout = packBundleInterior(members, backBubble, { x: cx, y: cy }, heat);
      return { bubbles: [...navBubbles, ...members], layout, flowEdges: [], satInfos: [] };
    }

    // 버려진 에이전트 버블 — ghost 톤은 BubbleNode 가 trashed 로 판단(여기선 원형 유지).
    const contentBubbles: BubbleData[] = trashedAgents.map((a) => ({ ...a, _interior: true } as BubbleData));

    const navBubbles = [backBubble];
    const allBubbles = [...navBubbles, ...contentBubbles];
    // 버려진 에이전트만 있는 뷰라 히트 대상이 없다 — 척도를 넘기지 않는다.
    const layout = radialLayout(navBubbles, contentBubbles, cx, cy, undefined, { offsetX: -300, offsetY: -150 });

    return {
      bubbles: allBubbles,
      layout,
      flowEdges: [],
      satInfos: [],
    };
  }, [view, trashedAgents, bundleMembers, heat]);
}

// ─── 폴더 내부 뷰 데이터 Hook ───

interface UseFolderLayoutProps {
  folderId: string;
  folderData?: BubbleData;
  agents: BubbleData[];
  children: BubbleData[];
  innerEdges: ActivityEdge[];
  /** worktree 드릴다운에서 agent→자식(파일/폴더) 엣지 렌더용 (메인 스코프 엣지).
   *  비-워크트리/미전달이면 무영향. */
  agentEdges?: ActivityEdge[];
  satellites: Record<string, BubbleData[]>;
  satellitePositions?: Record<string, { x: number; y: number }>;
  /** §5.1 #2-1 (B) — 폴더 위성 묶음의 구성을 지금 턴의 것만으로(캔버스만 — IDE 세션 지도는 턴 표시가 없다). */
  openTurnOnly?: boolean;
}

export function useFolderLayout({
  folderId,
  folderData,
  agents,
  children,
  innerEdges,
  agentEdges = [],
  satellites,
  satellitePositions,
  openTurnOnly = false,
}: UseFolderLayoutProps): ViewData {
  const heat = useHeatScale();
  return useMemo(() => {
    const cx = LAYOUT_CENTER_X;
    const cy = LAYOUT_CENTER_Y;

    const backBubble: BubbleData = {
      id: FOLDER_BACK_ID,
      label: '\u2190 Back',
      bubbleType: 'back',
      path: '',
      status: agents.some((a) => a.status === 'active') ? 'active' : 'idle',
      activity: 1,
    };

    const rootBubble: BubbleData = {
      id: FOLDER_HOME_ID,
      label: folderData?.label ?? '\u2302 Root',
      bubbleType: 'root',
      path: folderData?.path ?? '',
      status: 'idle',
      // §2.3 — `Root→` 는 내비게이션이라 폴더 활동량을 따르지 않고 `← Back` 과 같은 크기다(따르면 혼자 최대 지름까지 커진다).
      activity: backBubble.activity,
      childCount: folderData?.childCount,
    };

    const navBubbles = [backBubble, rootBubble];
    // worktree 버블 내부 드릴다운이면 해당 worktree 소속 에이전트도 함께 렌더
    const extraAgents = folderData?.bubbleType === 'worktree' ? agents : [];
    // 읽던 폴더는 dismiss/auto-idle 뒤에만 사라지게 좁힌다 — active/completed 이거나 워크트리에 에이전트가 없으면(단순 탐색) children 을 다 보인다.
    // idle(서버가 agent↔폴더 엣지 제거) 뒤 엣지가 끊긴 폴더만 숨긴다. preserve-pin/ghost 는 보존.
    const isWorktreeDrill = extraAgents.length > 0;
    const anyLiveAgent = extraAgents.some((a) => a.status === 'active' || a.status === 'completed');
    const visibleChildren = (() => {
      if (!isWorktreeDrill || anyLiveAgent) return children;
      const agentIdSet = new Set(extraAgents.map((a) => a.id));
      const connected = new Set<string>();
      for (const e of agentEdges) {
        if (agentIdSet.has(e.source)) connected.add(e.target);
        if (agentIdSet.has(e.target)) connected.add(e.source);
      }
      return children.filter((c) =>
        (c.bubbleType !== 'internal_folder' && c.bubbleType !== 'external_folder')
        || c.pinned || c.preservePinned || c.status === 'disappearing'
        || connected.has(c.id));
    })();
    // §5.1 #2-1 (B) — 작업물 별자리. 이 화면의 파일(직속 파일 + 하위 폴더의 파일 위성)로 판정하고, 위성이 된 직속 파일은
    //   원 둘레에서 빠진다. 앱 노드는 메인에만 그려지므로 여기서는 파일 중심만 본다.
    const folderItems = visibleChildren.filter(
      (i) => i.bubbleType === 'internal_folder' || i.bubbleType === 'external_folder',
    );
    const rawSatInfos = collectSatellites(folderItems, satellites, heat, satellitePositions);
    const cv = applyConstellations({
      radial: visibleChildren,
      satInfos: rawSatInfos,
      appHubs: NO_APP_HUBS,
      heat,
      platform: clientPathPlatform(),
      satellitePositions,
      openTurnOnly,
    });
    // §2.3 · §5.1 #2-1 (A) — 직속 파일은 이 폴더 화면의 직속 파일끼리 견준다(종전 — 프로젝트 전체 위성의 범위).
    const radialChildren = withScreenFileRange(cv.radial);
    const satInfos = cv.satInfos;

    const allBubbles = [...navBubbles, ...radialChildren, ...extraAgents];
    const layout = radialLayout(navBubbles, [...radialChildren, ...extraAgents], cx, cy, heat, { offsetX: -300, offsetY: -150 });

    // 폴더 → 직속 파일 선은 그 파일이 위성이 되면 버리고, 묶음에 든 파일의 선은 묶음으로 옮긴다(같은 끝점은 하나로).
    const endOf = (id: string): string => (id === folderId ? backBubble.id : cv.bundled.get(id) ?? id);
    const flowEdges = remapConverted(innerEdges.map((e) => {
      const child = visibleChildren.find((i) => i.id === e.source) ?? visibleChildren.find((i) => i.id === e.target);
      return buildFlowEdge({
        id: e.id,
        source: e.source === folderId ? backBubble.id : e.source,
        target: e.target === folderId ? backBubble.id : e.target,
        label: e.label,
        isActive: e.isActive,
        color: child ? BUBBLE_COLORS[child.bubbleType] : '#64748b',
        sourceRadius: findRadius(allBubbles, endOf(e.source), heat),
        targetRadius: findRadius(allBubbles, endOf(e.target), heat),
      });
    }), cv.converted, backBubble.id, cv.bundled);

    // worktree 드릴다운: agent→자식 엣지도 그린다(innerEdges 만이면 옮긴 에이전트의 read/edit 엣지가 빠진다). 양 끝이 지금 그리는 버블에 있는 agentEdges 만, 중복 id 제외.
    const innerEdgeIds = new Set(flowEdges.map((fe) => fe.id));
    // 위성이 된 직속 파일은 원래 id 로 들어온다 — 그 id 도 이 화면에 있는 것으로 치고, 선은 새 노드로 옮겨 단다.
    const bubbleIds = new Set([...allBubbles.map((b) => b.id), ...cv.converted.keys(), ...cv.bundled.keys()]);
    const agentFlowEdges = remapConverted((extraAgents.length > 0 ? agentEdges : [])
      .filter((e) => !innerEdgeIds.has(e.id) && bubbleIds.has(e.source) && bubbleIds.has(e.target))
      .map((e) => buildFlowEdge({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        isActive: e.isActive,
        color: '#64748b',
        sourceRadius: findRadius(allBubbles, cv.bundled.get(e.source) ?? e.source, heat),
        targetRadius: findRadius(allBubbles, cv.bundled.get(e.target) ?? e.target, heat),
      })), cv.converted, undefined, cv.bundled);

    const satFlowEdges = buildSatelliteEdges(satInfos);

    return {
      bubbles: appendSatelliteBubbles(allBubbles, satInfos),
      layout,
      flowEdges: [...flowEdges, ...agentFlowEdges, ...satFlowEdges],
      satInfos,
    };
  }, [folderId, folderData, agents, children, innerEdges, agentEdges, satellites, satellitePositions, heat, openTurnOnly]);
}

// ─── 파이프라인 내부 뷰 데이터 Hook ───

interface UsePipelineLayoutProps {
  parentId: string;
  parentData?: BubbleData;
  pipelineChildren: BubbleData[];
}

/**
 * 파이프라인 내부 뷰 레이아웃 — Parents 버블 + 4개 자식 에이전트를 방사형으로 배치.
 */
export function usePipelineLayout({
  parentId,
  parentData,
  pipelineChildren,
}: UsePipelineLayoutProps): ViewData {
  return useMemo(() => {
    const cx = LAYOUT_CENTER_X;
    const cy = LAYOUT_CENTER_Y;

    // Parents 버블 (상위 복귀 + 부모 정보 표시)
    const parentsBubble: BubbleData = {
      id: PIPELINE_PARENT_BUBBLE_ID,
      label: parentData?.label ?? 'Parents',
      bubbleType: 'pipeline',
      path: parentData?.path ?? '',
      status: pipelineChildren.some((c) => c.status === 'active') ? 'active' : 'idle',
      activity: parentData?.activity ?? 0,
      pipelineType: parentData?.pipelineType,
    };

    const navBubbles = [parentsBubble];
    const allBubbles = [...navBubbles, ...pipelineChildren];
    // 파이프라인 에이전트만 있는 뷰라 히트 대상이 없다.
    const layout = radialLayout(navBubbles, pipelineChildren, cx, cy, undefined, { offsetX: -200, offsetY: -100 });

    return {
      bubbles: allBubbles,
      layout,
      flowEdges: [],
      satInfos: [],
    };
  }, [parentId, parentData, pipelineChildren]);
}
