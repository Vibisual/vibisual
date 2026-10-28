import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
  type XYPosition,
} from '@xyflow/react';
import {
  EDGE_STYLE,
  LAYOUT_BOUNDS_DEFAULT,
  LAYOUT_CENTER_X,
  LAYOUT_CENTER_Y,
  WEB_PAGE_TAB_PREFIX,
  pathKey,
  webNodeKey,
  type ActivityEdge,
  type BubbleData,
  type HeatScale,
  type PlatformName,
  type QueuedCommand,
  type SubAgentStreamEvent,
} from '@vibisual/shared';
import { useGraphStore, type InteriorView } from '../../stores/graphStore.js';
import { clientPathPlatform } from '../../utils/platform.js';
import { formatSince } from '../../formatSince.js';
import { shallowEqualData, toFlowNodes, type ViewData } from '../../utils/flowBuilder.js';
import { placeSatellitePositions } from '../../utils/satellite.js';
import { bundleInfoOf, bundleInteriorIds, bundleInteriorMembers } from '../../utils/constellationView.js';
import { useBubbleLayout, useFolderLayout, useInteriorLayout } from '../../hooks/useBubbleLayout.js';
import { useHeatScale } from '../../hooks/useHeatScale.js';
import { useMeasuredFlowNodes } from '../../hooks/useMeasuredFlowNodes.js';
import { CanvasBubbleNode } from '../BubbleMap/AgentCardNode.js';
import { CurvedEdge } from '../BubbleMap/CurvedEdge.js';
import { EdgeMask } from '../BubbleMap/EdgeMask.js';
import { CanvasZoomControls } from '../BubbleMap/canvasControlKit.js';
import { BreadcrumbTrail, type BreadcrumbCrumb } from '../BubbleMap/CanvasBreadcrumb.js';
import { BUBBLE_HOST_RING, BubbleHostContext, type BubbleHost } from '../BubbleMap/bubbleHost.js';
import { FOREIGN_FLOW_ATTR } from '../BubbleMap/canvasSurface.js';
import { openFileBubble } from '../BubbleMap/fileBubbleOpen.js';
import { openWebAddress } from '../BubbleMap/openDomainBubble.js';
import { buildSpawnField, isSpawnZoneSeated, seatSpawnZoneBubbles } from '../BubbleMap/spawnZoneSeating.js';
import { editorFileFromAbsPath } from './editorModel.js';
import { useIDEPaneActions } from './idePane.js';
import { useIDEProjectRoot } from './useIDEProjectRoot.js';
import { requestOlderStreamHistory } from './streamHistory.js';
import { buildSessionBubbles, type SessionBubbleStream, type SessionTouch } from './sessionBubbles.js';
import {
  SESSION_CENTER_NODE_ID,
  buildSessionCanvasGraph,
  folderCrumbLabel,
  sessionCanvasEntryOf,
  type SessionCanvasEntry,
  type SessionCanvasGraph,
} from './sessionCanvasGraph.js';

/**
 * §5.5 #17-50 [버블] — 이 세션만의 버블 지도. **버블은 캔버스 부품 그대로다** — 지도 전용 원·선·배치를 만들지 마라. 재료는 `sessionBubbles.ts`·`sessionCanvasGraph.ts`.
 * 캔버스와 다른 셋: 손짓은 `BubbleHostContext` 로 · 판 뿌리 `FOREIGN_FLOW_ATTR`(캔버스가 이 판의 우클릭·길게 누르기를 제 것으로 읽지 않게) · 물리 없이 위성은 부모와 같은 변위로 따라온다. 새 버블이 와도 선 자리는 안 옮긴다.
 */

/** IDE 본문의 글자 배율 손짓(Ctrl+휠·두 손가락)이 지도 위에서는 물러나도록 붙이는 표식. */
export const SESSION_BUBBLES_ATTR = 'data-session-bubbles';

/** 이 이벤트가 지도 안에서 시작됐나 — IDE 본문의 capture 리스너가 지도 위 손짓을 가로채지 않게 묻는다. */
export function isInsideSessionBubbles(target: EventTarget | null): boolean {
  const el = target as { closest?: (s: string) => unknown } | null;
  return !!el && typeof el.closest === 'function' && !!el.closest(`[${SESSION_BUBBLES_ATTR}]`);
}

// ─── 캔버스와 같은 부품 · 같은 값 ─────────────────────────────────────────────

const nodeTypes: NodeTypes = { bubble: CanvasBubbleNode };
const edgeTypes: EdgeTypes = { curved: CurvedEdge };
/** 캔버스(`BubbleMap`)의 선 기본값과 같다. */
const DEFAULT_EDGE_OPTIONS = {
  style: { stroke: EDGE_STYLE.inactiveColor, strokeWidth: EDGE_STYLE.inactiveWidth },
  type: 'curved',
  focusable: false,
  interactionWidth: 0,
} as const;
const PRO_OPTIONS = { hideAttribution: true } as const;
/** 화면 맞추기 — 처음 열 때 · 들어가고 나올 때 · 손대지 않은 동안 버블이 늘 때. */
const FIT_OPTIONS = { padding: 0.2, maxZoom: 1.2, duration: 250 } as const;
const MAP_MIN_ZOOM = 0.1;
const MAP_MAX_ZOOM = 2;
/** 등장 영역의 상자 — 캔버스의 기본 배치 상자와 같은 크기(지도에는 상자를 고치는 손잡이가 없다). */
const SPAWN_BOUNDS = { cx: LAYOUT_CENTER_X, cy: LAYOUT_CENTER_Y, hw: LAYOUT_BOUNDS_DEFAULT.hw, hh: LAYOUT_BOUNDS_DEFAULT.hh };
const SPAWN_FALLBACK = { x: LAYOUT_CENTER_X, y: LAYOUT_CENTER_Y };

