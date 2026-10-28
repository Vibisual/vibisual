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
import { coerceIDEFocusTarget, type IDEFocusTarget } from '../../stores/detachedIDEFocus.js';
import { resolveOverlayCloseIntent } from './overlayCloseIntent.js';
import { AttentionFlash } from './AttentionFlash.js';
import { useWebSocket } from '../../hooks/useWebSocket.js';
import { useOverlaySync } from '../../hooks/useOverlaySync.js';
import { BubbleNode } from '../BubbleMap/BubbleNode.js';
import { AgentIDEOverlay } from '../IDE/AgentIDEOverlay.js';
import { VerifyDemoLayer } from '../IDE/VerifyDemoLayer.js';
import { PermissionPromptStack } from '../PermissionPrompt/PermissionPromptStack.js';

// §17-6 — 단일 버블 가운데 정렬 옵션(init 과 창 리사이즈 재정렬에 같이 쓴다).
const FIT_VIEW_OPTS = { padding: 0.3, maxZoom: 1, minZoom: 0.4, duration: 0 } as const;

// §5.5 #17-6 — `#overlay=1&agentId=…` 해시로 뜬 오버레이 위젯 창의 shell. 본체 캔버스와 똑같이 동작하도록 실제 `BubbleNode` 를 단일 노드 ReactFlow 로 띄운다
// (엣지 연결은 `data._overlayMode=true` 로 끄고 DetailPanel 은 안 그린다). 버블 드래그는 OS 창째 이동이다(창 안 이동은 경계에서 잘린다).

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${WS_PATH}`;
const nodeTypes: NodeTypes = { bubble: BubbleNode };

export interface OverlayShellProps {
  agentId: string;
  projectId: string;
  /** 끌어내 만든 창 — IDE 로 시작한다. main 이 이미 IDE 크기라 `expandSelf` 를 부르지 않는다(부르면 그 크기를 버블 자리로 기억한다). */
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

  // §17-6 (H-9) — 짐(편집 탭·보던 뷰)을 미리 적어 두지 않는다 — 닫기는 닫으므로 실을 곳이 없다. 짐은 (H-4) 끌어 넣기 때 `AgentIDEOverlay.captureHandoff` 가 뜬다.

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
        // §17-6 — 창 안 노드 드래그 금지(경계에서 잘린다). 드래그는 handleBubbleMouseDown 이 OS 창째 옮긴다.
        draggable: false,
        data,
      }];
    });
  }, [agent, agentId, setNodes]);

  // 끌어내 만든 창 — 스냅샷이 와서 버블을 안 뒤에 IDE 를 연다(일찍 열면 `nodeMap` 이 비어 빈 창이 뜬다).
  // §5.5 #17-6 (H) — main 이 맡아 둔 짐(편집 탭·보던 뷰·고른 세션)이 있으면 그 상태로 연다. 한 번 꺼내면 사라진다.
  const popOutOpenedRef = useRef(false);
  // §5.5 #17-6 (H-27) ⑦ 짐을 **풀기 전에** 앱이 세션을 골라 이 창을 부르면(끌어낸 직후의 북마크 점프 등)
  //   그 세션은 짐을 푼 **다음에** 세운다 — 먼저 세우면 뒤따라 풀리는 짐의 "고른 세션"이 그것을 덮는다.
  //   버블로 태어난 창은 풀 짐이 없으므로 처음부터 풀린 판이다.
  const popOutSettledRef = useRef(!initiallyExpanded);
  const deferredFocusRef = useRef<IDEFocusTarget | null>(null);
  const settlePopOut = useCallback(() => {
    popOutSettledRef.current = true;
    const focus = deferredFocusRef.current;
    deferredFocusRef.current = null;
    if (focus) openIDEOverlay(agentId, { focus });
  }, [agentId, openIDEOverlay]);
  useEffect(() => {
    if (!initiallyExpanded || popOutOpenedRef.current || !agent) return;
    popOutOpenedRef.current = true;
    const ov = window.api?.overlay;
    if (!ov?.takeHandoff) {
      openIDEOverlay(agentId);
      settlePopOut();
      return;
    }
    void ov.takeHandoff(agentId).then((raw) => {
      openIDEOverlay(agentId, {
        // 독립 창은 붙은 변·창 안 좌표를 물려받지 않는다(창 자체가 IDE 라 앉을 변이 없다).
        //   그 값은 짐 안에 남아 되돌아갈 때 원래 자리로 복귀하는 데 쓰인다.
        handoff: coerceIDEPaneHandoff(raw),
        handoffTarget: 'detached',
      });
      settlePopOut();
    });
  }, [initiallyExpanded, agent, agentId, openIDEOverlay, settlePopOut]);

  // §5.5 #17-6 (H-7) — 끌어낸 창은 다 그린 뒤에 알린다(main 이 그때 윤곽선을 걷는다). `ready-to-show` 는 투명 창의 React 마운트 전이라 이르다.
  // 두 프레임을 기다린다 — 첫 `requestAnimationFrame` 은 합성 전이다.
  const shellReadySentRef = useRef(false);
  useEffect(() => {
    if (!initiallyExpanded || !expanded || shellReadySentRef.current) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        if (shellReadySentRef.current) return;
        shellReadySentRef.current = true;
        void window.api?.overlay?.shellReady?.();
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [initiallyExpanded, expanded]);

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

  // §5.5 #17-6 (H-16) — 앱 안에서 이 창을 불렀다. 앞세우기는 main(OS 일), 기척은 여기서 그린다(이미 보이던 창은 앞세워도 화면이 그대로다).
  // 기척은 IDE 로 서 있을 때만 — 접힌 버블 창(투명 280×320)에 두르면 엉뚱한 네모가 번쩍인다. 구독을 그 조건에 걸어 접힐 때 정리된다.
  const [attention, setAttention] = useState(0);
  useEffect(() => {
    const ov = window.api?.overlay;
    if (!ov?.onAttention || !expanded) return;
    const off = ov.onAttention((payload) => {
      // 한 창은 한 에이전트의 것이지만, 마지막 글자까지 맞춰 남의 기척을 대신 비추지 않는다.
      if (payload.agentId !== agentId) return;
      // 같은 번호로 둘을 세면 React 가 같은 원소로 알아 애니메이션이 다시 돌지 않는다 —
      //   연달아 더블클릭해도 매번 대답하도록 번호를 올려 **새 원소**로 만든다(`key`).
      setAttention((n) => n + 1);
    });
    return () => {
      off();
      setAttention(0);
    };
  }, [agentId, expanded]);

  const rfRef = useRef<ReactFlowInstance | null>(null);
  const handleInit = useCallback((inst: ReactFlowInstance) => {
    rfRef.current = inst;
    // 단일 버블을 자연 크기로 가운데 정렬.
    requestAnimationFrame(() => inst.fitView(FIT_VIEW_OPTS));
  }, []);

  // §17-6 — 컨테이너 리사이즈마다 fitView 한다 — 접힘 때 OS 창 축소(collapseSelf→IPC→setBounds)가 비동기라 init 한 번이면 버블이 한쪽으로 잘린다.
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

  // §17-6 (G) — 우클릭 메뉴는 커서 위치의 독립 팝업 창으로 띄운다(버블 창 안이면 하단이 잘린다). 좌표·렌더는 OverlayMenuShell + windowManager 몫.
  const handleContextMenu = useCallback((e: React.MouseEvent | MouseEvent) => {
    e.preventDefault();
    void window.api?.overlay?.openMenu();
  }, []);

  // 메뉴의 "IDE 열기" → 더블클릭과 같은 openIDEOverlay. §5.5 #17-6 (H-27) ⑦ 앱이 세션을 골라 불렀으면 `focus` 에 실려 와 그 세션(북마크면 그 자리)에 세운다.
  // 건너온 값이라 모양을 가리고, 틀리면 보던 세션에 둔다.
  useEffect(() => {
    const overlay = window.api?.overlay;
    if (!overlay?.onMenuCommand) return;
    return overlay.onMenuCommand(({ command, focus }) => {
      if (command !== 'open-ide') return;
      const target = coerceIDEFocusTarget(focus);
      if (!popOutSettledRef.current) {
        // 짐을 푸는 중 — 창은 그 길이 연다. 세울 세션만 맡아 두었다가 짐을 푼 다음에 세운다.
        if (target) deferredFocusRef.current = target;
        return;
      }
      openIDEOverlay(agentId, target ? { focus: target } : undefined);
    });
  }, [agentId, openIDEOverlay]);

  // §17-6 — 버블 드래그 = OS 창 이동. .bubble-body 를 잡으면 main 이 커서를 폴링해 창째 따라가고(drag-start) window mouseup 에서 놓는다(drag-end).
  // 커서가 안 움직이면 창도 안 움직여 클릭·더블클릭 판정은 그대로다.
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

  // §17-6 (H-4) ⑥ — 커서에 매달린 동안 뗌을 여기서도 듣는다 — 매달기는 메인 창·이 창 양쪽에서 시작하고 캡처는 OS 가 정해,
  // 한쪽만 들으면 창이 영영 따라다닌다. 두 번 불려도 안전하다.
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

  // expanded 전이를 OS 창 크기로 미러한다(초기 collapsed 마운트에선 ❌). 끌어낸 창은 이미 IDE 크기라 첫 펼침까지 미러하지 않는다(`null` = 기준 없음).
  // ⚠ 시작값을 `initiallyExpanded` 로 두지 마라 — 마운트 때 `expanded` 는 false 라 가짜 접힘을 미러해 창이 커서에서 떨어지고 엉뚱한 곳에 앉는다(H-7).
  const prevExpandedRef = useRef<boolean | null>(initiallyExpanded ? null : false);

  // §5.5 #17-6 (H-20) — 이번 접힘이 [오버레이 버블로 바꾸기]에서 왔는가(그 손잡이도 `closeIDEOverlay()` 로 접으므로 ✕ 와 이 표식으로 가른다).
  // 한 번짜리 — 효과가 읽고 곧바로 내린다. ref 인 까닭: 상태면 바뀔 때마다 효과가 다시 돌아 없는 전이를 미러한다.
  const toBubbleRef = useRef(false);
  const closeIDEOverlay = useGraphStore((s) => s.closeIDEOverlay);
  const collapseToBubble = useCallback(() => {
    // 버리기 확인이 취소되면 표식도 남기지 않는다. 실제 닫기 바로 앞에서만 세운다.
    closeIDEOverlay(null, { beforeClose: () => { toBubbleRef.current = true; } });
  }, [closeIDEOverlay]);

  useEffect(() => {
    if (prevExpandedRef.current === null) {
      // 끌어내서 만든 창 — IDE 를 열기 전(false)은 **상태가 아직 도착하지 않은 것**이지 접힘이
      //   아니다. 첫 펼침에 도달했을 때부터 기준을 잡는다(그 전이 자체도 미러하지 않는다 —
      //   main 이 이미 IDE 크기로 만들어 두었다).
      if (expanded) prevExpandedRef.current = true;
      return;
    }
    if (prevExpandedRef.current === expanded) return;
    prevExpandedRef.current = expanded;
    const overlay = window.api?.overlay;
    if (!overlay) return;
    if (expanded) { void overlay.expandSelf(); return; }
    // 닫기의 뜻은 `overlayCloseIntent.ts` 가 단독 소유한다 — (H-20) 밖에 선 IDE 창의 닫기는
    //   창을 닫고, 버블로 접히는 것은 [오버레이 버블로 바꾸기]의 부탁(한 번짜리 표식)뿐이다.
    //   출신(`initiallyExpanded`)은 판정에 넘기지 않는다 — 닫기의 뜻을 바꾸지 않는다.
    const intent = resolveOverlayCloseIntent({
      toBubble: toBubbleRef.current,
      canCloseSelf: !!overlay.closeSelf,
    });
    // 표식은 이 접힘 한 번에만 유효하다 — 읽었으면 곧바로 내린다(다음 닫기는 도로 닫기).
    toBubbleRef.current = false;
    if (intent === 'collapse') { void overlay.collapseSelf(); return; }
    // §17-6 (H-9) 닫기는 닫는다 — 먼저 앱을 앞으로 올려 그 버블을 보인다. `openIde: false`(열면 닫기를 두 번 눌러야 한다) · `keepPanes`(남의 창은 그대로).
    // (H-20) 앱이 못 받아도 닫는다.
    const close = (): void => { void overlay.closeSelf?.(); };
    const reveal = overlay.revealInMain;
    if (!reveal) { close(); return; }
    void Promise.resolve(reveal({ agentId, projectId, openIde: false, keepPanes: true }))
      .then(close, close);
  }, [expanded, agentId, projectId]);

  return (
    <div className="h-dvh w-screen overflow-hidden bg-transparent text-gray-100">
      {/* 접힘: 투명 위에 실제 BubbleNode 단일 노드. app-drag 영역(ReactFlow pane)을 잡고 OS 창 이동,
          버블 본체(.bubble-body)는 캔버스와 동일하게 드래그/클릭/더블클릭. */}
      {!expanded && (
        agent ? (
          // 컨테이너에 app-drag 를 걸지 마라 — OS 가 마우스를 가로채 버블 클릭이 죽는다. `.overlay-window`(index.css)가 빈 pane 만 drag, 노드는 no-drag 로 가른다.
          // `overlay-bubble-canvas` 는 그 규칙을 이 캔버스 하나로 묶는다 — 없으면 펼친 무대 지도(§5.5 #17-17)도 캡션이 되어 팬·휠이 죽는다.
          <div
            ref={fitContainerRef}
            className="overlay-bubble-canvas h-full w-full"
            onMouseDownCapture={handleBubbleMouseDown}
          >
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
              {/* `app-drag-label` — 이 상자는 통째로 창 손잡이라, 안의 글자·그림이 손짓을 잡으면
                  잡은 그 손짓이 창 이동 대신 그 자리에서 소모된다(`index.css`). */}
              <svg className="app-drag-label h-6 w-6 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
              <span className="app-drag-label text-[12px] text-gray-400">{t('overlay.agentGone', { defaultValue: 'Agent unavailable' })}</span>
            </div>
          </div>
        )
      )}

      {/* 펼침: IDE 가 투명 OS 창 전체를 채운다(fullWindow — 백드롭·배경이 있으면 둘레에 검은 띠). disableDock — 오버레이 IDE 는 우측 도킹이 없다. */}
      {/* (판올림 번호 발급 대기) §5.5 #17-6 (H-18) — 타이틀바의 [오버레이 버블로 바꾸기]는
          이 셸에게 말을 걸어야 한다. 창을 접는 것(`collapseSelf`)은 IDE 가 직접 부를 수 있지만,
          **닫기의 뜻이 그때부터 달라진다**는 사실은 이 셸이 쥐고 있기 때문이다(위 효과). */}
      <AgentIDEOverlay disableDock fullWindow onCollapseToBubble={collapseToBubble} />
      {/* 이 렌더러는 IDEPaneHost 를 쓰지 않는 단일 별창이다. 검증 녹화 층도 한 벌만 둔다. */}
      <VerifyDemoLayer />
      <PermissionPromptStack />

      {/* §5.5 #17-6 (H-16) — 앱 안에서 불렸을 때의 기척. 클릭통과(`pointer-events-none`)라
          비치는 동안에도 창은 그대로 쓴다. 끝나면 스스로 빠져 DOM 에 남지 않는다. */}
      <AttentionFlash seq={attention} onDone={() => setAttention(0)} className="rounded-xl" />
    </div>
  );
}
