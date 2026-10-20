import { useMemo } from 'react';
import type { Edge } from '@xyflow/react';
import type { BubbleData, ActivityEdge, PipelineState } from '@vibisual/shared';
import { BUBBLE_COLORS, LAYOUT_CENTER_X, LAYOUT_CENTER_Y, PIPELINE_PARENT_BUBBLE_ID } from '@vibisual/shared';
import { collectSatellites } from '../utils/satellite.js';
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
}

const NO_APP_HUBS: readonly ConstellationAppHubView[] = [];

/**
 * §5.1 #2-1 (B) — 위성이 된 직속 파일로 들어오던 선을 새 노드로 옮겨 단다. `dropWith` 가 주어지면 그 노드와 위성이 된
 * 파일 사이의 선은 버린다(폴더 → 직속 파일 선 — 그 관계는 이제 중심 → 위성 선이 말한다).
 */
function remapConverted(edges: Edge[], converted: ReadonlyMap<string, string>, dropWith?: string): Edge[] {
  if (converted.size === 0) return edges;
  const out: Edge[] = [];
  for (const e of edges) {
    const source = converted.get(e.source);
    const target = converted.get(e.target);
    if (source === undefined && target === undefined) {
      out.push(e);
      continue;
    }
    if (dropWith !== undefined && (e.source === dropWith || e.target === dropWith)) continue;
    out.push({ ...e, source: source ?? e.source, target: target ?? e.target });
  }
  return out;
}

/**
 * 메인 뷰 레이아웃 계산 -- agents + folders + edges + satellites로부터
 * React Flow용 노드/엣지/레이아웃을 생성한다.
 *
 * BubbleMap에서 사용.
 */
export function useBubbleLayout({
  agents,
  folders,
  edges,
  satellites,
  satellitePositions,
  residentBubbles = [],
  appHubs = NO_APP_HUBS,
}: UseBubbleLayoutProps): ViewData {
  // §5.24 — 히트맵이 켜져 있으면 배치도 렌더와 **같은 자**를 써야 한다(안 그러면 화살표가 빗나간다).
  const heat = useHeatScale();
  return useMemo(() => {
    if (agents.length === 0 && folders.length === 0 && residentBubbles.length === 0) return EMPTY_VIEW_DATA;

    const cx = LAYOUT_CENTER_X;
    const cy = LAYOUT_CENTER_Y;

    // §5.1 #2-1 (B) — 작업물 별자리. 판정은 이 화면의 파일(최상위 파일 + 폴더·에이전트의 파일 위성)로 하고,
    //   위성이 된 최상위 파일은 원 둘레에서 빠진다 — 그래서 원 배치(`radialLayout`)는 그 **뒤의** 목록으로 짓는다.
    const rawSatInfos = collectSatellites([...agents, ...folders], satellites, heat, satellitePositions);
    const cv = applyConstellations({
      radial: folders,
      satInfos: rawSatInfos,
      appHubs,
      heat,
      platform: clientPathPlatform(),
      satellitePositions,
    });
    const radialFolders = cv.radial;
    const satInfos = cv.satInfos;

    // §5.10 — 상주 버블(휴지통)은 폴더처럼 홈 주변을 공전(items)하되 물리 standalone.
    const foldersWithResident = [...radialFolders, ...residentBubbles];
    const allBubbles = [...agents, ...foldersWithResident];
    // §5.23 웹 궤도 — 웹 버블은 이 원에 세우지 않는다(`radialItemsOf`). 첫 자리는 BubbleMap 이
    //   읽은 에이전트 둘레 궤도에서 정한다(`webOrbitSeating.ts`).
    const layout = radialLayout(agents, radialItemsOf(foldersWithResident), cx, cy, heat);

    // 선 끝점 반경 폴백은 위성이 된 파일도 찾을 수 있게 위성 사본까지 함께 본다.
    const radiusPool = cv.converted.size > 0 ? [...allBubbles, ...satInfos.map((s) => s.bubble)] : allBubbles;
    const flowEdges = remapConverted(edges.map((e) => {
      const folder = radialFolders.find((f) => f.id === e.target)
        ?? radialFolders.find((f) => f.id === e.source);
      return buildFlowEdge({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        isActive: e.isActive,
        color: folder ? BUBBLE_COLORS[folder.bubbleType] : '#64748b',
        sourceRadius: findRadius(radiusPool, cv.converted.get(e.source) ?? e.source, heat),
        targetRadius: findRadius(radiusPool, cv.converted.get(e.target) ?? e.target, heat),
      });
    }), cv.converted);

    const satFlowEdges = buildSatelliteEdges(satInfos);

    return {
      bubbles: appendSatelliteBubbles(allBubbles, satInfos),
      layout,
      flowEdges: [...flowEdges, ...satFlowEdges],
      satInfos,
    };
  }, [agents, folders, edges, satellites, satellitePositions, residentBubbles, heat, appHubs]);
}

// ─── §5.10 기억/휴지통 내부 뷰 데이터 Hook ───


interface UseInteriorLayoutProps {
  /** 내부 뷰 종류 — 지금은 trash(버려진 에이전트 나열) 하나뿐이다. */
  view: { kind: 'trash' } | null;
  /** trash: 버려진(trashed) 커스텀 에이전트 버블. */
  trashedAgents: BubbleData[];
}