const NO_BUBBLES: BubbleData[] = [];
const NO_ACTIVITY_EDGES: ActivityEdge[] = [];
const NO_NODES: Node[] = [];
const NO_POSITIONS: ReadonlyMap<string, XYPosition> = new Map();
/** 손으로 옮긴 자리 — 화면(자리) 키 → 버블 데이터 id → 좌표. */
type MovedSeats = ReadonlyMap<string, ReadonlyMap<string, XYPosition>>;
const NO_MOVED: MovedSeats = new Map();
/** 캔버스(`BubbleMap`)와 같은 끌기 문턱(px) — 더블클릭·누름이 끌기로 먹히지 않게. */
const NODE_DRAG_THRESHOLD = 5;
/** 한 화면에서 앉힌 자리와 그 노드 — 화면을 오가도 다시 앉히지 않게 화면마다 들고 있다. */
type PlacedScope = { positions: ReadonlyMap<string, XYPosition>; nodes: ReadonlyMap<string, Node> };
/** 끄는 중인 버블과 함께 갈 위성의 시작 좌표(데이터 id 기준). */
type DragStart = { nodeId: string; start: ReadonlyMap<string, XYPosition> };

/** 「복사됨」 표시가 머무는 시간(ms). */
const COPIED_MS = 1400;

// ─── 화면 자리 ──────────────────────────────────────────────────────────────

type BundleView = Extract<InteriorView, { kind: 'bundle' }>;
/** 폴더 계층의 자리 — 세션 지도(맨 위) 또는 들어간 폴더. */
type PlaceScope = { readonly kind: 'main' } | { readonly kind: 'folder'; readonly id: string };
/** 지금 보는 화면 — 묶음 안은 들어온 자리로 돌아간다(캔버스 묶음 안과 같다). */
type Scope = PlaceScope | { readonly kind: 'bundle'; readonly view: BundleView; readonly from: PlaceScope };

const MAIN_SCOPE: PlaceScope = { kind: 'main' };

function scopeKeyOf(scope: Scope): string {
  if (scope.kind === 'main') return 'main';
  if (scope.kind === 'folder') return `folder:${scope.id}`;
  return `bundle:${scope.view.bundleId}`;
}

/**
 * 첫 자리 — 캔버스 동기화(`BubbleMap` 5~7단)와 **같은 순서**다: 이미 선 자리 → 방사형(에이전트·내비게이션, 그리고 내부 뷰는
 * 전부) → 주인 둘레 등장 영역 → 위성. 이미 선 버블은 하나도 옮기지 않는다(§5.1 #2-2 (H)).
 */
function seatView(
  viewData: ViewData,
  prev: ReadonlyMap<string, XYPosition>,
  heat: HeatScale | undefined,
  interior: boolean,
): Map<string, XYPosition> {
  const ids = new Set(viewData.bubbles.map((b) => b.id));
  const positions = new Map<string, XYPosition>();
  for (const [id, p] of prev) if (ids.has(id)) positions.set(id, p);

  const pending: BubbleData[] = [];
  for (const b of viewData.bubbles) {
    if (b.id.startsWith('sat-') || positions.has(b.id)) continue;
    // §5.10 — 내부 뷰(묶음 안)는 임시 나열 화면이라 늘 방사형이다(캔버스와 같다).
    if (!interior && isSpawnZoneSeated(b)) { pending.push(b); continue; }
    const pos = viewData.layout.get(b.id);
    if (pos) positions.set(b.id, pos);
  }

  const needsSatelliteSeat = viewData.satInfos.some((s) => !positions.has(s.bubble.id));
  if (pending.length === 0 && !needsSatelliteSeat) return positions;
  const field = buildSpawnField({
    bubbles: viewData.bubbles,
    nodes: NO_NODES,
    positions,
    panels: [],
    heat,
    fileSizeRange: undefined,
    bounds: SPAWN_BOUNDS,
    cardForm: false,
  });
  if (pending.length > 0) {
    const seats = seatSpawnZoneBubbles({
      pending,
      field,
      bubbles: viewData.bubbles,
      edges: viewData.flowEdges,
      heat,
      fallbackCenter: SPAWN_FALLBACK,
    });
    for (const [id, pos] of seats) positions.set(id, pos);
  }
  placeSatellitePositions(viewData.satInfos, positions, undefined, field);
  return positions;
}

/** React Flow 노드·선(캔버스와 같은 `toFlowNodes`). 가운데 에이전트만 노드 id 를 갈라 둔다 — 캔버스의 Shift 묶음·연결 끌기가 제 노드로 읽지 않게. 내용이 같으면 지난 객체를 그대로 쓴다(`shallowEqualData` 규율). */
function toSessionFlow(
  viewData: ViewData,
  positions: Map<string, XYPosition>,
  agentId: string,
  prev: ReadonlyMap<string, Node> | undefined,
): { nodes: Node[]; edges: Edge[] } {
  const rename = (id: string): string => (id === agentId ? SESSION_CENTER_NODE_ID : id);
  const nodes = toFlowNodes(viewData.bubbles, positions, viewData.layout).map((n): Node => {
    const id = rename(n.id);
    const old = prev?.get(id);
    const data = old && shallowEqualData(old.data, n.data) ? old.data : n.data;
    if (old && old.data === data && old.position.x === n.position.x && old.position.y === n.position.y) return old;
    return { ...n, id, data };
  });
  const edges = viewData.flowEdges.map((e) => (
    e.source === agentId || e.target === agentId ? { ...e, source: rename(e.source), target: rename(e.target) } : e
  ));
  return { nodes, edges };
}

