import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ReactFlow,
  type Node,
  type NodeTypes,
  type ReactFlowInstance,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { BubbleData } from '@vibisual/shared';
import { WS_PATH } from '@vibisual/shared';
import { useGraphStore, selectIDEOverlay } from '../../stores/graphStore.js';
import { coerceIDEPaneHandoff } from '../../stores/idePaneHandoff.js';
import { useWebSocket } from '../../hooks/useWebSocket.js';
import { useOverlaySync } from '../../hooks/useOverlaySync.js';
import { BubbleNode } from '../BubbleMap/BubbleNode.js';
import { AgentIDEOverlay } from '../IDE/AgentIDEOverlay.js';
import { PermissionPromptStack } from '../PermissionPrompt/PermissionPromptStack.js';

// §17-6 v2.83 — 단일 버블 가운데 정렬 옵션(init + 창 리사이즈 재정렬에 동일 적용).
const FIT_VIEW_OPTS = { padding: 0.3, maxZoom: 1, minZoom: 0.4, duration: 0 } as const;

// SCENARIO.md §5.5 #17-6 (v2.73) — `#overlay=1&agentId=…&projectId=…` 해시로 뜬 오버레이 위젯 창의 shell.
//
// 핵심 요구: 이 버블은 **본체 캔버스의 버블과 전부 동일하게 동작**해야 한다(시각·더블클릭 IDE).
// 단 ① 엣지 연결과 ② DetailPanel 만 제외. 따라서 별도 단순 버블을 새로 그리지 않고, 실제 `BubbleNode`
// 를 단일 노드로 띄우는 미니 ReactFlow 를 쓴다(같은 컴포넌트라 코로나·컨텍스트 물결·배지가 100% 동일).
// `data._overlayMode=true` 로 테두리 Task Edge 연결만 끈다. DetailPanel 은 여기서
// 렌더하지 않아 자연 제외(선택 자체는 캔버스와 동일하게 동작).
// (v2.81) 버블 드래그만은 캔버스와 다르다 — in-window 노드 이동이 아니라 **OS 창째 이동**.
// 노드를 창 안에서 움직이면 280×320 창 경계에서 버블이 잘리기 때문(사용자 보고).
//
// 더블클릭 → openIDEOverlay → OverlayShell 이 그 신호로 창을 (버블 기준) 약간 작은 IDE 크기로 확대.

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${WS_PATH}`;
const nodeTypes: NodeTypes = { bubble: BubbleNode };

export interface OverlayShellProps {
  agentId: string;
  projectId: string;
  /**
   * (판올림 번호 발급 대기) **앱 밖으로 끌어내 만들어진 창** — 버블이 아니라 IDE 로 시작한다.
   * 창 크기는 main 이 이미 IDE 크기로 만들어 두므로 여기서 `expandSelf` 를 다시 부르지 않는다
   * (부르면 그 IDE 크기를 "접었을 때 돌아갈 버블 자리"로 잘못 기억한다).
   */
  initiallyExpanded?: boolean;
}

interface ParsedOverlayHash {
  agentId: string;
  projectId: string;
  initiallyExpanded: boolean;
}

/** main.tsx 가 부팅 시 호출 — `#overlay=1&agentId=…&projectId=…` 파싱. */
export function parseOverlayHash(hash: string): ParsedOverlayHash | null {
  if (!hash || hash.length < 2) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (params.get('overlay') !== '1') return null;
  const agentId = params.get('agentId');
  const projectId = params.get('projectId');
  if (!agentId || !projectId) return null;
  return { agentId, projectId, initiallyExpanded: params.get('expanded') === '1' };
}

