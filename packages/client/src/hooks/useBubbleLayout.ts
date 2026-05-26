import { useMemo } from 'react';
import type { BubbleData, ActivityEdge, PipelineState } from '@vibisual/shared';
import { BUBBLE_COLORS, LAYOUT_CENTER_X, LAYOUT_CENTER_Y, PIPELINE_PARENT_BUBBLE_ID } from '@vibisual/shared';
import { collectSatellites } from '../utils/satellite.js';
import {
  radialLayout,
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
}: UseBubbleLayoutProps): ViewData {
  return useMemo(() => {
    if (agents.length === 0 && folders.length === 0) return EMPTY_VIEW_DATA;

    const cx = LAYOUT_CENTER_X;
    const cy = LAYOUT_CENTER_Y;
    const allBubbles = [...agents, ...folders];
    const layout = radialLayout(agents, folders, cx, cy);

    const flowEdges = edges.map((e) => {
      const folder = folders.find((f) => f.id === e.target)
        ?? folders.find((f) => f.id === e.source);
      return buildFlowEdge({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        isActive: e.isActive,
        color: folder ? BUBBLE_COLORS[folder.bubbleType] : '#64748b',
        sourceRadius: findRadius(allBubbles, e.source),
        targetRadius: findRadius(allBubbles, e.target),
      });
    });

    const satInfos = collectSatellites([...agents, ...folders], satellites, satellitePositions);
    const satFlowEdges = buildSatelliteEdges(satInfos);

    return {
      bubbles: appendSatelliteBubbles(allBubbles, satInfos),
      layout,
      flowEdges: [...flowEdges, ...satFlowEdges],
      satInfos,
    };
  }, [agents, folders, edges, satellites, satellitePositions]);
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
    const allBubbles = [...navBubbles, ...visibleChildren, ...extraAgents];
    const layout = radialLayout(navBubbles, [...visibleChildren, ...extraAgents], cx, cy, { offsetX: -300, offsetY: -150 });

    const flowEdges = innerEdges.map((e) => {
      const child = visibleChildren.find((i) => i.id === e.source) ?? visibleChildren.find((i) => i.id === e.target);
      return buildFlowEdge({
        id: e.id,
        source: e.source === folderId ? backBubble.id : e.source,
        target: e.target === folderId ? backBubble.id : e.target,
        label: e.label,
        isActive: e.isActive,
        color: child ? BUBBLE_COLORS[child.bubbleType] : '#64748b',
        sourceRadius: findRadius(allBubbles, e.source === folderId ? backBubble.id : e.source),
        targetRadius: findRadius(allBubbles, e.target === folderId ? backBubble.id : e.target),
      });
    });

    // worktree 드릴다운: agent→자식(파일/폴더) 엣지도 렌더 — 메인 레이어와 동일하게.
    // useFolderLayout 은 기본적으로 innerEdges(자식↔자식)만 그리므로, 워크트리로 이주한
    // 에이전트의 read/edit 엣지가 여기서 누락됐다. 양 끝점이 모두 현재 렌더 버블
    // (extraAgents/children/nav)에 있는 agentEdges 만 추려 추가(중복 id 는 제외).
    const innerEdgeIds = new Set(flowEdges.map((fe) => fe.id));
    const bubbleIds = new Set(allBubbles.map((b) => b.id));
    const agentFlowEdges = (extraAgents.length > 0 ? agentEdges : [])
      .filter((e) => !innerEdgeIds.has(e.id) && bubbleIds.has(e.source) && bubbleIds.has(e.target))
      .map((e) => buildFlowEdge({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        isActive: e.isActive,
        color: '#64748b',
        sourceRadius: findRadius(allBubbles, e.source),
        targetRadius: findRadius(allBubbles, e.target),
      }));

    const folderItems = visibleChildren.filter(
      (i) => i.bubbleType === 'internal_folder' || i.bubbleType === 'external_folder',
    );
    const satInfos = collectSatellites(folderItems, satellites, satellitePositions);
    const satFlowEdges = buildSatelliteEdges(satInfos);

    return {
      bubbles: appendSatelliteBubbles(allBubbles, satInfos),
      layout,
      flowEdges: [...flowEdges, ...agentFlowEdges, ...satFlowEdges],
      satInfos,
    };
  }, [folderId, folderData, agents, children, innerEdges, agentEdges, satellites, satellitePositions]);
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
    const layout = radialLayout(navBubbles, pipelineChildren, cx, cy, { offsetX: -200, offsetY: -100 });

    return {
      bubbles: allBubbles,
      layout,
      flowEdges: [],
      satInfos: [],
    };
  }, [parentId, parentData, pipelineChildren]);
}