// ─── 캔버스에 떠 있는 같은 파일의 크기 ───────────────────────────────────────

type FileStat = { fileSize?: number; fileMtime?: number };
const statsIndexCache = new WeakMap<object, Map<string, FileStat>>();

/** 캔버스 노드 표 → 파일 경로 키 → 크기·수정 시각. 같은 표면 한 번만 짓는다(스냅샷이 표를 갈 때만 다시). */
function canvasFileStatsIndex(nodeMap: Record<string, BubbleData>, platform: PlatformName): Map<string, FileStat> {
  const hit = statsIndexCache.get(nodeMap);
  if (hit) return hit;
  const index = new Map<string, FileStat>();
  for (const n of Object.values(nodeMap)) {
    if (n.bubbleType !== 'file' || !n.absolutePath) continue;
    if (n.fileSize === undefined && n.fileMtime === undefined) continue;
    index.set(pathKey(n.absolutePath, platform), {
      ...(n.fileSize !== undefined ? { fileSize: n.fileSize } : {}),
      ...(n.fileMtime !== undefined ? { fileMtime: n.fileMtime } : {}),
    });
  }
  statsIndexCache.set(nodeMap, index);
  return index;
}

/** 이 세션 파일들의 캔버스 크기 지문 — 문자열이라 구독해도 값이 같으면 다시 그리지 않는다(새 배열을 구독하지 않는다). */
function fileStatsSignature(nodeMap: Record<string, BubbleData>, keys: readonly string[], platform: PlatformName): string {
  if (keys.length === 0) return '';
  const index = canvasFileStatsIndex(nodeMap, platform);
  let sig = '';
  for (const k of keys) {
    const st = index.get(k);
    sig += st ? `${st.fileSize ?? ''}/${st.fileMtime ?? ''}|` : '-|';
  }
  return sig;
}

// ─── 화면 ──────────────────────────────────────────────────────────────────

export interface SessionBubbleViewProps {
  agentId: string;
  /** 칸의 세션 — 메인 탭이면 null(그 탭이 그리는 세션 전부). */
  sessionId: string | null;
  /** 이 칸의 재료 — 세션마다 스트림 + 명령. */
  streams: readonly SessionBubbleStream[];
  /** 앞선 기록을 더 받을 수 있는 세션들(처음까지 실리지 않은 것). 비면 [앞선 기록 더 불러오기]가 서지 않는다. */
  olderSessionIds: readonly string[];
  /** 이 칸의 이름(세션 탭 이름 · 메인 탭이면 에이전트 이름) — 경로 표시의 맨 앞 · 가운데 정보 칸의 머리. */
  title: string;
  /** 이 칸이 지금 도는가 — 상태바와 같은 판정(`useSessionRunning`). */
  running: boolean;
  /** 답을 기다리는 질문 수(§5.3 #12-2) — 대화 칸 안에만 서므로 지도 위에 알린다. */
  pendingAsks: number;
  /** 대화로 돌아가 그 턴의 프롬프트로 간다(`null` = 대화 맨 아래로). */
  onReturnToStream: (turnId: string | null) => void;
  /** 가운데 에이전트(자기 자신) 더블클릭 — 보기 묶음의 [표준]으로 대화로 돌아간다. */
  onShowStandard: () => void;
}