export function OverlayShell({ agentId, projectId, initiallyExpanded = false }: OverlayShellProps): React.JSX.Element {
  const { t } = useTranslation();
  // 같은 in-process 서버에 IPC WS 로 연결 — 초기 snapshot + 이후 broadcast 수신.
  useWebSocket(WS_URL);
  useOverlaySync();

  const setActiveProjectLocal = useGraphStore((s) => s.setActiveProjectLocal);
  // 자기 창의 활성 프로젝트를 이 오버레이의 프로젝트로 고정 → selectIDEOverlay / openIDEOverlay 가 그 슬롯을 본다.
  useEffect(() => {
    setActiveProjectLocal(projectId);
  }, [projectId, setActiveProjectLocal]);

  const agent = useGraphStore((s) => s.nodeMap[agentId] as BubbleData | undefined);
  const openIDEOverlay = useGraphStore((s) => s.openIDEOverlay);

  // IDE 오버레이가 이 창에서 열렸는지 — 열리면 expanded.
  const ideAgentId = useGraphStore((s) => selectIDEOverlay(s).agentId);
  const expanded = ideAgentId !== null;

  // 단일 노드(실제 BubbleNode) — 드래그 위치는 유지하고 라이브 데이터(상태·컨텍스트 등)만 갱신.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  useEffect(() => {
    if (!agent) {
      setNodes((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const data = { ...agent, _overlayMode: true } as BubbleData & Record<string, unknown>;
    setNodes((prev) => {
      const existing = prev.find((n) => n.id === agentId);
      if (existing) return prev.map((n) => (n.id === agentId ? { ...n, data } : n));
      return [{
        id: agentId,
        type: 'bubble',
        position: { x: 0, y: 0 },
        // §17-6 v2.81 — in-window 노드 드래그 금지(창 경계에서 버블이 잘리던 원인).
        // 노드는 창 중앙 고정, 드래그는 handleBubbleMouseDown 이 OS 창째 이동으로 처리.
        draggable: false,
        data,
      }];
    });
  }, [agent, agentId, setNodes]);

  // (판올림 번호 발급 대기) 끌어내서 만든 창 — 스냅샷이 도착해 버블을 알게 된 **그때** IDE 를 연다.
  //   더 일찍 열면 `nodeMap` 이 비어 IDE 가 null 을 돌려주고, 창은 잠깐 텅 빈 채로 뜬다.
  //
  // §5.5 #17-6 (H) — 앱 안에서 지고 온 **짐**이 있으면 그 상태로 연다(열어 둔 편집 탭·보던 뷰·
  //   고른 세션). 짐은 main 이 맡아 두고 있으며 **한 번 꺼내면 사라진다** — 없으면(직접 만든
  //   버블 창이거나 이미 꺼내 갔거나) 종전대로 첫 화면에서 시작한다.
  const popOutOpenedRef = useRef(false);
  useEffect(() => {
    if (!initiallyExpanded || popOutOpenedRef.current || !agent) return;
    popOutOpenedRef.current = true;
    const ov = window.api?.overlay;
    if (!ov?.takeHandoff) {
      openIDEOverlay(agentId);
      return;
    }
    void ov.takeHandoff(agentId).then((raw) => {
      openIDEOverlay(agentId, {
        // 독립 창은 붙은 변·창 안 좌표를 물려받지 않는다(창 자체가 IDE 라 앉을 변이 없다).
        //   그 값은 짐 안에 남아 되돌아갈 때 원래 자리로 복귀하는 데 쓰인다.
        handoff: coerceIDEPaneHandoff(raw),
        handoffTarget: 'detached',
      });
    });
  }, [initiallyExpanded, agent, agentId, openIDEOverlay]);

  // §5.5 #17-6 (H) — 이미 서 있던 창에 짐이 **뒤늦게** 도착하는 길(그 창은 부팅을 다시 하지 않아
  //   위 pull 이 돌지 않는다 — 꺼내 둔 창이 있는 채로 앱 안에서 또 꺼냈을 때).
  useEffect(() => {
    const ov = window.api?.overlay;
    if (!ov?.onPaneHandoff) return;
    const off = ov.onPaneHandoff((payload) => {
      if (payload.agentId !== agentId) return;
      const handoff = coerceIDEPaneHandoff(payload.handoff);
      if (!handoff) return;
      openIDEOverlay(agentId, { handoff, handoffTarget: 'detached' });
    });
    return () => { off(); };
  }, [agentId, openIDEOverlay]);

  const rfRef = useRef<ReactFlowInstance | null>(null);
  const handleInit = useCallback((inst: ReactFlowInstance) => {
    rfRef.current = inst;
    // 단일 버블을 자연 크기로 가운데 정렬.
    requestAnimationFrame(() => inst.fitView(FIT_VIEW_OPTS));
  }, []);

  // §17-6 v2.83 — IDE 펼침→접힘 후 버블이 한쪽으로 잘리던 버그 수정.
  // 종전엔 fitView 를 init 1회만 호출했다. 접힘 전이로 ReactFlow 가 재마운트되면 init 이 다시
  // 돌지만, OS 창 축소(collapseSelf→IPC→setBounds)가 비동기라 fitView 가 "아직 큰 IDE 크기"의
  // 뷰포트에 맞춰 버블을 중앙 배치 → 직후 창이 280×320 으로 줄면 버블이 한쪽으로 밀려 잘렸다.
  // 컨테이너 실제 리사이즈를 관찰해 매번 재정렬하면, OS 창이 어느 시점에 정착하든 버블이 가운데로 온다.
  const fitContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (expanded) return; // 접힘(버블) 상태에서만 ReactFlow 가 마운트된다.
    const el = fitContainerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => rfRef.current?.fitView(FIT_VIEW_OPTS));
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [expanded, agent]);

  // 더블클릭 → IDE 펼치기(캔버스 handleNodeDoubleClick 의 agent 분기와 동일).
  const handleNodeDoubleClick = useCallback((_e: React.MouseEvent, node: Node) => {
    const d = node.data as unknown as BubbleData;
    if (d.bubbleType === 'agent') openIDEOverlay(d.id);
  }, [openIDEOverlay]);

  // §17-6 (G) v2.87 — 우클릭 → 커서 위치의 독립 팝업 창으로 메뉴를 띄운다(main 이 cursor 좌표 사용).
  // 종전엔 280×320 버블 창 안에 HTML 로 그려 ①커서 아래에 못 열리고 ②하단 항목이 창 밖으로 밀려
  // 클릭이 안 됐다. 좌표·렌더는 OverlayMenuShell + windowManager 가 담당.
  const handleContextMenu = useCallback((e: React.MouseEvent | MouseEvent) => {
    e.preventDefault();
    void window.api?.overlay?.openMenu();
  }, []);

  // 메뉴 팝업 창의 "IDE 열기" 명령 수신 → 더블클릭과 동일 경로(openIDEOverlay)로 IDE 펼침.
  useEffect(() => {
    const overlay = window.api?.overlay;
    if (!overlay?.onMenuCommand) return;
    return overlay.onMenuCommand(({ command }) => {
      if (command === 'open-ide') openIDEOverlay(agentId);
    });
  }, [agentId, openIDEOverlay]);

  // §17-6 v2.81 — 버블 드래그 = OS 창 이동. 종전 in-window 노드 드래그는 280×320 창 경계를
  // 넘는 순간 버블이 잘렸다. .bubble-body 를 잡으면 메인 프로세스가 커서를 폴링해 창째
  // 따라가게(drag-start) 하고 window mouseup 에서 해제(drag-end) — 커서가 안 움직이면 창도
  // 안 움직여 클릭 선택·더블클릭 펼침 판정은 그대로다. 창이 통째로 움직이므로 모니터·앱
  // 경계 어디를 넘어도 잘리지 않는다.
  const handleBubbleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (!target.closest('.bubble-body')) return;
    const overlay = window.api?.overlay;
    if (!overlay?.dragStart) return;
    void overlay.dragStart();
    const end = (): void => {
      window.removeEventListener('mouseup', end);
      void overlay.dragEnd();
    };
    window.addEventListener('mouseup', end);
  }, []);

  // §17-6 (H-4) ⑥ — 이 창이 **커서에 매달려 있는 동안**에는 뗌을 여기서도 듣는다.
  //
  // 매다는 손짓은 두 곳에서 시작한다: 앱 안에서 끌어내는 순간(손은 메인 창에 있다)과 이 창의
  // 타이틀바를 잡는 순간(손은 여기 있다). 마우스 캡처가 어느 창에 있는지는 OS 가 정하므로,
  // 한쪽만 듣게 두면 놓치는 조합이 생긴다 — 그 대가가 "창이 영영 커서를 따라다닌다"라 크다.
  // 두 번 불려도 안전하다(이미 끝난 판은 main 이 조용히 지나간다).
  useEffect(() => {
    const ov = window.api?.overlay;
    if (!ov?.onFollowDragState) return;
    let armed = false;
    const onUp = (): void => {
      armed = false;
      window.removeEventListener('mouseup', onUp, true);
      void ov.dragEnd();
    };
    const off = ov.onFollowDragState(({ following }) => {
      if (following === armed) return;
      armed = following;
      if (following) window.addEventListener('mouseup', onUp, true);
      else window.removeEventListener('mouseup', onUp, true);
    });
    return () => {
      off();
      window.removeEventListener('mouseup', onUp, true);
    };
  }, []);

  // expanded 전이를 OS 창 크기 변경으로 미러. 초기(collapsed) 마운트에선 호출 ❌.
  //   ⚠ 끌어내서 만든 창은 main 이 이미 IDE 크기다 — 첫 전이를 미러하면 그 크기를 "버블로 돌아갈
  //     자리"로 기억해 접었을 때 창이 엉뚱한 곳에 앉는다. 그래서 시작값을 그 상태로 둔다.
  const prevExpandedRef = useRef(initiallyExpanded);
  useEffect(() => {
    if (prevExpandedRef.current === expanded) return;
    prevExpandedRef.current = expanded;
    const overlay = window.api?.overlay;
    if (!overlay) return;
    if (expanded) void overlay.expandSelf();
    else void overlay.collapseSelf();
  }, [expanded]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-transparent text-gray-100">
      {/* 접힘: 투명 위에 실제 BubbleNode 단일 노드. app-drag 영역(ReactFlow pane)을 잡고 OS 창 이동,
          버블 본체(.bubble-body)는 캔버스와 동일하게 드래그/클릭/더블클릭. */}
      {!expanded && (
        agent ? (
          // app-drag 를 컨테이너에 걸면 OS 가 창 이동용으로 마우스 이벤트를 가로채 버블 클릭/더블클릭이
          // 죽는다. 대신 index.css 의 `.overlay-window` 규칙이 빈 캔버스(.react-flow__pane)만 드래그
          // 영역으로, 버블(.react-flow__node)은 no-drag(상호작용 가능)로 분리한다.
          // 버블 자체 드래그는 mousedown 캡처 → OS 창 이동(v2.81, handleBubbleMouseDown).
          <div ref={fitContainerRef} className="h-full w-full" onMouseDownCapture={handleBubbleMouseDown}>
            <ReactFlow
              nodes={nodes}
              edges={[]}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onInit={handleInit}
              onNodeDoubleClick={handleNodeDoubleClick}
              onNodeContextMenu={(e) => handleContextMenu(e)}
              onPaneContextMenu={(e) => handleContextMenu(e)}
              nodesConnectable={false}
              elementsSelectable
              panOnDrag={false}
              panOnScroll={false}
              zoomOnScroll={false}
              zoomOnPinch={false}
              zoomOnDoubleClick={false}
              preventScrolling={false}
              proOptions={{ hideAttribution: true }}
              minZoom={0.4}
              maxZoom={1}
              style={{ background: 'transparent' }}
            />
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-transparent">
            <div className="app-drag flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-gray-900/85 px-4 py-3 text-center shadow-xl backdrop-blur-sm">
              <svg className="h-6 w-6 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
              <span className="text-[12px] text-gray-400">{t('overlay.agentGone', { defaultValue: 'Agent unavailable' })}</span>
            </div>
          </div>
        )
      )}

      {/* 펼침(v2.80): IDE 가 투명 OS 창 전체를 가득 채운다(fullWindow — 백드롭/솔리드 배경 ❌).
          종전 "bg-gray-950 솔리드 + 80vw/80vh 모달" 구조가 IDE 주변에 검은 띠로 보이던 문제 제거.
          disableDock — 오버레이 창의 IDE 는 우측 도킹(스냅) 기능 없음(사용자 요청). */}
      <AgentIDEOverlay disableDock fullWindow />
      <PermissionPromptStack />
    </div>
  );
}
