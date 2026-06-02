import { useCallback, useEffect, useRef, useMemo, useState, memo } from 'react';
import {
  ReactFlow,
  Background,
  type Node,
  type Edge,
  type NodeTypes,
  type XYPosition,
  type ReactFlowInstance,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  useUpdateNodeInternals,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { EdgeTypes } from '@xyflow/react';
import type { BubbleData, BubbleType, CommentBox } from '@vibisual/shared';
import { EDGE_STYLE, POSITION_SAVE_INTERVAL, TASK_EDGE_STYLES, COMMENT_BOX_DEFAULTS, LAYOUT_CENTER_X, LAYOUT_CENTER_Y, SATELLITE_TYPES } from '@vibisual/shared';
import { BubbleNode } from './BubbleNode.js';
import { CommentBoxNode } from './CommentBoxNode.js';
import { CurvedEdge } from './CurvedEdge.js';
import { EdgeMask } from './EdgeMask.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { placeSatellitePositions } from '../../utils/satellite.js';
import { toFlowNodes, findNonCollidingPosition, SPAWN_RADIUS, SPAWN_MIN_DIST } from '../../utils/flowBuilder.js';
import { calcBubbleSize } from '../../utils/sizeCalc.js';
import { usePhysicsLayout } from '../../hooks/usePhysicsLayout.js';
import { useBubbleLayout, useFolderLayout, usePipelineLayout } from '../../hooks/useBubbleLayout.js';
import { CanvasContextMenu } from './CanvasContextMenu.js';
import { DebugOverlay } from './DebugOverlay.js';
import { LayoutBoundsBox } from './LayoutBoundsBox.js';
import { CanvasControls } from './CanvasControls.js';
import { AgentIDEOverlay } from '../IDE/AgentIDEOverlay.js';
import { ContiBoardPanel } from '../Panel/ContiBoardPanel.js';
import { TaskEdgeComponent } from './TaskEdgeComponent.js';
import { TaskEdgePopup } from './TaskEdgePopup.js';
import { TaskEdgeDragPreview } from './TaskEdgeDragPreview.js';
import { TaskEdgePopupPreview } from './TaskEdgePopupPreview.js';
import { computeAngularOffsets, computeParallelOffsets } from './taskEdgeOffsets.js';
import { useCanvasClipboard } from '../../hooks/useCanvasClipboard.js';
import { useTranslation } from 'react-i18next';

const nodeTypes: NodeTypes = { bubble: BubbleNode, commentBox: CommentBoxNode };
const edgeTypes: EdgeTypes = { curved: CurvedEdge, taskEdge: TaskEdgeComponent };

// ─── 컴포넌트 ───

export const BubbleMap = memo(function BubbleMap(): React.JSX.Element {
  const allAgents = useGraphStore((s) => s.agents);
  const agentProjects = useGraphStore((s) => s.agentProjects);
  const activeProject = useGraphStore((s) => s.activeProject);
  const worktreeProjects = useGraphStore((s) => s.worktreeProjects);
  const topFolders = useGraphStore((s) => s.topFolders);
  const nodeProjects = useGraphStore((s) => s.nodeProjects);
  const storeEdges = useGraphStore((s) => s.edges);
  const storeChildren = useGraphStore((s) => s.children);
  const storeInnerEdges = useGraphStore((s) => s.innerEdges);
  const storeSatellites = useGraphStore((s) => s.satellites);
  const satellitePositions = useGraphStore((s) => s.satellitePositions);
  const currentFolderId = useGraphStore((s) => s.currentFolderId);
  const pendingFocus = useGraphStore((s) => s.pendingFocus);
  const focusNodeId = useGraphStore((s) => s.focusNodeId);
  const debugMode = useGraphStore((s) => s.debugMode);

  // 서버가 TTL 필터링 완료 → 클라이언트는 프로젝트 필터만.
  // worktree 버블 내부로 드릴다운 중이면 해당 worktree 프로젝트 에이전트로 필터 전환.
  const effectiveAgentProject = useMemo(() => {
    if (currentFolderId && worktreeProjects[currentFolderId]) {
      return worktreeProjects[currentFolderId];
    }
    return activeProject;
  }, [currentFolderId, worktreeProjects, activeProject]);
  const agents = useMemo(() => {
    return !effectiveAgentProject ? allAgents : allAgents.filter((a) => agentProjects[a.id] === effectiveAgentProject);
  }, [allAgents, agentProjects, effectiveAgentProject]);

  // 필터된 에이전트 ID Set (엣지 필터용)
  const agentIds = useMemo(
    () => new Set(agents.map((a) => a.id)),
    [agents],
  );

  // 현재 프로젝트 에이전트와 연결된 엣지만
  const filteredEdges = useMemo(
    () => storeEdges.filter((e) => agentIds.has(e.source) || agentIds.has(e.target)),
    [storeEdges, agentIds],
  );

  // 현재 프로젝트 에이전트와 엣지로 연결된 폴더만
  const filteredFolderIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of filteredEdges) {
      if (agentIds.has(e.source)) ids.add(e.target);
      if (agentIds.has(e.target)) ids.add(e.source);
    }
    return ids;
  }, [filteredEdges, agentIds]);

  const filteredFolders = useMemo(
    () => topFolders.filter((f) => {
      // root/worktree 노드: activeProject가 일치하는 프로젝트만 (엣지 없이도 앵커로 항상 표시)
      if (f.bubbleType === 'root' || f.bubbleType === 'worktree') {
        return !activeProject || nodeProjects[f.id] === activeProject;
      }
      // ghost/disappearing 노드: 프로젝트 일치하면 항상 표시 (페이드아웃 보여줌)
      if (f.bubbleType === 'ghost' || f.status === 'disappearing') {
        return !activeProject || nodeProjects[f.id] === activeProject;
      }
      // pinned/preservePinned 노드: 해당 프로젝트 소속이면 항상 표시
      // (preservePinned 는 자동 소멸 방지 축 — 엣지가 끊겨도 사용자가 핀 해제하거나
      //  Delete 로 명시 삭제 전까지는 화면에 유지)
      if (f.pinned || f.preservePinned) {
        return !activeProject || nodeProjects[f.id] === activeProject;
      }
      // 내부 폴더(internal_folder)는 반드시 현재 프로젝트 소속이어야 함 — 타 프로젝트 누출 차단.
      // nodeProjects 매핑이 없으면(소속 불명) 표시하지 않음: "모르면 숨긴다" 원칙.
      if (activeProject && f.bubbleType === 'internal_folder') {
        if (nodeProjects[f.id] !== activeProject) return false;
      }
      return filteredFolderIds.has(f.id);
    }),
    [topFolders, filteredFolderIds, activeProject, nodeProjects],
  );

  // 캔버스가 실제로 렌더하는 최상위 버블 집합을 store 에 publish (RootFileList "Visible" SSOT).
  // filteredFolders 는 currentFolderId 와 무관하게 항상 계산되므로 드릴다운 중에도 유효.
  const setCanvasVisibleNodeIds = useGraphStore((s) => s.setCanvasVisibleNodeIds);
  useEffect(() => {
    setCanvasVisibleNodeIds(filteredFolders.map((f) => f.id));
  }, [filteredFolders, setCanvasVisibleNodeIds]);

  const positionsRef = useRef(new Map<string, XYPosition>());
  const rfRef = useRef<ReactFlowInstance | null>(null);
  // Comment Box 드래그 시작 시점의 자신 + 자식 초기 위치 스냅샷 (동반 이동 계산용, v1.45)
  const commentDragStartRef = useRef<{ boxId: string; snapshot: Map<string, XYPosition> } | null>(null);
  // 메인 ReactFlow 컨테이너 scope — debug 모드에서 DebugPanel 이 자체 `.react-flow` 를 렌더하므로
  // document.querySelector('.react-flow') 가 DebugPanel 쪽을 잡는 문제를 피하려고 이 ref 내부에서만 탐색.
  const rfContainerRef = useRef<HTMLDivElement>(null);
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // 배치 저장용 — 물리 엔진이 setFlowNodes로 업데이트한 최신 위치를 항상 참조
  const flowNodesRef = useRef<Node[]>([]);
  flowNodesRef.current = flowNodes;

  // §5.4 #29 v1.51 — 캔버스 클립보드 훅이 selected=true 엣지/노드 정보를 즉시 읽도록 ref 미러
  const flowEdgesRef = useRef<Edge[]>([]);
  flowEdgesRef.current = edges;

  // Ctrl 키를 누른 채 줌할 때만 줌 한계를 확장 (기본은 ReactFlow 기본 0.5~2)
  const [zoomCtrlHeld, setZoomCtrlHeld] = useState(false);
  useEffect(() => {
    const setHeld = (held: boolean) => setZoomCtrlHeld((prev) => (prev === held ? prev : held));
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta' || e.ctrlKey || e.metaKey) setHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') setHeld(false);
    };
    const reset = () => setHeld(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', reset);
    };
  }, []);

  // 장면 전환
  const [transition, setTransition] = useState<'none' | 'zoom-in' | 'zoom-out'>('none');
  const prevFolderRef = useRef<string | null>(null);
  const prevProjectRef = useRef(activeProject);

  /** 뷰 상태 캐시: folderId(null=메인) → { viewport, positions } */
  const viewCacheRef = useRef(new Map<string, {
    viewport: { x: number; y: number; zoom: number };
    positions: Map<string, XYPosition>;
  }>());

  const isEmpty = agents.length === 0 && filteredFolders.length === 0;

  // Task Edge (에이전트 간 작업 흐름)
  const storeTaskEdges = useGraphStore((s) => s.taskEdges);
  const taskEdgePreview = useGraphStore((s) => s.taskEdgePreview);
  const [taskEdgePopup, setTaskEdgePopup] = useState<{
    sourceAgentId: string;
    targetAgentId: string;
    screenX: number;
    screenY: number;
  } | null>(null);

  // ── 커스텀 Task Edge 드래그 (테두리 아무 곳에서 시작) ──
  const taskEdgeDrag = useGraphStore((s) => s.taskEdgeDrag);
  // Task Edge 편집 팝업 (원형 아이콘 더블클릭 시 열림)
  const taskEdgeEditPopup = useGraphStore((s) => s.taskEdgeEditPopup);
  const closeTaskEdgeEdit = useGraphStore((s) => s.closeTaskEdgeEdit);
  // updateTaskEdgeDrag/endTaskEdgeDrag 는 mount-시 고정 listener 내부에서
  // useGraphStore.getState() 로 매번 최신 참조를 가져와 사용 (useEffect deps 타이밍 누락 회피)

  // 드래그 취소/드롭 처리 — listener는 마운트 시 한 번만 부착하고 내부에서 store 상태를 조회한다.
  // (useEffect deps로 부착하면 state 변경 → 다음 렌더 사이에 이벤트가 새는 타이밍 이슈 발생)
  useEffect(() => {
    const isDragging = (): boolean => useGraphStore.getState().taskEdgeDrag !== null;

    // pointermove 사용 — BubbleNode pointerdown 에서 preventDefault() 호출 시
    // 해당 포인터의 mousemove 호환 이벤트가 생성되지 않아 추적이 끊기기 때문.
    const onMove = (e: PointerEvent): void => {
      if (!isDragging()) return;
      useGraphStore.getState().updateTaskEdgeDrag(e.clientX, e.clientY);
    };

    /**
     * 포인터 위치에서 유효한 연결 타겟을 찾는다.
     * 유효 = bubbleType='agent' + customCreated=true + 소스와 다른 노드.
     */
    const findValidTargetAt = (clientX: number, clientY: number, sourceId: string): string | null => {
      const el = document.elementFromPoint(clientX, clientY);
      const nodeEl = el?.closest('.react-flow__node');
      const targetId = nodeEl?.getAttribute('data-id') ?? null;
      if (!targetId || targetId === sourceId) return null;
      const targetNode = useGraphStore.getState().nodeMap[targetId];
      if (!targetNode) return null;
      if (targetNode.bubbleType !== 'agent') return null;
      if (!targetNode.customCreated) return null;
      return targetId;
    };

    const confirmDrop = (e: { clientX: number; clientY: number }, validTargetId: string, sourceId: string): void => {
      setTaskEdgePopup({
        sourceAgentId: sourceId,
        targetAgentId: validTargetId,
        screenX: e.clientX,
        screenY: e.clientY,
      });
      useGraphStore.getState().endTaskEdgeDrag();
    };

    /**
     * drag phase의 pointerup 처리 — 유효 타겟이면 확정, 아니면 follow 모드로 전환(취소 X).
     * SCENARIO v1.16: "무효 드롭은 즉시 취소하지 않고 마우스 follow 유지".
     */
    const finishDragRelease = (e: { clientX: number; clientY: number }): void => {
      const drag = useGraphStore.getState().taskEdgeDrag;
      if (!drag) return;
      const targetId = findValidTargetAt(e.clientX, e.clientY, drag.sourceId);
      if (targetId) {
        confirmDrop(e, targetId, drag.sourceId);
      } else {
        useGraphStore.getState().setTaskEdgeDragFollow();
      }
    };

    /**
     * follow phase의 좌클릭 처리 — 유효 타겟이면 확정, 아니면 취소.
     * (빈 캔버스·비-커스텀 버블·자기 자신 클릭 모두 취소.)
     */
    const finishFollowClick = (e: { clientX: number; clientY: number }): void => {
      const drag = useGraphStore.getState().taskEdgeDrag;
      if (!drag) return;
      const targetId = findValidTargetAt(e.clientX, e.clientY, drag.sourceId);
      if (targetId) {
        confirmDrop(e, targetId, drag.sourceId);
      } else {
        useGraphStore.getState().endTaskEdgeDrag();
      }
    };

    // mouseup: drag phase에서만 처리. follow phase에서는 mousedown(onDown)에서 확정/취소.
    const onUp = (e: MouseEvent): void => {
      const drag = useGraphStore.getState().taskEdgeDrag;
      if (!drag || drag.phase !== 'drag') return;
      if (e.button === 0) finishDragRelease(e);
      else useGraphStore.getState().endTaskEdgeDrag();
    };
    // pointerup 백업 — 일부 브라우저/펜입력에서 mouseup 누락 대비
    const onPointerUp = (e: PointerEvent): void => {
      const drag = useGraphStore.getState().taskEdgeDrag;
      if (!drag || drag.phase !== 'drag') return;
      if (e.button === 0) finishDragRelease(e);
      else useGraphStore.getState().endTaskEdgeDrag();
    };

    // mousedown 캡처 — 중/우 버튼은 어느 phase에서든 즉시 취소.
    // follow phase의 좌클릭은 확정/취소 판정(ReactFlow 선택·우클릭 메뉴보다 먼저).
    const onDown = (e: MouseEvent): void => {
      const drag = useGraphStore.getState().taskEdgeDrag;
      if (!drag) return;
      if (e.button === 1 || e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
        useGraphStore.getState().endTaskEdgeDrag();
        return;
      }
      if (e.button === 0 && drag.phase === 'follow') {
        e.preventDefault();
        e.stopPropagation();
        finishFollowClick(e);
      }
    };

    // 우클릭 컨텍스트 메뉴 억제 + 취소
    const onContextMenu = (e: MouseEvent): void => {
      if (!isDragging()) return;
      e.preventDefault();
      e.stopPropagation();
      useGraphStore.getState().endTaskEdgeDrag();
    };

    // ESC → 취소
    const onKey = (e: KeyboardEvent): void => {
      if (!isDragging()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        useGraphStore.getState().endTaskEdgeDrag();
      }
    };

    // 포커스 이탈/탭 숨김 → 취소
    const onBlur = (): void => {
      if (isDragging()) useGraphStore.getState().endTaskEdgeDrag();
    };
    const onVisibility = (): void => {
      if (document.hidden && isDragging()) useGraphStore.getState().endTaskEdgeDrag();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('contextmenu', onContextMenu, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // 캔버스 우클릭 컨텍스트 메뉴
  const [ctxMenu, setCtxMenu] = useState<{ screenX: number; screenY: number; canvasX: number; canvasY: number } | null>(null);
  const createCustomAgent = useGraphStore((s) => s.createCustomAgent);
  const createCmdAgent = useGraphStore((s) => s.createCmdAgent);
  const createAutoAgent = useGraphStore((s) => s.createAutoAgent);
  const createPipeline = useGraphStore((s) => s.createPipeline);
  const createWorktree = useGraphStore((s) => s.createWorktree);
  const pendingWorktrees = useGraphStore((s) => s.pendingWorktrees);
  const pendingNodes = useMemo<Node[]>(() => pendingWorktrees.map((p) => ({
    id: p.id,
    type: 'bubble' as const,
    position: p.position ?? { x: 0, y: 0 },
    data: { ...p } as BubbleData & Record<string, unknown>,
    draggable: false,
    selectable: false,
    deletable: false,
  })), [pendingWorktrees]);
  // ── Comment Box (v1.45) — 메인 뷰에서만 렌더, 현재 프로젝트만 필터 ──
  const allCommentBoxes = useGraphStore((s) => s.commentBoxes);
  const selectedCommentBoxId = useGraphStore((s) => s.selectedCommentBoxId);
  const scopedCommentBoxes = useMemo<CommentBox[]>(() => {
    if (currentFolderId !== null) return [];
    if (!activeProject) return allCommentBoxes;
    return allCommentBoxes.filter((b) => b.projectName === activeProject);
  }, [allCommentBoxes, activeProject, currentFolderId]);

  const commentBoxNodes = useMemo<Node[]>(() => {
    return scopedCommentBoxes.map((b) => ({
      id: b.id,
      type: 'commentBox' as const,
      // 드래그/리사이즈 중에는 patchCommentBoxLocal 이 b.x/b.y/b.width/b.height 를 직접 갱신하므로
      // 별도 오버라이드 없이 서버 + 로컬 낙관 업데이트가 한 채널로 통합. 서버 snapshot 이 도착하면
      // 자연스럽게 권위적 값으로 덮인다.
      position: { x: b.x, y: b.y },
      width: b.width,
      height: b.height,
      data: {
        commentBoxId: b.id,
        text: b.text,
        color: b.color,
        textColor: b.textColor,
        fontSize: b.fontSize,
        opacity: b.opacity,
        width: b.width,
        height: b.height,
      },
      selected: selectedCommentBoxId === b.id,
      draggable: true,
      // React Flow 의 노드 자동 선택을 끄고, 선택은 CommentBoxNode 내부 헤더 onClick →
      // selectCommentBox(=selectedCommentBoxId) 채널만 사용. 본문(body) 클릭은 무반응.
      selectable: false,
      deletable: false,
      // 드래그는 헤더 strip(.comment-box-header) 에서만 시작 — UE 블프 코멘트 패턴.
      // 선택/편집 둘 다 헤더에서만 일어남.
      dragHandle: '.comment-box-header',
      // React Flow 노드 wrapper(.react-flow__node-commentBox) 자체를 pointerEvents:none
      // 으로 만들어 본문(body) 빈 영역의 mousedown 이 캔버스 pane 으로 떨어지게 한다.
      // 헤더·NodeResizer 의 hit-area 는 CommentBoxNode 내부에서 pointerEvents:'auto' 로
      // 되살리므로 선택/이동/리사이즈 동작은 그대로.
      style: { pointerEvents: 'none' },
      // "뒤에 깔리는" 효과는 DOM 렌더 순서로만 — displayNodes 에서 commentBox 를 먼저 push
      // → 같은 zIndex(=0) 일 때 후순위(버블) 가 위로 그려지고, hit-test 도 자연스럽게 버블 우선.
      // zIndex 를 음수로 주면 hit-test 가 뒤로 빠져서 빈 영역 클릭이 캔버스에 새므로 사용 금지.
    } as Node));
  }, [scopedCommentBoxes, selectedCommentBoxId]);

  const displayNodes = useMemo<Node[]>(() => {
    const base = pendingNodes.length === 0 ? flowNodes : [...flowNodes, ...pendingNodes];
    if (commentBoxNodes.length === 0) return base;
    // CommentBox 먼저(뒤로), 그 다음 일반 버블/pending (앞으로)
    return [...commentBoxNodes, ...base];
  }, [flowNodes, pendingNodes, commentBoxNodes]);

  const handlePaneContextMenu = useCallback((e: MouseEvent | React.MouseEvent) => {
    // Ignore right-click on nodes (bubble-body) or context menu itself
    const target = e.target as HTMLElement;
    if (target.closest('.react-flow__node') || target.closest('.react-flow__controls')) return;
    e.preventDefault();
    if (!rfRef.current) return;
    const canvasPos = rfRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setCtxMenu({ screenX: e.clientX, screenY: e.clientY, canvasX: canvasPos.x, canvasY: canvasPos.y });
    useGraphStore.getState().selectNode(null);
  }, []);

  const handleCtxClose = useCallback(() => {
    setCtxMenu(null);
    useGraphStore.getState().selectNode(null);
  }, []);

  // ─── 전체 위치 저장 (드래그 종료 / 물리 슬립 / 주기적 / 탭 전환) ───
  const buildPositionPayload = useCallback((): string | null => {
    const nodes = flowNodesRef.current;
    if (nodes.length === 0) return null;
    const positions = nodes
      .filter((n) => n.position.x !== 0 || n.position.y !== 0)
      .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));
    if (positions.length === 0) return null;
    return JSON.stringify({ positions });
  }, []);

  const flushPositionsFetch = useCallback(() => {
    const body = buildPositionPayload();
    if (!body) return;
    fetch(`/api/bubbles/positions`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => {});
  }, [buildPositionPayload]);

  // 위성 부모-자식 매핑 — usePhysicsLayout보다 앞에 선언 (deps 순서)
  const satInfosRef = useRef<{ parentId: string; bubble: BubbleData }[]>([]);

  // 물리 엔진 — pauseAndReset를 effect보다 먼저 확보하기 위해 여기서 선언
  const satelliteLinks = useMemo(() =>
    satInfosRef.current.map((s) => ({ source: s.parentId, target: s.bubble.id })),
  [flowNodes]); // flowNodes 변경 시 갱신 (satInfosRef.current는 viewData effect에서 업데이트)

  const { onSatelliteDrag, onSatelliteDragStop, pauseAndReset, wake } = usePhysicsLayout(flowNodes, setFlowNodes, satelliteLinks, flushPositionsFetch, false);

  // §5.4 #29 v1.51 — 캔버스 클립보드 (Ctrl/Cmd+C / Ctrl/Cmd+V)
  const { t } = useTranslation();
  const [canvasToast, setCanvasToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null);
  useEffect(() => {
    if (!canvasToast) return;
    const tid = setTimeout(() => setCanvasToast(null), 2200);
    return () => clearTimeout(tid);
  }, [canvasToast]);
  const clipboardMessages = useMemo(() => ({
    copySuccess: (count: number) => t('canvas.copy.success', { count, defaultValue: 'Copied {{count}} item(s)' }),
    copyEmpty: t('canvas.copy.empty', { defaultValue: 'Nothing selected to copy' }),
    pasteSuccess: (count: number) => t('canvas.paste.success', { count, defaultValue: 'Pasted {{count}} item(s)' }),
    pasteEmpty: t('canvas.paste.empty', { defaultValue: 'Clipboard is empty' }),
    pasteFailed: t('canvas.paste.failed', { defaultValue: 'Paste failed' }),
    pasteInvalidVersion: t('canvas.paste.invalidVersion', { defaultValue: 'Clipboard format incompatible' }),
  }), [t]);
  useCanvasClipboard({
    rfRef,
    rfContainerRef,
    flowNodesRef,
    flowEdgesRef,
    activeProject,
    currentFolderId,
    onToast: useCallback((msg: string, kind: 'success' | 'error') => {
      setCanvasToast({ msg, kind });
    }, []),
    messages: clipboardMessages,
  });

  // 폴더 내부 뷰 데이터 (currentFolderId가 null이면 빈 결과)
  const folderChildren = useMemo<BubbleData[]>(() => {
    return currentFolderId ? storeChildren[currentFolderId] ?? [] : [];
  }, [storeChildren, currentFolderId]);
  const folderInnerEdges = useMemo(() => (currentFolderId ? storeInnerEdges[currentFolderId] ?? [] : []), [storeInnerEdges, currentFolderId]);

  const nodeMap = useGraphStore((s) => s.nodeMap);
  const currentFolderData = useMemo<BubbleData | undefined>(() => {
    return currentFolderId ? nodeMap[currentFolderId] : undefined;
  }, [currentFolderId, nodeMap]);

  const folderViewData = useFolderLayout({
    folderId: currentFolderId ?? '',
    folderData: currentFolderData,
    agents,
    children: folderChildren,
    innerEdges: folderInnerEdges,
    // worktree 드릴다운에서 이주 에이전트의 read/edit 엣지를 메인처럼 렌더 (§5.7 #26).
    agentEdges: filteredEdges,
    satellites: storeSatellites,
    satellitePositions,
  });

  // §5.3 #28 v1.47 — customMode='conti' 인 에이전트마다 conti 버블 위성 합성.
  // 단일 클릭 = 선택 → DetailPanel 의 ContiHistoryDetail 분기 (id prefix=conti-bubble-).
  // 더블 클릭 = 가장 최근 conti 의 ContiBoardPanel 오픈 (handleNodeDoubleClick 분기).
  const storeContis = useGraphStore((s) => s.contis);
  const storeAgentConfigs = useGraphStore((s) => s.agentConfigs);
  const contiSatellites = useMemo<Record<string, BubbleData[]>>(() => {
    const out: Record<string, BubbleData[]> = {};
    for (const agent of agents) {
      // §5.3 #28 v1.47 — 콘티 위성은 사용자가 직접 만든 커스텀 에이전트(`customCreated`) 한정.
      // Hook 에이전트(VSCode 자동 생성)에는 customMode 부착 ❌ (서버에서도 가드).
      if (!agent.customCreated) continue;
      const cfg = storeAgentConfigs[agent.id];
      if (cfg?.customMode !== 'conti') continue;
      const owned = Object.values(storeContis).filter((c) => c.agentId === agent.id);
      const latest = owned.sort((a, b) => b.createdAt - a.createdAt)[0];
      const contiBubble: BubbleData = {
        id: `conti-bubble-${agent.id}`,
        label: latest ? `Conti · ${owned.length}` : 'Conti',
        bubbleType: 'conti',
        path: `__conti__:${agent.id}`,
        status: 'idle',
        activity: owned.length,
      };
      out[agent.id] = [contiBubble];
    }
    return out;
  }, [agents, storeAgentConfigs, storeContis]);

  // storeSatellites + contiSatellites 합치기 (parent agent.id 가 키, 에이전트당 1개 conti 추가)
  const mergedSatellites = useMemo<Record<string, BubbleData[]>>(() => {
    if (Object.keys(contiSatellites).length === 0) return storeSatellites;
    const out: Record<string, BubbleData[]> = { ...storeSatellites };
    for (const [agentId, list] of Object.entries(contiSatellites)) {
      out[agentId] = [...(out[agentId] ?? []), ...list];
    }
    return out;
  }, [storeSatellites, contiSatellites]);

  // 메인 뷰 데이터
  const mainViewData = useBubbleLayout({
    agents,
    folders: filteredFolders,
    edges: filteredEdges,
    satellites: mergedSatellites,
    satellitePositions,
  });

  // 파이프라인 내부 뷰 데이터
  const storePipelines = useGraphStore((s) => s.pipelines);
  const storePipelineChildren = useGraphStore((s) => s.pipelineChildren);
  const isPipelineView = currentFolderId !== null && !!storePipelines[currentFolderId];
  const pipelineViewData = usePipelineLayout({
    parentId: currentFolderId ?? '',
    parentData: currentFolderId ? nodeMap[currentFolderId] : undefined,
    pipelineChildren: isPipelineView ? (storePipelineChildren[currentFolderId!] ?? []) : [],
  });

  /** 뷰 데이터 선택 — 파이프라인 내부 vs 폴더 내부 vs 메인 */
  const viewData = currentFolderId !== null
    ? (isPipelineView ? pipelineViewData : folderViewData)
    : mainViewData;

  /**
   * 같은 두 에이전트 사이 평행 엣지(양방향·다중)가 겹치지 않도록 parallelOffset 할당.
   * 메인 sync 와 angular offset 계산이 공유하도록 memo 로 올린다.
   */
  const parallelOffsetById = useMemo<Map<string, number>>(() => {
    if (currentFolderId !== null) return new Map();
    return computeParallelOffsets(Object.values(storeTaskEdges));
  }, [storeTaskEdges, currentFolderId]);

  /**
   * 타겟 원둘레 각도 분산 (edgeId → radians). 메인 뷰에서만 계산.
   * within-pair parallel 기반 부호 + cross-pair cluster 기반 합산. 소스 endpoint 는 자연 각도 고정.
   */
  const angularOffsetById = useMemo<Map<string, number>>(() => {
    if (currentFolderId !== null) return new Map();
    return computeAngularOffsets(Object.values(storeTaskEdges), flowNodes, parallelOffsetById);
  }, [flowNodes, storeTaskEdges, currentFolderId, parallelOffsetById]);

  /**
   * popup preview 엣지 offset — "이 엣지가 이미 존재한다고 가정" 하고 실엣지들과 함께
   * 오프셋을 다시 계산한 뒤 synthetic edge 몫만 뽑는다. 실엣지 오프셋은 그대로 유지하므로
   * 미리보기만 살짝 비키는 형태가 되고, Connect 시점 재계산에서 자연스럽게 자리 잡는다.
   */
  const PREVIEW_EDGE_ID = '__preview__';
  const previewOffsets = useMemo(() => {
    if (!taskEdgePopup) return null;
    const synthetic = {
      id: PREVIEW_EDGE_ID,
      sourceAgentId: taskEdgePopup.sourceAgentId,
      targetAgentId: taskEdgePopup.targetAgentId,
    };
    const combined = [...Object.values(storeTaskEdges), synthetic];
    const parallel = computeParallelOffsets(combined);
    const angular = computeAngularOffsets(combined, flowNodes, parallel);
    return {
      parallelOffset: parallel.get(PREVIEW_EDGE_ID) ?? 0,
      targetAngularOffset: angular.get(PREVIEW_EDGE_ID) ?? 0,
    };
  }, [taskEdgePopup, storeTaskEdges, flowNodes]);

  // 노드/엣지 동기화 + 뷰 전환 캐시 (하나의 이펙트로 순서 보장)
  useEffect(() => {
    // 데이터 없음 → 캔버스 비우기
    if (viewData.bubbles.length === 0) {
      setFlowNodes([]);
      setEdges([]);
      return;
    }

    // ── 프로젝트 전환 감지 (메인 sync 내부 → 위치 결정 전 초기화 보장, 새로고침과 동일 동작) ──
    const prevProject = prevProjectRef.current;
    const projectChanged = prevProject !== null && prevProject !== activeProject;
    if (prevProject !== activeProject) prevProjectRef.current = activeProject;

    if (projectChanged) {
      pauseAndReset();
      viewCacheRef.current.clear();
      positionsRef.current.clear();
    }

    const prev = prevFolderRef.current;
    const next = currentFolderId;
    const viewChanged = prev !== next || projectChanged;
    prevFolderRef.current = next;

    const cache = viewCacheRef.current;

    if (viewChanged) {
      // 0) 물리 엔진 일시 정지 + 바디 리셋 (프로젝트 전환 시 이미 호출됨)
      if (!projectChanged) pauseAndReset();

      // 1) 이전 뷰 상태 저장 (프로젝트 전환 시 캐시 초기화 완료 → 스킵)
      if (!projectChanged && rfRef.current) {
        const livePositions = new Map<string, XYPosition>();
        for (const node of flowNodes) {
          livePositions.set(node.id, node.position);
        }
        cache.set(prev ?? '__main__', {
          viewport: rfRef.current.getViewport(),
          positions: livePositions,
        });
      }

      // 2) 다음 뷰 캐시 복원
      const saved = cache.get(next ?? '__main__');
      if (saved) {
        positionsRef.current = new Map(saved.positions);
      } else {
        positionsRef.current.clear();
      }

      // 3) 전체 버블 중심으로 화면 정렬 (캐시 있어도 1프레임 뒤 fitView)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!rfRef.current) return;
          if (saved) {
            rfRef.current.setViewport(saved.viewport, { duration: 0 });
          } else {
            rfRef.current.fitView({ duration: 0, padding: 0.25 });
          }
        });
      });

      // 4) 장면 전환 애니메이션 (프로젝트 전환은 새로고침처럼 즉시 전환)
      if (!projectChanged) {
        const direction = next !== null && (prev === null || next !== prev) ? 'zoom-in' : 'zoom-out';
        setTransition(direction);
        setTimeout(() => setTransition('none'), 250);
      }
    }

    // 5) 위치 결정 — 새 노드만 초기 위치 배정 (기존 노드는 현재 위치 유지)
    //    우선순위: 로컬 캐시(positionsRef) > 서버 저장 위치(BubbleData.position) > pinned 계산 > 방사형 레이아웃
    const layout = viewData.layout;
    const ids = new Set(viewData.bubbles.map((b) => b.id));
    for (const id of positionsRef.current.keys()) {
      if (!ids.has(id)) positionsRef.current.delete(id);
    }

    // 실시간 업데이트 시, 현재 렌더된 노드 위치를 positionsRef에 반영 (물리 엔진/드래그 위치 보존)
    if (!viewChanged) {
      for (const node of flowNodes) {
        positionsRef.current.set(node.id, node.position);
      }
    }

    for (const b of viewData.bubbles) {
      if (b.id.startsWith('sat-')) continue;
      // positionsRef에 이미 있으면 유지 (위에서 현재 렌더 위치가 들어감)
      if (positionsRef.current.has(b.id)) continue;

      // 새 노드: 서버 저장 위치 → pinned 계산 → 방사형 레이아웃
      const saved = (b as BubbleData).position;
      const validSaved = saved && (saved.x !== 0 || saved.y !== 0) ? saved : undefined;
      let pos: XYPosition | undefined;
      if (validSaved) {
        pos = validSaved;
      } else if ((b as BubbleData).pinned) {
        const root = viewData.bubbles.find((r) => (r as BubbleData).bubbleType === 'root');
        const rootPos = root ? (positionsRef.current.get(root.id) ?? layout.get(root.id)) : undefined;
        const rootNode = root ? flowNodesRef.current.find((n) => n.id === root.id) : undefined;
        const rw = rootNode?.measured?.width ?? 100;
        const rh = rootNode?.measured?.height ?? 100;
        const anchor = rootPos ? { x: rootPos.x + rw / 2, y: rootPos.y + rh / 2 } : { x: 0, y: 0 };
        const occupiedCenters = new Map<string, XYPosition>();
        for (const fn of flowNodesRef.current) {
          const p = positionsRef.current.get(fn.id);
          if (!p) continue;
          const fw = fn.measured?.width ?? 80;
          const fh = fn.measured?.height ?? 80;
          occupiedCenters.set(fn.id, { x: p.x + fw / 2, y: p.y + fh / 2 });
        }
        const center = findNonCollidingPosition(anchor, occupiedCenters);
        const bNode = flowNodesRef.current.find((n) => n.id === b.id);
        const bw = bNode?.measured?.width ?? 80;
        const bh = bNode?.measured?.height ?? 80;
        pos = { x: center.x - bw / 2, y: center.y - bh / 2 };
      } else {
        pos = layout.get(b.id);
      }
      if (pos) positionsRef.current.set(b.id, pos);
    }

    // 7) 위성 위치 — positionsRef의 실제 폴더 위치 기준으로 계산 (캐시에 있으면 스킵)
    if (viewData.satInfos) {
      satInfosRef.current = viewData.satInfos;
      placeSatellitePositions(viewData.satInfos, positionsRef.current);
    }

    // 8) 노드 업데이트 — positionsRef 기반으로 위치 결정 (서버 위치 우선)
    if (viewChanged) {
      setFlowNodes(toFlowNodes(viewData.bubbles, positionsRef.current, layout));
    } else {
      setFlowNodes((prevNodes) => {
        const prevMap = new Map(prevNodes.map((n) => [n.id, n]));
        const nextIds = new Set(viewData.bubbles.map((b) => b.id));

        // 사라지는 노드 → data에 _despawning 플래그 (BubbleNode 내부에서 애니메이션)
        const despawning: Node[] = [];
        for (const prev of prevNodes) {
          if (!nextIds.has(prev.id)) {
            const alreadyDespawning = (prev.data as Record<string, unknown>)._despawning;
            if (alreadyDespawning) {
              despawning.push(prev);
            } else {
              despawning.push({ ...prev, data: { ...prev.data, _despawning: true } });
            }
          }
        }

        const nextNodes = viewData.bubbles.map((b) => {
          const existing = prevMap.get(b.id);
          if (existing) {
            const pos = positionsRef.current.get(b.id) ?? existing.position;
            const data = b.id.startsWith('sat-')
              ? { ...b, position: pos }
              : { ...b };
            return { ...existing, position: pos, data };
          }
          const pos = positionsRef.current.get(b.id) ?? layout.get(b.id) ?? (b as BubbleData).position ?? { x: 0, y: 0 };
          return {
            id: b.id,
            type: 'bubble' as const,
            position: pos,
            dragHandle: '.bubble-body',
            data: b.id.startsWith('sat-') ? { ...b, position: pos } : { ...b },
          };
        });

        // despawn 노드가 있으면 250ms 후 제거
        if (despawning.length > 0) {
          setTimeout(() => {
            setFlowNodes((cur) => cur.filter((n) => !(n.data as Record<string, unknown>)._despawning));
          }, 250);
        }

        return [...nextNodes, ...despawning];
      });
    }

    // Task Edge → React Flow Edge 변환 (메인 뷰에서만 표시)
    // sourceRadius/targetRadius를 넣어야 TaskEdgeComponent가 원 둘레 교차점을 정확히 계산
    const agentRadiusById = new Map<string, number>();
    for (const b of viewData.bubbles) {
      if (b.bubbleType === 'agent') agentRadiusById.set(b.id, calcBubbleSize(b) / 2);
    }
    const taskFlowEdges: Edge[] = currentFolderId === null
      ? Object.values(storeTaskEdges).map((te) => {
        // 편집 프리뷰 합성 — 팝업에서 바꾸는 중인 필드가 있으면 캔버스 엣지에도 즉시 반영.
        const preview = taskEdgePreview && taskEdgePreview.edgeId === te.id ? taskEdgePreview.overrides : null;
        const merged = preview ? { ...te, ...preview } : te;
        return {
          id: `task-${te.id}`,
          source: te.sourceAgentId,
          target: te.targetAgentId,
          type: 'taskEdge',
          data: {
            taskEdgeId: te.id,
            status: merged.status,
            command: merged.command,
            kind: merged.kind,
            bundleId: te.bundleId,
            bundleRole: te.bundleRole,
            sourceRadius: agentRadiusById.get(te.sourceAgentId),
            targetRadius: agentRadiusById.get(te.targetAgentId),
            parallelOffset: parallelOffsetById.get(te.id) ?? 0,
            targetAngularOffset: angularOffsetById.get(te.id) ?? 0,
          },
          animated: false, // v1.33 — status 기반 시각 전이 OFF. 엣지 애니메이션 고정 비활성.
          focusable: true,
          interactionWidth: 15,
        };
      })
      : [];

    setEdges([...viewData.flowEdges, ...taskFlowEdges]);
  }, [viewData, currentFolderId, satellitePositions, setFlowNodes, setEdges, activeProject, pauseAndReset, storeTaskEdges, angularOffsetById, parallelOffsetById, taskEdgePreview]);

  // 위치 이동(드래그/물리 엔진)으로 angular offset 이 바뀌었을 때, 메인 sync 가 재실행되지 않아도
  // 기존 Task Edge 의 data.targetAngularOffset 만 패치 — 화살촉 분산이 실시간으로 따라간다.
  useEffect(() => {
    if (currentFolderId !== null) return;
    setEdges((cur) => {
      let changed = false;
      const next = cur.map((e) => {
        if (e.type !== 'taskEdge') return e;
        const rec = e.data as Record<string, unknown> | undefined;
        const teId = typeof rec?.['taskEdgeId'] === 'string' ? (rec['taskEdgeId'] as string) : undefined;
        if (!teId) return e;
        const newOff = angularOffsetById.get(teId) ?? 0;
        const oldOff = typeof rec?.['targetAngularOffset'] === 'number' ? (rec['targetAngularOffset'] as number) : 0;
        if (newOff === oldOff) return e;
        changed = true;
        return { ...e, data: { ...(e.data as object), targetAngularOffset: newOff } };
      });
      return changed ? next : cur;
    });
  }, [angularOffsetById, currentFolderId, setEdges]);

  // 프로젝트 전환 로직은 메인 sync effect 내부로 통합됨 (위치 결정 전 초기화 보장)

  const handleNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    const data = node.data as unknown as BubbleData;
    const store = useGraphStore.getState();
    if (data.id === '__root_back__') { store.goBack(); return; }
    if (data.id === '__root_home__') {
      store.goToMain();
      return;
    }
    if (data.id === '__pipeline_parent__') { store.goBack(); return; }
    if (data.bubbleType === 'internal_folder' || data.bubbleType === 'external_folder' || data.bubbleType === 'worktree') {
      store.enterFolder(data.id);
      return;
    }
    // 파이프라인 버블 더블클릭 → 내부 진입
    if (data.bubbleType === 'pipeline') {
      store.enterFolder(data.id);
      return;
    }
    // Hook 부모 에이전트 더블클릭 → 내부 진입 (비활성화: 플랫 캔버스 유지)
    // if (data.bubbleType === 'agent' && data.isParentAgent) {
    //   store.enterFolder(data.id);
    //   return;
    // }
    // §5.3 #28 v1.47 — 콘티 버블 더블클릭 → 가장 최근 콘티의 보드 오픈
    if (data.bubbleType === 'conti') {
      const agentId = data.path.startsWith('__conti__:') ? data.path.slice('__conti__:'.length) : null;
      if (!agentId) return;
      const owned = Object.values(useGraphStore.getState().contis)
        .filter((c) => c.agentId === agentId)
        .sort((a, b) => b.createdAt - a.createdAt);
      const latest = owned[0];
      if (latest) {
        useGraphStore.getState().openContiBoard(agentId, latest.id);
      }
      return;
    }
    // 에이전트 더블클릭 → IDE 오버레이 (Hook=read-only, Custom=interactive)
    if (data.bubbleType === 'agent') {
      useGraphStore.getState().openIDEOverlay(data.id);
      return;
    }
    // iframe 더블클릭 → 탭 열기
    if (data.bubbleType === 'iframe' && data.url) {
      store.openIframeTab({
        id: data.id,
        url: data.url,
        label: data.label,
        serverKind: data.serverKind ?? 'backend',
      });
      return;
    }
    // 위성 파일 더블클릭 → 파일이 있는 폴더 내부로 진입
    if (node.id.startsWith('sat-')) {
      const filePath = data.path;
      const parentPath = filePath.substring(0, filePath.lastIndexOf('/'));
      if (!parentPath) return;

      // children 전체에서 해당 경로의 폴더 찾기
      const { children: allChildren, topFolders: tops } = useGraphStore.getState();
      for (const items of Object.values(allChildren)) {
        const folder = items.find((f) => f.path === parentPath);
        if (folder) {
          store.enterFolderDeep(folder.id);
          return;
        }
      }
      const topMatch = tops.find((f) => f.path === parentPath);
      if (topMatch) {
        store.enterFolderDeep(topMatch.id);
      }
    }
  }, []);

  // 선택 + dismiss는 BubbleNode의 pointerDown에서 처리 (click보다 확실)

  /**
   * Comment Box 멤버십 단일 진실 함수.
   * 박스 하나의 정식 childNodeIds 를 "공간 포함 + 부모 규칙" 으로 한 번에 계산하고
   * 변경이 있을 때만 PATCH. 박스 자식이 바뀔 수 있는 모든 시점(박스 드래그/리사이즈,
   * 일반 버블 드래그, 박스 생성)에서 이 함수만 호출하면 된다.
   *
   * 규칙:
   *  (a) 후보 = 영역 안에 들어와 있는 비-코멘트박스 노드 전부.
   *  (b) 부모 규칙 — 위성(file/bash/ghost/iframe 으로 store.satellites 에 들어있는 것)은
   *      부모(에이전트/폴더) 가 함께 후보에 들어 있을 때만 자식. 부모 없는 위성은 제거.
   *
   * PATCH payload 에 x/y/width/height 도 같이 실어 idempotent 하게 — 박스 드롭 직후
   * 다른 PATCH 와 순서가 뒤바뀌어도 서버 최종 상태가 항상 일치(=박스 튐 제거).
   */
  const recomputeBoxMembership = useCallback((boxId: string) => {
    const store = useGraphStore.getState();
    const box = store.commentBoxes.find((b) => b.id === boxId);
    if (!box) return;
    const m = COMMENT_BOX_DEFAULTS.MEMBERSHIP_MARGIN;
    const isInside = (nx: number, ny: number, w: number, h: number): boolean => {
      const cx = nx + w / 2;
      const cy = ny + h / 2;
      return (
        cx >= box.x + m &&
        cy >= box.y + m &&
        cx <= box.x + box.width - m &&
        cy <= box.y + box.height - m
      );
    };

    // 위성 → 부모 역색인 — store.satellites + 현재 뷰의 satInfosRef 합쳐 빌드.
    const parentByChildId = new Map<string, string>();
    for (const [parentId, sats] of Object.entries(store.satellites)) {
      for (const sat of sats) parentByChildId.set(sat.id, parentId);
    }
    for (const info of satInfosRef.current) parentByChildId.set(info.bubble.id, info.parentId);

    // (a) 영역 안에 들어와 있는 비-코멘트박스 노드 전부 후보 수집.
    const spatialInside = new Set<string>();
    const bubbleTypeById = new Map<string, BubbleType>();
    for (const n of flowNodesRef.current) {
      if (n.type === 'commentBox') continue;
      const w = n.measured?.width ?? (n.width ?? 80);
      const h = n.measured?.height ?? (n.height ?? 80);
      const bt = (n.data as unknown as BubbleData | undefined)?.bubbleType;
      if (bt) bubbleTypeById.set(n.id, bt);
      if (isInside(n.position.x, n.position.y, w, h)) spatialInside.add(n.id);
    }

    // (b) 부모 규칙 — 위성은 부모가 같은 후보 집합에 있을 때만 통과.
    //     parentByChildId 에 없어도 bubbleType 이 SATELLITE_TYPES 면 보수적 orphan 처리.
    const finalChildNodeIds: string[] = [];
    for (const id of spatialInside) {
      const pid = parentByChildId.get(id);
      if (pid) {
        if (!spatialInside.has(pid)) continue; // 위성: 부모가 박스 안에 없음 → 제외
      } else {
        const bt = bubbleTypeById.get(id);
        if (bt && SATELLITE_TYPES.has(bt)) continue; // 위성 타입인데 부모 매핑 없음 → 제외
      }
      finalChildNodeIds.push(id);
    }

    // 변경 없으면 PATCH 스킵 (순서 무관 비교)
    const prev = box.childNodeIds;
    const finalSet = new Set(finalChildNodeIds);
    const prevSet = new Set(prev);
    const removed: string[] = prev.filter((id) => !finalSet.has(id));
    const noChange = prev.length === finalChildNodeIds.length
      && finalChildNodeIds.every((id) => prevSet.has(id));

    // 박스에서 빠지는 위성은 부모 옆 궤도 위치로 텔레포트 — 단, 부모도 함께 빠진 경우만.
    // 사용자가 위성만 박스 밖으로 직접 끌어낸 경우엔 사용자가 놓은 위치 존중(텔레포트 ❌).
    // 부모가 박스를 떠나 위성이 고아가 된 경우, 박스 안에 갇혀 있던 위성이 부모 옆으로
    // 자연스럽게 따라가도록 위치 보정. 물리 엔진(스프링)이 이어서 궤도 안정화.
    const teleports: { id: string; x: number; y: number }[] = [];
    if (removed.length > 0) {
      for (const id of removed) {
        const pid = parentByChildId.get(id);
        if (!pid) continue; // 위성 매핑 없음 → 스킵
        // 부모가 여전히 박스 멤버면 사용자가 위성만 빼낸 케이스 → 텔레포트 ❌
        if (finalSet.has(pid)) continue;
        const parentNode = flowNodesRef.current.find((n) => n.id === pid);
        const satNode = flowNodesRef.current.find((n) => n.id === id);
        if (!parentNode || !satNode) continue;
        const pw = parentNode.measured?.width ?? (parentNode.width ?? 80);
        const ph = parentNode.measured?.height ?? (parentNode.height ?? 80);
        const sw = satNode.measured?.width ?? (satNode.width ?? 30);
        const sh = satNode.measured?.height ?? (satNode.height ?? 30);
        const angle = Math.random() * Math.PI * 2;
        const orbit = (pw / 2) + (sw / 2) + 24;
        const cxParent = parentNode.position.x + pw / 2;
        const cyParent = parentNode.position.y + ph / 2;
        const newX = cxParent + Math.cos(angle) * orbit - sw / 2;
        const newY = cyParent + Math.sin(angle) * orbit - sh / 2;
        teleports.push({ id, x: newX, y: newY });
      }
    }

    if (teleports.length > 0) {
      setFlowNodes((cur) => cur.map((n) => {
        const t = teleports.find((x) => x.id === n.id);
        if (!t) return n;
        positionsRef.current.set(n.id, { x: t.x, y: t.y });
        // 물리 엔진이 새 위치를 인식하도록 위성 body 도 깨움 — onSatelliteDrag 후 즉시 dragStop
        // 으로 dragging 플래그를 풀고, 부모 스프링이 다음 tick 부터 자연 궤도로 잡아당기게.
        onSatelliteDrag(n.id, t.x, t.y);
        onSatelliteDragStop(n.id);
        return { ...n, position: { x: t.x, y: t.y } };
      }));
    }

    if (noChange) return;

    void store.updateCommentBox(boxId, {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      childNodeIds: finalChildNodeIds,
    });
  }, [setFlowNodes, onSatelliteDrag, onSatelliteDragStop]);

  /** 활성 프로젝트의 모든 Comment Box 멤버십을 일괄 재계산. */
  const recomputeAllBoxesInActiveProject = useCallback(() => {
    const store = useGraphStore.getState();
    for (const box of store.commentBoxes) {
      if (activeProject && box.projectName !== activeProject) continue;
      recomputeBoxMembership(box.id);
    }
  }, [activeProject, recomputeBoxMembership]);

  /**
   * 현재 다중 선택(React Flow native)된 버블들의 bounding box 로 Comment Box 생성.
   * 선택이 없거나 메인 뷰가 아니면 무시.
   */
  const createCommentBoxFromSelection = useCallback(() => {
    if (currentFolderId !== null) return; // 메인 뷰 전용
    if (!activeProject) return;
    const padding = COMMENT_BOX_DEFAULTS.PADDING;
    const selected = flowNodesRef.current.filter((n) => n.selected && n.type === 'bubble');
    let x: number, y: number, width: number, height: number;
    const childNodeIds: string[] = [];

    if (selected.length === 0) {
      // 선택 없음 → 화면 중앙에 기본 크기 박스
      if (!rfRef.current) return;
      const { width: vw, height: vh } = rfContainerRef.current?.getBoundingClientRect() ?? { width: 600, height: 400 };
      const center = rfRef.current.screenToFlowPosition({ x: vw / 2, y: vh / 2 });
      width = COMMENT_BOX_DEFAULTS.EMPTY_WIDTH;
      height = COMMENT_BOX_DEFAULTS.EMPTY_HEIGHT;
      x = center.x - width / 2;
      y = center.y - height / 2;
    } else {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of selected) {
        const w = n.measured?.width ?? (n.width ?? 80);
        const h = n.measured?.height ?? (n.height ?? 80);
        minX = Math.min(minX, n.position.x);
        minY = Math.min(minY, n.position.y);
        maxX = Math.max(maxX, n.position.x + w);
        maxY = Math.max(maxY, n.position.y + h);
        childNodeIds.push(n.id);
      }
      x = minX - padding;
      y = minY - padding - COMMENT_BOX_DEFAULTS.HEADER_HEIGHT;
      width = Math.max(COMMENT_BOX_DEFAULTS.MIN_WIDTH, maxX - minX + padding * 2);
      height = Math.max(
        COMMENT_BOX_DEFAULTS.MIN_HEIGHT,
        maxY - minY + padding * 2 + COMMENT_BOX_DEFAULTS.HEADER_HEIGHT,
      );
    }

    // 박스는 우선 빈 자식 목록으로 생성. 생성 직후 단일 진실 함수(recomputeBoxMembership)
    // 가 공간 포함 + 부모 규칙으로 자식 목록을 채운다 — 다른 호출 지점과 동일한 규칙 1개.
    void (async () => {
      const created = await useGraphStore.getState().createCommentBox({
        projectName: activeProject,
        x, y, width, height,
        text: COMMENT_BOX_DEFAULTS.DEFAULT_TEXT,
        childNodeIds: [],
      });
      if (created) recomputeBoxMembership(created.id);
    })();
  }, [currentFolderId, activeProject, recomputeBoxMembership]);

  const handleNodeDragStart = useCallback((_: React.MouseEvent, node: Node) => {
    setCtxMenu(null);
    // Comment Box 드래그 시작 — 자식 노드 초기 위치 스냅샷 (동반 이동 계산용)
    if (node.type === 'commentBox') {
      const store = useGraphStore.getState();
      const box = store.commentBoxes.find((b) => b.id === node.id);
      if (!box) return;

      // 드래그 락 ON — WS snapshot 이 도중에 와도 박스 geometry 가 옛 값으로 덮어써지는 것 방지.
      store.setCommentBoxDragLock(node.id, true);

      // 드래그 직전 멤버십 정리 — orphan 위성(부모가 박스 멤버 아닌 위성) 은 함께 이동시키지 않는다.
      // store 의 box.childNodeIds 자체는 dragStop 의 recompute 가 정리. 여기선 이번 드래그 한정으로
      // 동반 이동 대상에서 제외.
      // 위성→부모 매핑은 store.satellites + 현재 뷰의 satInfosRef 를 모두 합쳐 빌드(둘 중
      // 하나에만 들어있는 경우 대비). bubbleType 가 SATELLITE_TYPES 인데 부모 매핑이 없는
      // 경우는 보수적으로 orphan 으로 간주해 movable 에서 제외(안전망).
      const parentByChildId = new Map<string, string>();
      for (const [pid, sats] of Object.entries(store.satellites)) {
        for (const s of sats) parentByChildId.set(s.id, pid);
      }
      for (const info of satInfosRef.current) parentByChildId.set(info.bubble.id, info.parentId);
      const childIdsSet = new Set(box.childNodeIds);
      const movableChildIds = box.childNodeIds.filter((cid) => {
        const pid = parentByChildId.get(cid);
        if (pid) return childIdsSet.has(pid); // 위성: 부모가 박스 멤버일 때만
        const node = flowNodesRef.current.find((n) => n.id === cid);
        const bt = (node?.data as unknown as BubbleData | undefined)?.bubbleType;
        if (bt && SATELLITE_TYPES.has(bt)) return false; // 위성 타입인데 부모 매핑 없음 → 제외
        return true; // 비위성 → 항상 movable
      });

      const snap = new Map<string, XYPosition>();
      // 시작 시 Comment 자체 위치
      snap.set(node.id, { x: node.position.x, y: node.position.y });
      for (const childId of movableChildIds) {
        const childNode = flowNodesRef.current.find((n) => n.id === childId);
        if (childNode) {
          snap.set(childId, { x: childNode.position.x, y: childNode.position.y });
          // 자식 물리 body 를 dragging 으로 마킹 → 자석 반발/바운드 클램프 등 물리 작용 OFF.
          // 안 그러면 코멘트는 자유 이동인데 자식만 매 tick 끌려가 그룹이 어긋남.
          onSatelliteDrag(childId, childNode.position.x, childNode.position.y);
        }
      }
      commentDragStartRef.current = { boxId: node.id, snapshot: snap };
    }
  }, [onSatelliteDrag]);

  const handleNodeDrag = useCallback((_: React.MouseEvent, node: Node) => {
    positionsRef.current.set(node.id, node.position);
    onSatelliteDrag(node.id, node.position.x, node.position.y);

    // Comment Box 드래그 중 — 자식 버블 동반 이동 (offset-only, parent/child 아님)
    if (node.type === 'commentBox' && commentDragStartRef.current?.boxId === node.id) {
      // (1) Comment Box 자체 위치를 store(commentBoxes) 에 직접 반영 → useMemo 가 새 position 을 prop 으로 흘려보내 React Flow 가 즉시 시각 갱신.
      useGraphStore.getState().patchCommentBoxLocal(node.id, { x: node.position.x, y: node.position.y });

      const start = commentDragStartRef.current.snapshot.get(node.id);
      if (!start) return;
      const dx = node.position.x - start.x;
      const dy = node.position.y - start.y;
      const startSnap = commentDragStartRef.current.snapshot;
      // (2) 자식 버블 동반 이동 — 이미 flowNodes 안에 있으므로 setFlowNodes 로 직접 갱신.
      //     동시에 onSatelliteDrag 로 물리 body 위치도 매 프레임 동기화 (dragging 마킹 유지).
      setFlowNodes((cur) => cur.map((n) => {
        if (n.id === node.id) return n;
        const s = startSnap.get(n.id);
        if (!s) return n;
        const nextPos = { x: s.x + dx, y: s.y + dy };
        positionsRef.current.set(n.id, nextPos);
        onSatelliteDrag(n.id, nextPos.x, nextPos.y);
        return { ...n, position: nextPos };
      }));
    }
  }, [onSatelliteDrag, setFlowNodes]);

  const handleNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
    onSatelliteDragStop(node.id);

    if (node.type === 'commentBox') {
      const store = useGraphStore.getState();
      const box = store.commentBoxes.find((b) => b.id === node.id);
      const dragStart = commentDragStartRef.current;
      const startCommentPos = dragStart?.snapshot.get(node.id);

      // (1) 자식 물리 body dragging 해제 — 다시 물리 엔진 관할
      if (box) {
        for (const childId of box.childNodeIds) onSatelliteDragStop(childId);
      }

      // (2) 코멘트 박스 바운드 클램프 — 사용자가 손 뗀 위치를 기준으로 안쪽으로 끌어 당김.
      //     자식 위치는 "드래그 시작 스냅샷 + (clamped - startComment)" 절대 계산으로
      //     산출 — 드래그 중간 상태나 누적 dx 의존성을 끊어 변위 2배 적용 같은 race 제거.
      const proj = store.activeProject;
      const bounds = proj ? store.layoutBoundsByProject[proj] : undefined;
      const hw = bounds?.hw ?? 1500;
      const hh = bounds?.hh ?? 1100;
      const minX = LAYOUT_CENTER_X - hw;
      const maxX = LAYOUT_CENTER_X + hw;
      const minY = LAYOUT_CENTER_Y - hh;
      const maxY = LAYOUT_CENTER_Y + hh;
      const w = node.measured?.width ?? (typeof node.width === 'number' ? node.width : COMMENT_BOX_DEFAULTS.EMPTY_WIDTH);
      const h = node.measured?.height ?? (typeof node.height === 'number' ? node.height : COMMENT_BOX_DEFAULTS.EMPTY_HEIGHT);
      let clampedX = node.position.x;
      let clampedY = node.position.y;
      if (clampedX < minX) clampedX = minX;
      else if (clampedX + w > maxX) clampedX = maxX - w;
      if (clampedY < minY) clampedY = minY;
      else if (clampedY + h > maxY) clampedY = maxY - h;

      // (3) 코멘트 + 자식 최종 위치를 한 번에 결정 — 절대 좌표 기반.
      store.patchCommentBoxLocal(node.id, { x: clampedX, y: clampedY });
      if (startCommentPos && box && box.childNodeIds.length > 0) {
        const totalDx = clampedX - startCommentPos.x;
        const totalDy = clampedY - startCommentPos.y;
        const childIds = new Set(box.childNodeIds);
        setFlowNodes((cur) => cur.map((n) => {
          if (!childIds.has(n.id)) return n;
          const sChild = dragStart!.snapshot.get(n.id);
          if (!sChild) return n;
          const nextPos = { x: sChild.x + totalDx, y: sChild.y + totalDy };
          positionsRef.current.set(n.id, nextPos);
          return { ...n, position: nextPos };
        }));
      }

      // (4) PATCH 서버 — 클램프된 최종 위치 저장. PATCH await 후 추가 버퍼(300ms)를 두고
      //     드래그 락 해제 → flushPositionsFetch / recomputeBoxMembership 가 발화한 별도
      //     PATCH 의 broadcast 가 늦게 도착해도 옛 코멘트 위치로 회귀하지 않음.
      void (async () => {
        await store.updateCommentBox(node.id, { x: clampedX, y: clampedY });
        setTimeout(() => store.setCommentBoxDragLock(node.id, false), 300);
      })();
      commentDragStartRef.current = null;
      // (5) 자식 멤버십 단일 진실 함수로 재계산 — 박스가 새 위치에서 덮은 버블을 자동 편입,
      //     영역 밖으로 빠진 자식은 자동 제외. 위성은 부모 동시 멤버 규칙 자동 적용.
      //     setFlowNodes commit 후 flowNodesRef 가 최신이도록 다음 프레임에 호출.
      requestAnimationFrame(() => recomputeBoxMembership(node.id));
    } else {
      // 일반 버블 드롭 → 활성 프로젝트의 모든 Comment Box 멤버십 재계산.
      // setFlowNodes commit 이 끝난 다음 프레임에 호출해야 flowNodesRef 가 최신 위치를 반영
      // (특히 방금 박스 밖으로 끌어낸 부모의 위치). 즉시 호출하면 stale position 으로 판정해
      // "부모도 안에 있음" 으로 잘못 판단 → 위성이 박스에 남는 버그 발생.
      requestAnimationFrame(() => recomputeAllBoxesInActiveProject());
    }

    // 드래그 놓는 순간 전체 노드 위치를 서버에 저장 (자식 위치 포함)
    flushPositionsFetch();
  }, [onSatelliteDragStop, flushPositionsFetch, recomputeAllBoxesInActiveProject, setFlowNodes, recomputeBoxMembership]);

  // ─── Comment Box 크기 변화 감지 → 멤버십 자동 재계산 ───
  // 리사이즈 시 새 크기 기준으로 자식 목록을 다시 계산. 차원(width/height) 만 디펜드 —
  // 위치(x/y)는 자식과 함께 이동하므로 영향 없음. 디바운스로 라이브 리사이즈 매 프레임
  // PATCH 폭주 방지.
  const commentDimsSig = useMemo(
    () => scopedCommentBoxes.map((b) => `${b.id}:${Math.round(b.width)}:${Math.round(b.height)}`).join('|'),
    [scopedCommentBoxes],
  );
  useEffect(() => {
    if (!commentDimsSig) return;
    const tid = setTimeout(() => {
      recomputeAllBoxesInActiveProject();
    }, 80);
    return () => clearTimeout(tid);
  }, [commentDimsSig, recomputeAllBoxesInActiveProject]);

  useEffect(() => {
    if (!pendingFocus || !rfRef.current) return;
    rfRef.current.fitView({ duration: 500, padding: 0.3 });
    useGraphStore.getState().clearFocus();
  }, [pendingFocus]);

  // 특정 버블로 공간 점프 — 렌더된 flowNodes에 존재할 때만 centering.
  // 뷰 전환(goToMain 등)이 선행되는 경우를 위해 flowNodes 변화도 watch.
  useEffect(() => {
    if (!focusNodeId || !rfRef.current) return;
    const target = flowNodes.find((n) => n.id === focusNodeId);
    if (!target) return;
    const w = target.measured?.width ?? (target.width ?? 0);
    const h = target.measured?.height ?? (target.height ?? 0);
    rfRef.current.setCenter(target.position.x + w / 2, target.position.y + h / 2, { duration: 500, zoom: 1 });
    useGraphStore.getState().clearFocusNode();
  }, [focusNodeId, flowNodes]);

  // Delete 키 → 선택된 버블/엣지/코멘트 삭제 (단일 + Shift-드래그 다중 선택 모두 지원)
  useEffect(() => {
    function handleDelete(e: KeyboardEvent): void {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      const state = useGraphStore.getState();

      // React Flow native 다중 선택 — flowNodes/flowEdges 의 selected:true 를 진실의 원천으로
      const selectedFlowNodes = flowNodesRef.current.filter((n) => n.selected);
      const selectedFlowEdges = flowEdgesRef.current.filter((ed) => ed.selected);

      // 다중(2개 이상) 선택이 있으면 일괄 삭제 경로
      if (selectedFlowNodes.length + selectedFlowEdges.length > 1) {
        // 1) Task 엣지 일괄 삭제
        for (const ed of selectedFlowEdges) {
          if (ed.type !== 'taskEdge') continue;
          const taskEdgeId = (ed.data as { taskEdgeId?: string } | undefined)?.taskEdgeId
            ?? (ed.id.startsWith('task-') ? ed.id.slice(5) : ed.id);
          state.deleteTaskEdge(taskEdgeId);
        }
        // 2) Comment Box 일괄 삭제
        for (const n of selectedFlowNodes) {
          if (n.type !== 'commentBox') continue;
          const boxId = (n.data as { commentBoxId?: string } | undefined)?.commentBoxId ?? n.id;
          void state.deleteCommentBox(boxId);
        }
        // 3) 버블 일괄 삭제 — root 는 보호, worktree 는 가드 다이얼로그가 있어 단건 처리만 가능하므로 스킵.
        //     개별 DELETE 를 N 번 쏘면 서버가 스냅샷을 N 번 브로드캐스트해 버블이 여러 번 나눠 사라진다.
        //     ID 를 모아 단일 batch 엔드포인트로 보내 한 번의 스냅샷으로 동시 제거한다.
        const bubbleIdsToDelete: string[] = [];
        for (const n of selectedFlowNodes) {
          if (n.type !== 'bubble') continue;
          const node = state.nodeMap[n.id];
          if (!node || node.bubbleType === 'root' || node.bubbleType === 'worktree') continue;
          bubbleIdsToDelete.push(n.id);
        }
        if (bubbleIdsToDelete.length > 0) {
          fetch('/api/bubbles/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: bubbleIdsToDelete }),
          }).catch(() => {});
        }
        // 단일 선택 store 도 정리 — 패널 잔존 방지
        state.selectNode(null);
        if (state.selectedCommentBoxId) state.selectCommentBox(null);
        if (state.selectedTaskEdgeId) state.selectTaskEdge(null);
        return;
      }

      // 단일 선택 경로 (기존 동작 유지)
      if (state.selectedCommentBoxId) {
        void state.deleteCommentBox(state.selectedCommentBoxId);
        return;
      }
      if (state.selectedTaskEdgeId) {
        state.deleteTaskEdge(state.selectedTaskEdgeId);
        state.selectTaskEdge(null);
        return;
      }
      // store 가 비어 있어도 React Flow 단일 선택(selected:true) 은 살아있을 수 있어 보강
      const fallbackNodeId = state.selectedNodeId
        ?? selectedFlowNodes.find((n) => n.type === 'bubble')?.id
        ?? null;
      if (!fallbackNodeId) return;
      const node = state.nodeMap[fallbackNodeId];
      if (node?.bubbleType === 'root') return;
      // worktree 버블은 merge 가드 + 폴더 삭제를 포함한 전용 흐름으로 분기 (SSOT §5.7 #26 v1.20)
      if (node?.bubbleType === 'worktree') {
        state.requestWorktreeDelete(fallbackNodeId, node.label);
        return;
      }
      fetch(`/api/bubble/${fallbackNodeId}`, { method: 'DELETE' }).catch(() => {});
      state.selectNode(null);
    }
    window.addEventListener('keydown', handleDelete);
    return () => window.removeEventListener('keydown', handleDelete);
  }, []);

  // v1.45 — C 키 → 현재 다중 선택된 버블들을 감싸는 Comment Box 생성 (언리얼 블프 스타일)
  useEffect(() => {
    function handleCreateComment(e: KeyboardEvent): void {
      if (e.code !== COMMENT_BOX_DEFAULTS.CREATE_HOTKEY) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      // 단독 C 만 받음 — 모디파이어 조합(Ctrl+C 복사 등) 회피
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      e.preventDefault();
      createCommentBoxFromSelection();
    }
    window.addEventListener('keydown', handleCreateComment);
    return () => window.removeEventListener('keydown', handleCreateComment);
  }, [createCommentBoxFromSelection]);

  // ~ 키 → 디버그 모드 토글
  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.key === '`' || e.key === '~') {
        useGraphStore.getState().toggleDebug();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);


  // 탭 전환 / 페이지 닫기: 언로드 시에도 전송 보장. navigator.sendBeacon 은 http(s) 에서만 동작하고
  // 패키지 앱(file:// 로 renderer 로드)에서는 "Beacons are only supported over HTTP(S)" 로 throw 한다.
  // → http(s) 일 때만 beacon, 그 외(file://)는 keepalive fetch 로 fallback(패키지 transport 가 가로채
  //   loopback 서버로 라우팅). 어떤 경우든 예외가 새어 나가 visibilitychange 핸들러를 깨지 않게 try.
  const flushPositionsBeacon = useCallback(() => {
    const body = buildPositionPayload();
    if (!body) return;
    const url = `/api/bubbles/positions`;
    try {
      if (location.protocol === 'http:' || location.protocol === 'https:') {
        navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
        return;
      }
    } catch { /* fall through to fetch */ }
    try {
      void fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {});
    } catch { /* noop */ }
  }, [buildPositionPayload]);

  useEffect(() => {
    const handleVisChange = (): void => { if (document.hidden) flushPositionsBeacon(); };
    const handleUnload = (): void => { flushPositionsBeacon(); };
    document.addEventListener('visibilitychange', handleVisChange);
    window.addEventListener('beforeunload', handleUnload);
    const timer = setInterval(flushPositionsFetch, POSITION_SAVE_INTERVAL);
    return () => {
      document.removeEventListener('visibilitychange', handleVisChange);
      window.removeEventListener('beforeunload', handleUnload);
      clearInterval(timer);
    };
  }, [flushPositionsFetch, flushPositionsBeacon]);

  return (
    <div
      ref={rfContainerRef}
      className={`h-full w-full bg-gray-950 ${transition !== 'none' ? `scene-${transition}` : ''}`}
      onContextMenu={handlePaneContextMenu}
    >
      <ReactFlow
        nodes={displayNodes} edges={edges}
        nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onNodeDoubleClick={handleNodeDoubleClick}
        nodeDragThreshold={5}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onPaneClick={handleCtxClose}
        onInit={(i) => { rfRef.current = i; }}
        defaultEdgeOptions={{ style: { stroke: EDGE_STYLE.inactiveColor, strokeWidth: EDGE_STYLE.inactiveWidth }, type: 'curved', focusable: false, interactionWidth: 0 }}
        minZoom={zoomCtrlHeld ? 0.1 : 0.5}
        maxZoom={zoomCtrlHeld ? 4 : 2}
        elevateNodesOnSelect={false}
        fitView proOptions={{ hideAttribution: true }}
        className="bg-gray-950"
      >
        <EdgeMask />
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1e293b" />
        {currentFolderId === null && <LayoutBoundsBox />}
        <CanvasControls />
        {debugMode && <DebugOverlay flowNodes={flowNodes} />}
        <DebugResizeRefresher flowNodes={flowNodes} debugMode={debugMode} />
      </ReactFlow>
      {ctxMenu && (
        <CanvasContextMenu
          x={ctxMenu.screenX}
          y={ctxMenu.screenY}
          canvasX={ctxMenu.canvasX}
          canvasY={ctxMenu.canvasY}
          onCreateCustomAgent={createCustomAgent}
          onCreateCmdAgent={createCmdAgent}
          onCreateAutoAgent={createAutoAgent}
          onCreatePipeline={createPipeline}
          onCreateWorktree={createWorktree}
          onClose={handleCtxClose}
        />
      )}
      {/* 드래그 프리뷰 — 스크린 좌표계 SVG 오버레이 (화살표 포함, 마우스 커서 추적) */}
      <TaskEdgeDragPreview rfRef={rfRef} rfContainerRef={rfContainerRef} flowNodes={flowNodes} />
      {/* §5.4 #29 v1.51 — 캔버스 클립보드 토스트 (Ctrl/Cmd+C / Ctrl/Cmd+V) */}
      {canvasToast && (
        <div
          className={`pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-md border px-3 py-1.5 text-xs font-medium shadow-lg ${
            canvasToast.kind === 'success'
              ? 'border-emerald-700 bg-emerald-900/80 text-emerald-200'
              : 'border-rose-700 bg-rose-900/80 text-rose-200'
          }`}
          role="status"
        >
          {canvasToast.msg}
        </div>
      )}
      {taskEdgePopup && (
        <>
          {/* popup 뒤에 source↔target 을 잇는 엣지 예시 — Connect 시 실제 엣지로 대체됨 */}
          <TaskEdgePopupPreview
            rfRef={rfRef}
            rfContainerRef={rfContainerRef}
            flowNodes={flowNodes}
            sourceId={taskEdgePopup.sourceAgentId}
            targetId={taskEdgePopup.targetAgentId}
            parallelOffset={previewOffsets?.parallelOffset ?? 0}
            targetAngularOffset={previewOffsets?.targetAngularOffset ?? 0}
          />
          <TaskEdgePopup
            sourceAgentId={taskEdgePopup.sourceAgentId}
            targetAgentId={taskEdgePopup.targetAgentId}
            screenX={taskEdgePopup.screenX}
            screenY={taskEdgePopup.screenY}
            onClose={() => setTaskEdgePopup(null)}
          />
        </>
      )}
      {taskEdgeEditPopup && storeTaskEdges[taskEdgeEditPopup.edgeId] && (
        <TaskEdgePopup
          editingEdgeId={taskEdgeEditPopup.edgeId}
          sourceAgentId={storeTaskEdges[taskEdgeEditPopup.edgeId]!.sourceAgentId}
          targetAgentId={storeTaskEdges[taskEdgeEditPopup.edgeId]!.targetAgentId}
          screenX={taskEdgeEditPopup.screenX}
          screenY={taskEdgeEditPopup.screenY}
          onClose={closeTaskEdgeEdit}
        />
      )}
      <AgentIDEOverlay />
      <ContiBoardPanel />
    </div>
  );
});

/**
 * 디버그 모드 토글 / 메인 캔버스 컨테이너 리사이즈 시 React Flow 내부 노드 측정치
 * (handleBounds) 가 stale 해져 Task Edge 가 엉뚱한 곳에서 출발하는 현상을 막기 위해,
 * 변화 후 한 프레임 기다렸다가 모든 agent 노드를 강제로 재측정시킨다.
 * useUpdateNodeInternals 는 ReactFlow context 내부에서만 호출 가능하므로 ReactFlow 의
 * 자식으로 마운트된다.
 */
function DebugResizeRefresher({ flowNodes, debugMode }: { flowNodes: Node[]; debugMode: boolean }): null {
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    const ids = flowNodes
      .filter((n) => (n.data as { bubbleType?: string }).bubbleType === 'agent')
      .map((n) => n.id);
    if (ids.length === 0) return;
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        updateNodeInternals(ids);
      });
    });
    return () => cancelAnimationFrame(raf1);
    // flowNodes 식별자는 의존성에서 제외 — debugMode 변화 에만 반응 (deps 의도적 축소)
  }, [debugMode, updateNodeInternals]);
  return null;
}