export const SessionBubbleView = memo(function SessionBubbleView({
  agentId, sessionId, streams, olderSessionIds, title, running, pendingAsks, onReturnToStream, onShowStandard,
}: SessionBubbleViewProps): React.JSX.Element {
  const { t } = useTranslation();
  const rootPath = useIDEProjectRoot();
  const { openEditorFile } = useIDEPaneActions();
  const platform = clientPathPlatform();
  const heat = useHeatScale();

  // ─── 재료 → 캔버스 모양 ───
  const model = useMemo(
    () => buildSessionBubbles({ streams, rootPath, platform }),
    [streams, rootPath, platform],
  );
  const agent = useGraphStore((s) => s.nodeMap[agentId] ?? null);
  // 같은 파일이 캔버스에 떠 있으면 그 크기·수정 시각을 빌린다 — 지문(문자열)만 구독해 그 값이 바뀔 때만 다시 짓는다.
  const fileKeys = useMemo(() => model.folders.flatMap((f) => f.files.map((x) => x.key)), [model]);
  const fileStatsSig = useGraphStore((s) => fileStatsSignature(s.nodeMap, fileKeys, platform));
  const fileStats = useMemo(() => {
    if (fileStatsSig === '') return undefined;
    const index = canvasFileStatsIndex(useGraphStore.getState().nodeMap, platform);
    return (absPath: string): FileStat | undefined => index.get(pathKey(absPath, platform));
  }, [fileStatsSig, platform]);
  const webSearchLabel = t('providers.webSearch');
  const graph = useMemo(() => buildSessionCanvasGraph({
    model, rootPath, platform, running, agentId, agent, webSearchLabel, fileStats,
  }), [model, rootPath, platform, running, agentId, agent, webSearchLabel, fileStats]);

  // ─── 지금 보는 화면 ───
  const [scope, setScope] = useState<Scope>(MAIN_SCOPE);
  const [ringId, setRingId] = useState<string | null>(null);
  const [infoId, setInfoId] = useState<string | null>(null);
  const resetSelection = useCallback(() => { setRingId(null); setInfoId(null); }, []);
  const goTo = useCallback((next: Scope) => { setScope(next); resetSelection(); }, [resetSelection]);
  // 칸의 세션이 바뀌면 처음부터(다른 세션의 폴더 안에 서 있지 않게).
  useEffect(() => { goTo(MAIN_SCOPE); }, [agentId, sessionId, goTo]);
  // 들어가 있던 폴더가 지도에서 사라졌으면(앞선 기록이 바뀌는 등) 세션 지도로 돌아온다.
  const placeScope: PlaceScope = scope.kind === 'bundle' ? scope.from : scope;
  useEffect(() => {
    if (placeScope.kind === 'folder' && !graph.folders[placeScope.id]) goTo(MAIN_SCOPE);
  }, [placeScope, graph, goTo]);

  // ─── 캔버스 배치 훅 — 세 화면 모두 캔버스의 것 ───
  const centerList = useMemo(() => [graph.center], [graph.center]);
  const rootLabel = rootPath ? (rootPath.split(/[\\/]/).filter(Boolean).pop() ?? null) : null;
  const mainData = useBubbleLayout({
    agents: scope.kind === 'main' ? centerList : NO_BUBBLES,
    folders: scope.kind === 'main' ? graph.top : NO_BUBBLES,
    edges: scope.kind === 'main' ? graph.edges : NO_ACTIVITY_EDGES,
    satellites: graph.satellites,
    rootLabel,
  });
  const folder = scope.kind === 'folder' ? graph.folders[scope.id] : undefined;
  const folderData = useFolderLayout({
    folderId: folder?.bubble.id ?? '',
    ...(folder ? { folderData: folder.bubble } : {}),
    agents: centerList,
    children: folder?.children ?? NO_BUBBLES,
    innerEdges: folder?.innerEdges ?? NO_ACTIVITY_EDGES,
    satellites: graph.satellites,
  });
  const bundleView = scope.kind === 'bundle' ? scope.view : null;
  const bundleMembers = useMemo(
    () => (bundleView ? bundleInteriorMembers(bundleView, graph.nodeMap, graph.children, graph.satellites) : NO_BUBBLES),
    [bundleView, graph],
  );
  const bundleData = useInteriorLayout({ view: bundleView, trashedAgents: NO_BUBBLES, bundleMembers });
  const viewData = scope.kind === 'main' ? mainData : scope.kind === 'folder' ? folderData : bundleData;

  // ─── 자리 · 노드 ───
  //   화면(세션 지도 · 폴더 안 · 묶음 안)마다 앉힌 자리를 들고 있다 — 들어갔다 나와도 옮겨 둔 자리 그대로다(캔버스와 같다).
  //   세션이 바뀌면 처음부터.
  const scopeKey = scopeKeyOf(scope);
  const placedRef = useRef(new Map<string, PlacedScope>());
  const [moved, setMoved] = useState<MovedSeats>(NO_MOVED);
  useEffect(() => {
    placedRef.current = new Map();
    setMoved(NO_MOVED);
  }, [agentId, sessionId]);
  const flow = useMemo(() => {
    const prev = placedRef.current.get(scopeKey);
    const hand = moved.get(scopeKey);
    const base = prev?.positions ?? NO_POSITIONS;
    const start = hand ? new Map([...base, ...hand]) : base;
    const positions = seatView(viewData, start, heat, scope.kind === 'bundle');
    return { key: scopeKey, positions, ...toSessionFlow(viewData, positions, agentId, prev?.nodes) };
  }, [viewData, scopeKey, moved, heat, scope.kind, agentId]);
  useEffect(() => {
    placedRef.current.set(flow.key, { positions: flow.positions, nodes: new Map(flow.nodes.map((n) => [n.id, n])) });
  }, [flow]);

  // ─── 끌기 — 캔버스처럼 버블을 옮긴다. 위성은 물리 대신 부모와 같은 변위로 따라온다 ───
  const dragRef = useRef<DragStart | null>(null);
  const dataIdOf = useCallback((nodeId: string): string => (nodeId === SESSION_CENTER_NODE_ID ? agentId : nodeId), [agentId]);
  const onNodeDragStart = useCallback((_e: React.MouseEvent, node: Node): void => {
    const id = dataIdOf(node.id);
    const start = new Map<string, XYPosition>([[id, { x: node.position.x, y: node.position.y }]]);
    for (const sat of viewData.satInfos) {
      if (sat.parentId !== id) continue;
      const pos = flow.positions.get(sat.bubble.id);
      if (pos) start.set(sat.bubble.id, pos);
    }
    dragRef.current = { nodeId: node.id, start };
  }, [dataIdOf, viewData, flow.positions]);
  const onNodeDrag = useCallback((_e: React.MouseEvent, node: Node): void => {
    const drag = dragRef.current;
    if (!drag || drag.nodeId !== node.id) return;
    const origin = drag.start.get(dataIdOf(node.id));
    if (!origin) return;
    const dx = node.position.x - origin.x;
    const dy = node.position.y - origin.y;
    setMoved((cur) => {
      const hand = new Map(cur.get(scopeKey));
      for (const [id, p] of drag.start) hand.set(id, { x: p.x + dx, y: p.y + dy });
      return new Map(cur).set(scopeKey, hand);
    });
  }, [dataIdOf, scopeKey]);
  const onNodeDragStop = useCallback((e: React.MouseEvent, node: Node): void => {
    onNodeDrag(e, node);
    dragRef.current = null;
  }, [onNodeDrag]);
  // 링은 노드 데이터 표식 — 링이 옮겨 갈 때 그 두 버블만 다시 그려진다.
  const ringed = useMemo(
    () => (ringId === null ? flow.nodes : flow.nodes.map((n) => (
      n.id === ringId ? { ...n, data: { ...n.data, [BUBBLE_HOST_RING]: true } } : n
    ))),
    [flow.nodes, ringId],
  );
  const measured = useMeasuredFlowNodes(ringed);

  // ─── 버블의 손짓 → 이 판 ───
  const host = useMemo<BubbleHost>(() => ({
    intent: (nodeId, active) => setRingId((cur) => (active ? nodeId : cur === nodeId ? null : cur)),
    select: (nodeId) => { setRingId(nodeId); setInfoId(nodeId); },
    menu: (nodeId) => { setRingId(nodeId); setInfoId(nodeId); },
  }), []);

  // ─── 동작 ───
  const openPane = useCallback((absPath: string): boolean => {
    openEditorFile(editorFileFromAbsPath(absPath, rootPath));
    return true;
  }, [openEditorFile, rootPath]);
  const openFile = useCallback((node: BubbleData): void => {
    // 캔버스와 같은 여는 길(받는 앱 → 변환 → 판 → OS) — 판 자리만 이 IDE 의 오른쪽 편집 판이다.
    openFileBubble(node, openPane);
  }, [openPane]);
  const openWeb = useCallback((host: string, url: string): void => {
    openWebAddress(`${WEB_PAGE_TAB_PREFIX}${webNodeKey(host)}`, url, host);
  }, []);
  const enterFolder = useCallback((id: string) => goTo({ kind: 'folder', id }), [goTo]);
  const goUp = useCallback(() => {
    if (scope.kind === 'bundle') { goTo(scope.from); return; }
    if (scope.kind !== 'folder') return;
    const parent = graph.folders[scope.id]?.parentId ?? null;
    goTo(parent ? { kind: 'folder', id: parent } : MAIN_SCOPE);
  }, [scope, graph, goTo]);
  const enterBundle = useCallback((node: Node, data: BubbleData): void => {
    const info = bundleInfoOf(data);
    const memberIds = info ? bundleInteriorIds(info, graph.nodeMap) : [];
    if (!info || memberIds.length === 0) return;
    goTo({
      kind: 'bundle',
      view: {
        kind: 'bundle',
        bundleId: node.id,
        label: data.label,
        memberIds,
        ...(info.source === 'folder' && info.folderId !== undefined ? { folderId: info.folderId, fileKind: info.kind } : {}),
      },
      from: placeScope,
    });
  }, [graph, goTo, placeScope]);

  /** 더블클릭 — 캔버스와 같은 뜻(`handleNodeDoubleClick`). 가운데 에이전트만 다르다 — 이미 그 IDE 안이라 [표준]으로 간다. */
  const onNodeDoubleClick = useCallback((_e: React.MouseEvent, node: Node): void => {
    const data = node.data as unknown as BubbleData;
    if (node.id === SESSION_CENTER_NODE_ID) { onShowStandard(); return; }
    if (data.id === '__root_back__' || data.id === '__interior_back__') { goUp(); return; }
    if (data.id === '__root_home__') { goTo(MAIN_SCOPE); return; }
    if (data.bubbleType === 'bundle') { enterBundle(node, data); return; }
    const entry = sessionCanvasEntryOf(graph, node.id);
    if (!entry) return;
    switch (entry.kind) {
      case 'folder': enterFolder(entry.folder.id); return;
      case 'file': openFile(data); return;
      case 'web':
        if (entry.web.kind === 'fetch' && entry.web.host && entry.web.lastUrl) openWeb(entry.web.host, entry.web.lastUrl);
        else onReturnToStream(entry.web.turnId);
        return;
      case 'app': onReturnToStream(entry.app.turnId); return;
      case 'task': onReturnToStream(entry.task.turnId); return;
      case 'center': onShowStandard(); return;
    }
  }, [graph, goTo, goUp, enterBundle, enterFolder, openFile, openWeb, onReturnToStream, onShowStandard]);

  /** 빈 곳 우클릭 — 캔버스 만들기 메뉴도 대화 칸 메뉴도 아니다(이 판에는 만들 것이 없다). */
  const onPaneContextMenu = useCallback((e: MouseEvent | React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
  }, []);
  const onRootContextMenu = useCallback((e: React.MouseEvent): void => {
    // 버블 위 우클릭은 버블이 이 판에 알리고 멈춘다 — 여기 닿는 것은 빈 곳·조작 손잡이 위다. 대화 칸 메뉴로 올리지 않는다.
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // 사용자가 끌거나 배율을 바꿨나 — 그 뒤로는 버블이 늘어도 저절로 다시 맞추지 않는다(보던 자리를 뺏지 않게).
  const userMovedRef = useRef(false);
  const onMoveStart = useCallback((event: MouseEvent | TouchEvent | null): void => {
    if (event) userMovedRef.current = true;
  }, []);

  // ─── 앞선 기록 ───
  const [olderBusy, setOlderBusy] = useState(false);
  const loadOlder = useCallback((): void => {
    if (olderSessionIds.length === 0) return;
    setOlderBusy(true);
    let left = olderSessionIds.length;
    for (const sid of olderSessionIds) {
      requestOlderStreamHistory(agentId, sid, () => {
        left -= 1;
        if (left <= 0) setOlderBusy(false);
      });
    }
    // 이미 청했거나 쉬는 중이라 콜백이 오지 않는 세션이 있으면 단추가 굳지 않게 한 번 풀어 둔다.
    window.setTimeout(() => setOlderBusy(false), 4000);
  }, [agentId, olderSessionIds]);
  const loadedEvents = useMemo(() => streams.reduce((n, s) => n + s.events.length, 0), [streams]);

  // ─── 경로 표시(캔버스와 같은 그림) ───
  const crumbs = useMemo((): BreadcrumbCrumb[] => {
    const chain: BreadcrumbCrumb[] = [];
    if (placeScope.kind === 'folder') {
      let cur: string | null = placeScope.id;
      while (cur) {
        const entry = graph.entries.get(cur);
        if (entry?.kind !== 'folder') break;
        chain.unshift({ id: cur, label: folderCrumbLabel(entry.folder) });
        cur = entry.folder.parentId;
      }
    }
    if (scope.kind === 'bundle') {
      chain.push({ id: scope.view.bundleId, label: t('canvas.bundle.crumb', { name: scope.view.label }), interior: true });
    }
    return chain;
  }, [placeScope, scope, graph, t]);

  const infoEntry = infoId ? sessionCanvasEntryOf(graph, infoId) : null;
  const infoNodeId = infoId === null ? null : infoId.startsWith('sat-') ? infoId.slice(4) : infoId;
  const infoNode = infoNodeId ? graph.nodeMap[infoNodeId] ?? null : null;

  return (
    <div
      {...{ [SESSION_BUBBLES_ATTR]: '', [FOREIGN_FLOW_ATTR]: '' }}
      role="application"
      aria-label={t('ide.bubbles.mapLabel')}
      className="relative h-full min-h-0 w-full flex-1 select-none overflow-hidden bg-vb-canvas"
      onContextMenu={onRootContextMenu}
    >
      <BubbleHostContext.Provider value={host}>
        <ReactFlow
          nodes={measured.nodes}
          edges={flow.edges}
          onNodesChange={measured.onNodesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          onNodeDoubleClick={onNodeDoubleClick}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onPaneClick={resetSelection}
          onPaneContextMenu={onPaneContextMenu}
          onMoveStart={onMoveStart}
          nodeDragThreshold={NODE_DRAG_THRESHOLD}
          nodesConnectable={false}
          elementsSelectable={false}
          minZoom={MAP_MIN_ZOOM}
          maxZoom={MAP_MAX_ZOOM}
          fitView
          fitViewOptions={FIT_OPTIONS}
          proOptions={PRO_OPTIONS}
          className="bg-vb-canvas"
        >
          <EdgeMask />
          {/* 캔버스와 같은 점 배경(의미 토큰 `canvas.dots`). */}
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--color-vb-canvas-dots)" />
          <CanvasZoomControls position="top-right" />
          <SessionMapCamera fitKey={scopeKey} count={flow.nodes.length} userMovedRef={userMovedRef} />
        </ReactFlow>
      </BubbleHostContext.Provider>

      {/* ── 위쪽: 들어간 자리(캔버스 경로 표시와 같은 그림) · 답 대기 알림 ── */}
      <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex flex-col items-center gap-2 px-3">
        {crumbs.length > 0 && (
          <BreadcrumbTrail
            rootLabel={title}
            onRoot={() => goTo(MAIN_SCOPE)}
            crumbs={crumbs}
            onCrumb={(crumb) => { if (!crumb.interior) enterFolder(crumb.id); }}
          />
        )}
        {pendingAsks > 0 && (
          <div className="pointer-events-auto flex min-w-0 max-w-full items-center gap-2 rounded-md border border-amber-400/60 bg-amber-950/90 px-2 py-1 text-[12px] text-amber-100 shadow-lg">
            <span className="relative flex h-2 w-2 flex-shrink-0" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400/70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
            </span>
            <span className="min-w-0 truncate">{t('ide.bubbles.pendingAsk', { count: pendingAsks })}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onReturnToStream(null); }}
              className="flex-shrink-0 rounded border border-amber-300/50 px-1.5 py-0.5 font-semibold text-amber-50 transition-colors hover:bg-amber-500/20 pointer-coarse:py-1.5"
            >
              {t('ide.bubbles.goToConversation')}
            </button>
          </div>
        )}
      </div>

      {/* ── 빈 상태 ── */}
      {model.empty && scope.kind === 'main' && (
        <div className="pointer-events-none absolute inset-x-4 bottom-12 z-10 text-center text-[12px] text-gray-500">
          {t('ide.bubbles.empty')}
        </div>
      )}

      {/* ── 정보 칸(고른 버블) ── */}
      {infoEntry && (
        <SessionBubbleInfo
          entry={infoEntry}
          node={infoNode}
          graph={graph}
          model={model}
          title={title}
          webSearchLabel={webSearchLabel}
          currentFolderId={placeScope.kind === 'folder' ? placeScope.id : null}
          onClose={resetSelection}
          onOpenFile={openFile}
          onEnter={enterFolder}
          onOpenWeb={openWeb}
          onReturnToStream={onReturnToStream}
        />
      )}

      {/* ── 바닥 줄: 몇 번의 호출로 지었나 · 앞선 기록 ── */}
      <div className="pointer-events-none absolute bottom-2 right-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[12px] text-gray-500">
        <span className="truncate">{t('ide.bubbles.summary', { calls: model.toolCalls, events: loadedEvents })}</span>
        {olderSessionIds.length > 0 && (
          <button
            type="button"
            disabled={olderBusy}
            onClick={(e) => { e.stopPropagation(); loadOlder(); }}
            title={t('ide.bubbles.loadOlderTip')}
            className="pointer-events-auto flex-shrink-0 rounded border border-gray-700/70 bg-gray-900/90 px-1.5 py-0.5 text-gray-300 transition-colors hover:bg-gray-800 hover:text-gray-100 disabled:opacity-50 pointer-coarse:py-1.5"
          >
            {olderBusy ? t('ide.explorer.loading') : t('ide.bubbles.loadOlder')}
          </button>
        )}
      </div>
    </div>
  );
});