/**
 * §5.10 (J) 휴지통 내부 뷰 — `← Back` 노드 + 버려진 에이전트 버블을 방사형 배치.
 * currentFolderId 계층과 독립(interiorView 축). §5.10 로 기억 축이 폐기된 뒤
 * 이 축에 남은 값은 휴지통 하나뿐이다.
 */
export function useInteriorLayout({ view, trashedAgents }: UseInteriorLayoutProps): ViewData {
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
  }, [view, trashedAgents]);
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
}

/**
 * 폴더 내부 뷰 레이아웃 계산 -- backBubble + 자식 노드 + 내부 엣지로부터
 * React Flow용 노드/엣지/레이아웃을 생성한다.
 */
export function useFolderLayout({
  folderId,
  folderData,
  agents,
  children,
  innerEdges,
  agentEdges = [],
  satellites,
  satellitePositions,
}: UseFolderLayoutProps): ViewData {
  const heat = useHeatScale();
  return useMemo(() => {
    const cx = LAYOUT_CENTER_X;
    const cy = LAYOUT_CENTER_Y;

    const backBubble: BubbleData = {
      id: '__root_back__',
      label: '\u2190 Back',
      bubbleType: 'back',
      path: '',
      status: agents.some((a) => a.status === 'active') ? 'active' : 'idle',
      activity: 1,
    };

    const rootBubble: BubbleData = {
      id: '__root_home__',
      label: folderData?.label ?? '\u2302 Root',
      bubbleType: 'root',
      path: folderData?.path ?? '',
      status: 'idle',
      activity: folderData?.activity ?? 0,
      childCount: folderData?.childCount,
    };

    const navBubbles = [backBubble, rootBubble];
    // worktree 버블 내부 드릴다운이면 해당 worktree 소속 에이전트도 함께 렌더
    const extraAgents = folderData?.bubbleType === 'worktree' ? agents : [];
    // dismiss(완료 확인)/auto-idle 후에만 읽던 폴더가 사라지도록 좁힌다.
    // 에이전트가 active/completed(작업중·결과대기) 이거나 워크트리에 에이전트가
    // 없으면(단순 탐색) children 을 그대로 다 보여줘 워크트리 탐색을 막지 않는다.
    // 에이전트가 idle 로 내려간(= 사용자 dismiss 또는 5분 auto-idle → 서버가
    // agent↔폴더 엣지 제거) 경우에만 엣지 끊긴 폴더를 숨긴다. preserve-pin/ghost 보존.
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
    });
    const radialChildren = cv.radial;
    const satInfos = cv.satInfos;

    const allBubbles = [...navBubbles, ...radialChildren, ...extraAgents];
    const layout = radialLayout(navBubbles, [...radialChildren, ...extraAgents], cx, cy, heat, { offsetX: -300, offsetY: -150 });

    // 폴더 → 직속 파일 선은 그 파일이 위성이 되면 버린다(그 관계는 중심 → 위성 선이 말한다).
    const flowEdges = remapConverted(innerEdges.map((e) => {
      const child = visibleChildren.find((i) => i.id === e.source) ?? visibleChildren.find((i) => i.id === e.target);
      return buildFlowEdge({
        id: e.id,
        source: e.source === folderId ? backBubble.id : e.source,
        target: e.target === folderId ? backBubble.id : e.target,
        label: e.label,
        isActive: e.isActive,
        color: child ? BUBBLE_COLORS[child.bubbleType] : '#64748b',
        sourceRadius: findRadius(allBubbles, e.source === folderId ? backBubble.id : e.source, heat),
        targetRadius: findRadius(allBubbles, e.target === folderId ? backBubble.id : e.target, heat),
      });
    }), cv.converted, backBubble.id);

    // worktree 드릴다운: agent→자식(파일/폴더) 엣지도 렌더 — 메인 레이어와 동일하게.
    // useFolderLayout 은 기본적으로 innerEdges(자식↔자식)만 그리므로, 워크트리로 이주한
    // 에이전트의 read/edit 엣지가 여기서 누락됐다. 양 끝점이 모두 현재 렌더 버블
    // (extraAgents/children/nav)에 있는 agentEdges 만 추려 추가(중복 id 는 제외).
    const innerEdgeIds = new Set(flowEdges.map((fe) => fe.id));
    // 위성이 된 직속 파일은 원래 id 로 들어온다 — 그 id 도 이 화면에 있는 것으로 치고, 선은 새 노드로 옮겨 단다.
    const bubbleIds = new Set([...allBubbles.map((b) => b.id), ...cv.converted.keys()]);
    const agentFlowEdges = remapConverted((extraAgents.length > 0 ? agentEdges : [])
      .filter((e) => !innerEdgeIds.has(e.id) && bubbleIds.has(e.source) && bubbleIds.has(e.target))
      .map((e) => buildFlowEdge({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        isActive: e.isActive,
        color: '#64748b',
        sourceRadius: findRadius(allBubbles, e.source, heat),
        targetRadius: findRadius(allBubbles, e.target, heat),
      })), cv.converted);

    const satFlowEdges = buildSatelliteEdges(satInfos);

    return {
      bubbles: appendSatelliteBubbles(allBubbles, satInfos),
      layout,
      flowEdges: [...flowEdges, ...agentFlowEdges, ...satFlowEdges],
      satInfos,
    };
  }, [folderId, folderData, agents, children, innerEdges, agentEdges, satellites, satellitePositions, heat]);
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
