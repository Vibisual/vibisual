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
import { resolveOverlayCloseIntent } from './overlayCloseIntent.js';
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

  // §17-6 (H-9) — 종전에는 여기서 **닫기로 들고 갈 짐**(열어 둔 편집 탭·보던 뷰)을 스토어 구독으로
  //   계속 적어 두었다. 닫기가 `returnToApp` 과 같은 길이라 되돌아간 창이 하던 일을 이어야 했기
  //   때문이다. 이제 닫기는 **닫는다** — 앱 안에 창을 다시 열지 않으므로 실어 보낼 곳이 없다
  //   (보내 봐야 꺼내는 쪽이 없어 main 의 짐 칸에 그대로 남는다). 짐을 지고 자리를 옮기는 길은
  //   **타이틀바를 앱 안으로 끌어 넣는 (H-4)** 하나이고((H-21) 부터 ↩ 손잡이·칩 드래그는 없다), 그 짐은
  //   `AgentIDEOverlay.captureHandoff` 가 자기 자리에서 뜬다 — 이 창이 미리 적어 둘 까닭이 없다.

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

  // (판올림 번호 발급 대기) §5.5 #17-6 (H-7) — 끌어내서 만든 창은 **다 그린 뒤에** 그렇다고 말한다.
  //
  // main 은 이 신호를 받고서야 커서를 따라오던 윤곽선을 걷는다. 종전에는 `ready-to-show` 에서
  // 걷었는데, 이 창은 `transparent:true` 라 그 시점이 **React 가 마운트되기 전의 투명한 빈 창**
  // 이고, 게다가 이 창은 그 뒤로도 스냅샷을 기다렸다가(위 effect) IDE 를 연다 — 그 사이 내내
  // 커서 아래에는 아무것도 없다(사용자에게는 창이 사라진 것과 같다).
  //
  // 두 프레임을 기다리는 까닭: 첫 `requestAnimationFrame` 은 이 화면이 아직 합성되기 **전**이라,
  // 거기서 말하면 한 프레임이 빈 채로 인계된다.
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

  // §5.5 #17-6 (H-16) — **앱 안에서 이 창을 불렀다.** 그 버블을 더블클릭하면 밖에
  //   서 있는 이 창이 다른 프로그램 뒤에서도 앞으로 서고 포커스를 받는다(main 의 일).
  //   다만 이 창은 상시-위라 **이미 보이고 있던 경우가 많다** — 그때 앞으로 오는 것만으로는
  //   화면이 그대로여서 누른 사람은 안 먹은 줄 안다. 그래서 그 손짓이 여기 닿았다고 한 번 비춘다.
  //
  //   세는 것과 비추는 것을 나누는 까닭: 앞세우기는 OS 일이라 main 말고는 할 수 있는 곳이 없고,
  //   기척은 그림이라 main 에는 그릴 수단이 없다. 신호를 못 받는 판(구버전 preload)에서도
  //   앞세우기는 이미 끝난 뒤다 — 기척만 조용히 빠진다.
  //
  //   기척은 **IDE 로 서 있을 때만** 비춘다 — 접힌 버블 창은 투명한 280×320 자리라
  //   그 테두리를 두르면 버블과 상관없는 네모 상자가 번짝이는 것으로만 보인다.
  //   구독을 그 조건으로 두면 접힐 때 정리가 함께 돌아, 비추다 말고 접힌 번호가 남지 않는다.
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
  //   ⚠ 끌어내서 만든 창은 main 이 이미 IDE 크기다 — 그 창의 **첫 펼침까지는 아무것도 미러하지
  //     않는다**(`null` = 아직 기준이 없음).
  //
  // (판올림 번호 발급 대기) (H-7) 종전에는 시작값을 `initiallyExpanded`(=true)로 두었는데, 이 창의
  //   `expanded` 는 스토어에서 오므로 **마운트 순간에는 false 다**(WS 스냅샷이 와야 IDE 를 연다).
  //   그래서 첫 렌더에서 `true !== false` 로 읽혀 **일어나지도 않은 접힘을 미러**했다 —
  //   `collapseSelf()` 가 창을 280×320 버블로 줄이고 `collapsedBounds`(태어난 자리)로 옮기는 동안
  //   커서 폴링은 큰 창 기준 잡은 지점으로 계속 자리를 잡으므로, **창이 커서에서 떨어져 나간다**
  //   (사용자 보고 — "실제 IDE 로 바뀔 때 마우스에서 탈락한다"). 그 뒤 스냅샷이 오면 `expandSelf()`
  //   가 다시 키우는데, 그때의 기준은 이미 버블 자리라 창이 엉뚱한 곳에 앉는다.
  const prevExpandedRef = useRef<boolean | null>(initiallyExpanded ? null : false);

  // (판올림 번호 발급 대기) §5.5 #17-6 (H-18)→(H-20) — **이번 접힘은 버블로 가는가.**
  //
  //   타이틀바 [오버레이 버블로 바꾸기]도 스토어의 `closeIDEOverlay()` 로 접힘을 부른다(IDE 는
  //   IPC 를 직접 부르지 않는다). 그래서 아래 효과는 그 접힘이 ✕ 에서 온 것인지 이 손잡이에서
  //   온 것인지를 알아야 한다 — 이 표식이 그 답이다. (H-18) 에서는 "한 번 바꾸면 그 뒤로 내내
  //   버블이 본체"라 닫기까지 접기로 갔는데, (H-20) 부터 닫기는 닫는다(사용자 지시 — "버튼이
  //   생겼으니 독립된 IDE 창을 닫기 누르면 닫히게"). 표식은 **한 번짜리**다: 효과가 읽고 곧바로
  //   내린다. 버블을 더블클릭해 다시 편 뒤의 닫기는 도로 닫기다.
  //
  //   상태가 아니라 ref 인 까닭: 이 값은 아래 효과가 **읽기만** 하고 화면에는 아무것도 그리지
  //   않는다. 상태로 두면 값이 바뀔 때마다 효과가 다시 돌아 일어나지도 않은 전이를 미러한다.
  const toBubbleRef = useRef(false);
  const closeIDEOverlay = useGraphStore((s) => s.closeIDEOverlay);
  const collapseToBubble = useCallback(() => {
    // 표식을 **먼저** 세운다 — 아래 닫기가 같은 틱에 효과를 깨우므로, 뒤에 세우면 이미 늦다.
    toBubbleRef.current = true;
    closeIDEOverlay();
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
    // §17-6 (H-9) **닫기는 닫는다** — 그 전에 앱을 앞으로 끌어올려 카메라를 그 버블에 맞춘다(닫힌
    //   에이전트는 앱 안에만 남으므로 어디로 갔는지 보여 준다). IDE 를 열린 채 옮기는 것은 (H-4)
    //   타이틀바 끌어 넣기의 몫이다(↩ 손잡이는 (H-21) 에서 없앴다; `openIde: false` — 열면 닫기를 두 번 눌러야 닫힌다). `keepPanes` — 앱에서 보고 있던
    //   **남의 창**도 건드리지 않는다(앞 창 정리는 우클릭 점프의 규율이지 닫기의 규율이 아니다).
    // (H-20) 받아 주지 못해도 닫는다 — 종전의 물러남(메인 창이 없으면 버블로 접기)은 없앴다. 메인
    //   창이 닫히면 오버레이도 함께 닫히므로 그 갈래는 오지 않고, 닫았는데 남는 창이 곧 버그다.
    const close = (): void => { void overlay.closeSelf?.(); };
    const reveal = overlay.revealInMain;
    if (!reveal) { close(); return; }
    void Promise.resolve(reveal({ agentId, projectId, openIde: false, keepPanes: true }))
      .then(close, close);
  }, [expanded, agentId, projectId]);

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
          //
          // (판올림 번호 발급 대기) `overlay-bubble-canvas` — 그 규칙이 잡는 자리를 **이 캔버스 하나로**
          // 못 박는 표식이다. 없으면 `.overlay-window` 만으로 걸려 펼쳤을 때의 **무대 지도**(§5.5 #17-17)
          // 까지 OS 캡션이 되고, 그 위에서는 손짓이 렌더러에 닿지 않아 팬·휠 확대가 통째로 죽는다.
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

      {/* 펼침(v2.80): IDE 가 투명 OS 창 전체를 가득 채운다(fullWindow — 백드롭/솔리드 배경 ❌).
          종전 "bg-gray-950 솔리드 + 80vw/80vh 모달" 구조가 IDE 주변에 검은 띠로 보이던 문제 제거.
          disableDock — 오버레이 창의 IDE 는 우측 도킹(스냅) 기능 없음(사용자 요청). */}
      {/* (판올림 번호 발급 대기) §5.5 #17-6 (H-18) — 타이틀바의 [오버레이 버블로 바꾸기]는
          이 셸에게 말을 걸어야 한다. 창을 접는 것(`collapseSelf`)은 IDE 가 직접 부를 수 있지만,
          **닫기의 뜻이 그때부터 달라진다**는 사실은 이 셸이 쥐고 있기 때문이다(위 효과). */}
      <AgentIDEOverlay disableDock fullWindow onCollapseToBubble={collapseToBubble} />
      <PermissionPromptStack />

      {/* §5.5 #17-6 (H-16) — 앱 안에서 불렸을 때의 기척. 클릭통과(`pointer-events-none`)라
          비치는 동안에도 창은 그대로 쓴다. 끝나면 스스로 빠져 DOM 에 남지 않는다. */}
      {attention > 0 && (
        <div
          key={attention}
          aria-hidden
          onAnimationEnd={() => setAttention(0)}
          className="animate-overlay-attention pointer-events-none fixed inset-0 z-[200] rounded-xl border-2 border-sky-300/80 bg-sky-300/10 shadow-[0_0_28px_rgba(125,211,252,0.35)_inset]"
        />
      )}
    </div>
  );
}