/**
 * 화면 맞추기 — `<ReactFlow>` 안에 있어야 그 인스턴스를 부린다. 화면(자리)이 바뀌면 늘, 같은 화면에서 버블이 늘면 사용자가
 * 손대지 않았을 때만 맞춘다. 버블이 다 재어진 뒤에 맞춘다(재기 전에 맞추면 크기 없는 점들에 맞춰 너무 가까이 간다).
 */
function SessionMapCamera({ fitKey, count, userMovedRef }: {
  fitKey: string;
  count: number;
  userMovedRef: React.MutableRefObject<boolean>;
}): null {
  const { fitView } = useReactFlow();
  const initialized = useNodesInitialized();
  const lastKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialized) return;
    if (lastKeyRef.current !== fitKey) {
      lastKeyRef.current = fitKey;
      userMovedRef.current = false;
    } else if (userMovedRef.current) {
      return;
    }
    void fitView(FIT_OPTIONS);
  }, [initialized, fitKey, count, fitView, userMovedRef]);
  return null;
}

// ─── 정보 칸 ────────────────────────────────────────────────────────────────

interface SessionBubbleInfoProps {
  entry: SessionCanvasEntry;
  /** 그 버블의 캔버스 모양(파일 열기에 쓴다). 가운데·웹·앱·서브에이전트는 없을 수 있다. */
  node: BubbleData | null;
  graph: SessionCanvasGraph;
  model: ReturnType<typeof buildSessionBubbles>;
  title: string;
  webSearchLabel: string;
  /** 지금 들어가 있는 폴더 — 그 폴더의 [들어가기]는 세우지 않는다. */
  currentFolderId: string | null;
  onClose: () => void;
  onOpenFile: (node: BubbleData) => void;
  onEnter: (folderId: string) => void;
  onOpenWeb: (host: string, url: string) => void;
  onReturnToStream: (turnId: string | null) => void;
}

function touchOfEntry(entry: SessionCanvasEntry): SessionTouch | null {
  switch (entry.kind) {
    case 'center': return null;
    case 'folder': return entry.folder;
    case 'file': return entry.file;
    case 'web': return entry.web;
    case 'app': return entry.app;
    case 'task': return entry.task;
  }
}

/** 고른 버블의 정보 칸 — 전체 경로·횟수·마지막으로 닿은 일 + 그 버블의 동작 단추. 터치에서도 누름 한 번으로 닿는다. */
function SessionBubbleInfo({
  entry, node, graph, model, title, webSearchLabel, currentFolderId, onClose, onOpenFile, onEnter, onOpenWeb, onReturnToStream,
}: SessionBubbleInfoProps): React.JSX.Element {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = (text: string): void => {
    void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => { /* 막히면 조용히 — 단추는 그대로 */ });
  };
  const touch = touchOfEntry(entry);
  const lines: React.ReactNode[] = [];
  const actions: Array<{ id: string; label: string; run: () => void; primary?: boolean }> = [];
  let heading = title;

  switch (entry.kind) {
    case 'center':
      lines.push(<span key="totals">{t('ide.bubbles.centerTotals', {
        files: model.fileCount, webs: model.webs.length, apps: model.apps.length, tasks: model.tasks.length,
      })}</span>);
      lines.push(<span key="rw">{`${t('ide.bubbles.reads', { count: model.readCount })} · ${t('ide.bubbles.writes', { count: model.writeCount })}`}</span>);
      break;
    case 'file': {
      const file = entry.file;
      heading = file.name;
      lines.push(<span key="path" className="break-all text-gray-400">{file.path}</span>);
      if (node) actions.push({ id: 'open', label: t('ide.explorer.ctx.open'), run: () => onOpenFile(node), primary: true });
      actions.push({ id: 'copy', label: copied ? t('ide.explorer.copied') : t('ide.explorer.copyPath'), run: () => copy(file.path) });
      break;
    }
    case 'folder': {
      const folder = entry.folder;
      heading = folderCrumbLabel(folder);
      lines.push(<span key="path" className="break-all text-gray-400">{folder.path}</span>);
      if (!folder.internal) lines.push(<span key="ext" className="text-gray-500">{t('ide.bubbles.external')}</span>);
      lines.push(<span key="files">{t('ide.bubbles.files', { count: folder.files.length })}{folder.searches > 0 ? ` · ${t('ide.bubbles.searches', { count: folder.searches })}` : ''}</span>);
      if (folder.id !== currentFolderId && graph.folders[folder.id]) {
        actions.push({ id: 'enter', label: t('ide.bubbles.enter'), run: () => onEnter(folder.id), primary: true });
      }
      actions.push({ id: 'copy', label: copied ? t('ide.explorer.copied') : t('ide.explorer.copyPath'), run: () => copy(folder.path) });
      break;
    }
    case 'web': {
      const web = entry.web;
      heading = web.kind === 'search' ? webSearchLabel : (web.host ?? '');
      if (web.kind === 'fetch' && web.lastUrl) {
        const host = web.host;
        const url = web.lastUrl;
        lines.push(<span key="url" className="break-all text-gray-400">{url}</span>);
        if (host) actions.push({ id: 'open', label: t('ide.bubbles.openAddress'), run: () => onOpenWeb(host, url), primary: true });
        actions.push({ id: 'copy', label: copied ? t('ide.explorer.copied') : t('ide.bubbles.copyAddress'), run: () => copy(url) });
      }
      if (web.kind === 'search' && web.queries.length > 0) {
        lines.push(<span key="qh" className="text-gray-500">{t('ide.bubbles.recentQueries')}</span>);
        web.queries.forEach((q, i) => lines.push(<span key={`q${String(i)}`} className="truncate text-gray-300">{q}</span>));
      }
      break;
    }
    case 'app': {
      const app = entry.app;
      heading = app.name;
      if (app.commands.length > 0) {
        lines.push(<span key="ch" className="text-gray-500">{t('ide.bubbles.recentCommands')}</span>);
        app.commands.forEach((c, i) => lines.push(<span key={`c${String(i)}`} className="truncate font-mono text-gray-300" title={c}>{c}</span>));
        const last = app.commands[0]!;
        actions.push({ id: 'copy', label: copied ? t('ide.explorer.copied') : t('ide.bubbles.copyCommand'), run: () => copy(last) });
      }
      break;
    }
    case 'task': {
      const task = entry.task;
      heading = task.description;
      if (task.agentType) lines.push(<span key="type" className="text-gray-400">{task.agentType}</span>);
      lines.push(<span key="state">{task.done ? t('canvas.agentCard.status.completed') : t('ide.loop.status.running')}</span>);
      break;
    }
  }

  if (touch) {
    // 읽기·쓰기 횟수는 파일·폴더·웹 가져오기의 말이다 — 서브에이전트·명령 앱·웹 검색은 상태·명령·검색어 목록이 말한다.
    const countsTouches = entry.kind === 'file' || entry.kind === 'folder' || (entry.kind === 'web' && entry.web.kind === 'fetch');
    if (countsTouches) {
      lines.push(<span key="rwt">{[
        touch.reads > 0 ? t('ide.bubbles.reads', { count: touch.reads }) : null,
        touch.writes > 0 ? t('ide.bubbles.writes', { count: touch.writes }) : null,
      ].filter(Boolean).join(' · ')}</span>);
    }
    lines.push(<span key="last" className="text-gray-400">{t('ide.bubbles.lastTouch', { tool: touch.lastTool, when: formatSince(touch.lastAt, t) })}</span>);
    if (!touch.direct && touch.viaTaskKey) {
      const via = model.tasks.find((x) => x.key === touch.viaTaskKey)?.description;
      if (via) lines.push(<span key="via" className="text-gray-400">{t('ide.bubbles.viaTask', { name: via })}</span>);
    }
    if (touch.turnId !== null || entry.kind === 'task' || entry.kind === 'app') {
      actions.push({ id: 'turn', label: t('ide.bubbles.showInConversation'), run: () => onReturnToStream(touch.turnId), primary: !actions.some((a) => a.primary) });
    }
  }

  return (
    <div
      className="absolute bottom-9 left-2 z-20 flex max-h-[calc(100%-4.5rem)] w-[min(24rem,calc(100%-1rem))] flex-col gap-1.5 overflow-auto rounded-lg border border-gray-700/80 bg-gray-900/95 p-2.5 text-[12px] text-gray-200 shadow-xl shadow-black/40"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className="min-w-0 flex-1 break-words font-semibold text-gray-100">{heading}</span>
        <button
          type="button"
          onClick={onClose}
          title={t('common.close')}
          aria-label={t('common.close')}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200 pointer-coarse:h-8 pointer-coarse:w-8"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">{lines}</div>
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={a.run}
              className={`rounded border px-2 py-0.5 text-[12px] transition-colors pointer-coarse:py-1.5 ${
                a.primary
                  ? 'border-blue-400/70 bg-blue-500/20 text-blue-100 hover:bg-blue-500/30'
                  : 'border-gray-600/70 text-gray-300 hover:bg-gray-800 hover:text-gray-100'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 이 칸의 스트림 묶음 — Sub 탭이면 그 세션 하나, 메인 탭이면 그 탭이 그리는 세션 전부(`IDEMainArea` 의 `streams` 와 같은 조립).
 * 명령은 세션별로 갈라 넣는다(턴 귀속이 세션 단위다).
 */
export function sessionBubbleStreamsOf(
  streams: Record<string, readonly SubAgentStreamEvent[]>,
  commands: readonly QueuedCommand[],
): SessionBubbleStream[] {
  return Object.entries(streams).map(([subId, events]) => ({
    events,
    commands: commands.filter((c) => c.subAgentId === subId),
  }));
}

/** 처음까지 실리지 않은 세션들 — 그 세션의 버퍼가 비어 있지 않고 끝 표식이 없다. */
export function useOlderSessionIds(sessionIds: readonly string[]): string[] {
  const key = useGraphStore((s) => sessionIds
    .filter((id) => (s.subAgentStreams[id]?.length ?? 0) > 0 && !s.streamHistoryDone[id])
    .join('\n'));
  return useMemo(() => (key ? key.split('\n') : []), [key]);
}
