import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import type { BubbleData } from '@vibisual/shared';
import { AGENT_CARD, BUBBLE_STYLES, LINK_FOCUS, clipNameList } from '@vibisual/shared';
import type { AppWorkFoldedBadge } from './appWorkFold.js';
import { useGraphStore, selectIDEActiveSessionForAgent, agentSessionInputKey } from '../../stores/graphStore.js';
import { useLinkRole, useLinkFocusStore, promoteLinkGrab, releaseLinkGrab } from '../../stores/linkFocus.js';
import { useRefLinkDragStore } from '../../stores/refLinkDrag.js';
import { getInternalApp, appOutputExtensions } from '../../apps/registry.js';
import { IME_ENTER_OWNER, isComposingKeyEvent } from '../../utils/inputComposition.js';
import { useEnterSubmit } from '../../hooks/useEnterSubmit.js';
import { readFieldSelection } from '../../hooks/textFieldActions.js';
import { codexProviderOf } from '../Codex/codexModelEntry.js';
import { localProviderOf } from '../LocalModel/localModelEntry.js';
import { BubbleNode } from './BubbleNode.js';
import { BubbleStatusEffects } from './BubbleStatusEffects.js';
import { bubbleAgentStyle, bubbleStatusRingClass } from './bubbleStatus.js';
import { resolveBubbleSkin } from '@vibisual/shared';
import { DARK_THEME_LOCK } from '../../theme/themeLock.js';
import { bubbleSurface } from './bubbleSurface.js';
import { BubbleSurfaceDetail } from './BubbleSurfaceDetail.js';
import { BubbleHiddenIndicator } from './BubbleHiddenIndicator.js';
import { BUBBLE_MENU_EVENT, type BubbleMenuRequest } from './BubbleContextMenu.js';
import { isInteractiveTarget, useBubbleSelectGesture } from './bubbleSelectGesture.js';
import { useCanvasNodeSelection } from './useCanvasNodeSelection.js';
import { shouldDismissOnSelect } from './agentDismiss.js';
import { isMainCanvasView } from './canvasScope.js';
import { linkFocusNodeStyle } from './linkedBubbles.js';
import { BRAND_ICON_PATHS } from './brandIconPaths.js';
import { useAgentCardSend } from './useAgentCardSend.js';
import { useAgentCardWork } from './useAgentCardWork.js';
import { useAgentCardTasks } from './useAgentCardTasks.js';
import { AgentCardTaskControls } from './AgentCardTaskControls.js';
import { CARD_TASK_DRAFT, cardTaskNodes, needsCardTaskDestination, useCardTaskStore } from './agentCardTaskState.js';
import { reserveCardTask, restoreCardTaskDraft, selectCardTask } from './agentCardTaskFlow.js';
import {
  agentCardDiscCenter,
  appNodeLabel,
  isAgentCardForm,
  linkedAppBubblesKey,
  linkedAppBubblesOf,
  orbitDotAngles,
  orbitPoint,
  pickCardSession,
  type LinkedOutputNode,
} from './agentCard.js';

/**
 * AgentCardNode.tsx — §5.4 #36 (A) **에이전트 말풍선.**
 *
 * 커스텀 에이전트 버블의 우클릭 메뉴 맨 아래 [말풍선으로 전환]을 누르면, 버블이 있던 자리에 **원이 그대로 남고**
 * 그 왼쪽으로 입력 말풍선이 펴진다(우클릭 자체는 아무것도 바꾸지 않는다 — 2026-10-10 사용자 지시). 되돌리기는 이
 * 노드 어디서 우클릭해도 같은 자리의 [버블로 되돌리기]다. 캔버스에서 **바로 말을 거는 자리**다 — IDE 를 열지 않고
 * 한 줄을 보내고, 원의 궤도 위 위성 점을 끌어 우리 앱 노드(영상·소리·3D·이미지)를 위성으로 띄워 잇는다(§5.4 #36 (B)).
 *
 * 읽는 방향이 곧 흐름이다: 말풍선(내 말) → 원(에이전트) → 오른쪽 앱 위성(결과).
 *
 * 노드 타입은 여전히 `bubble` 이다(`CanvasBubbleNode` 가 형태만 갈라 그린다). 그래야 선택·삭제·Task Edge·
 * 더블클릭 IDE·무리 강조가 버블과 **한 벌**로 돈다 — 따로 길을 깔면 버블에서 고친 것이 말풍선에서 샌다.
 *
 * 생김새는 이 앱의 것이다 — 원·궤도·위성(캔버스의 기존 낱말)·Lucide 글리프·우리 상태 색·에이전트 색·앱 색(§5.4 #36 (D)).
 */

/** 원 안의 엔진 글리프 — 버블이 쓰는 그 브랜드 로고(같은 정체는 어디서 보든 같은 그림). */
function EngineGlyph({ engine, className }: { engine: 'claude' | 'codex' | 'local'; className: string }): React.JSX.Element {
  if (engine === 'local') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <rect x="6" y="6" width="12" height="12" rx="2" />
        <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" className={className} aria-hidden="true">
      <path d={engine === 'codex' ? BRAND_ICON_PATHS.codex : BRAND_ICON_PATHS.claude} />
    </svg>
  );
}

const HANDLE_STYLE: React.CSSProperties = {
  left: '50%',
  top: '50%',
  opacity: 0,
  width: 1,
  height: 1,
  border: 'none',
  minWidth: 0,
  minHeight: 0,
  pointerEvents: 'none',
};

/** 말풍선 테두리 — 평시 흐린 선(입력 중엔 에이전트 색). 꼬리도 같은 색이라야 한 몸으로 보인다. */
const BALLOON_BORDER_IDLE = 'rgba(255,255,255,0.12)';
/** §5.4 #36 (I) — 접힌 개수 점의 지름 · 궤도 위 자리(도 — 화면 좌표, 왼쪽 위). */
const FOLDED_DOT = 18;
const FOLDED_DOT_ANGLE_DEG = -135;
/** 툴팁 줄바꿈(여러 줄 `title`). */
const LINE_BREAK = '\n';

type CardNodeProps = NodeProps & { data: BubbleData & Record<string, unknown> };

/**
 * 방금 형태를 바꾼 에이전트 — 말풍선이 펴지는 전이는 **바꾼 그 순간에만** 돈다. 캔버스는 화면 밖 노드를 내렸다가
 * 다시 올리므로(§4 v3.71 컬링) 마운트마다 돌리면 팬할 때마다 말풍선이 다시 펴진다.
 * 손이 떠나면 의미 없는 표시 상태라 영속하지 않는다.
 */
const formChangedAt = new Map<string, number>();

/** 캔버스가 형태를 바꿀 때 부른다(`BubbleMap.applyAgentForm`). */
export function noteAgentFormChange(agentId: string): void {
  formChangedAt.set(agentId, Date.now());
}

function consumeFormChange(agentId: string): boolean {
  const at = formChangedAt.get(agentId);
  formChangedAt.delete(agentId);
  return at !== undefined && Date.now() - at <= AGENT_CARD.morphMs * 4;
}

export const AgentCardNode = memo(function AgentCardNode({ id, data, selected }: CardNodeProps): React.JSX.Element {
  const { t } = useTranslation();
  const agentId = data.id;
  // §6 — 고른 묶음(React Flow `selected`)을 바꾸는 손잡이. 보통 클릭은 이 카드 하나로, Ctrl/Cmd 클릭은 넣고 뺀다.
  const canvasSelection = useCanvasNodeSelection(id);

  // ── 정체·색 — 버블과 같은 출처(사용자 지정 색 → 엔진 색 → 에이전트 기본색) ──
  const customColor = useGraphStore((s) => s.agentConfigs[agentId]?.color);
  const isCodex = useGraphStore((s) => codexProviderOf(s.agentConfigs[agentId]) !== null);
  const isLocal = useGraphStore((s) => localProviderOf(s.agentConfigs[agentId]) !== null);
  const bubbleStyle = useMemo(() => bubbleAgentStyle(BUBBLE_STYLES.agent, isCodex, customColor), [isCodex, customColor]);
  const color = bubbleStyle.color;
  const skin = useGraphStore((s) => resolveBubbleSkin(s.bubbleAppearancePending?.bubbleSkin ?? s.userDefaults?.appearance?.bubbleSkin));
  const engine: 'claude' | 'codex' | 'local' = isLocal ? 'local' : isCodex ? 'codex' : 'claude';

  // ── 보낼 세션 — 버블이 보여 주는 세션과 같은 우선순위 ──
  const subs = useGraphStore((s) => s.subAgents[agentId]);
  const ideActive = useGraphStore((s) => selectIDEActiveSessionForAgent(s, agentId));
  const sticky = useGraphStore((s) => s.selectedSubByAgent[agentId]);
  const tasks = useAgentCardTasks(agentId);
  const activeTask = tasks.entry.book?.tasks.find((task) => task.id === tasks.entry.book?.activeTaskId);
  const sessionId = activeTask ? activeTask.sessionId : pickCardSession(subs, ideActive, sticky);
  const taskMode = tasks.entry.mode;
  const pendingTask = tasks.entry.book?.pending;
  const inputSessionId = taskMode ? CARD_TASK_DRAFT : sessionId;
  const [destinationChoice, setDestinationChoice] = useState<string | null>(null);
  const [reserving, setReserving] = useState(false);
  const reservationInFlight = useRef(false);

  // ── 초안 — IDE 입력창과 같은 칸(말풍선에서 치던 글이 IDE 에서 이어진다) ──
  const sessionDraft = useGraphStore((s) => s.agentSessionInputs[agentSessionInputKey(agentId, inputSessionId)]);
  const draft = sessionDraft?.text ?? '';
  const sessionWork = useAgentCardWork(agentId, sessionId);

  // ── 위성 칩 — 이 에이전트를 참조하는 앱 노드들(지문 구독 → getState 재구성) ──
  const activeProject = useGraphStore((s) => s.activeProject);
  const linkKey = useGraphStore((s) => linkedAppBubblesKey(s.appBubbles, agentId, s.activeProject));
  const linked = useMemo(
    () => cardTaskNodes(linkedAppBubblesOf(useGraphStore.getState().appBubbles, agentId, activeProject), tasks.entry.book),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [linkKey, agentId, activeProject, tasks.entry.book],
  );
  /** 이번 명령에서 뺀 노드 — 휘발 상태(§5.4 #36 (E) 토글 영속 ❌). */
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    // 끊긴 노드의 표식은 걷는다 — 다시 이어졌을 때 예전 "뺌"이 몰래 살아 있지 않게.
    setExcluded((prev) => {
      if (prev.size === 0) return prev;
      const alive = new Set(linked.map((b) => b.id));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [linked]);

  const outputNodes = useMemo<LinkedOutputNode[]>(() => linked
    .filter((b) => !excluded.has(b.id))
    .map((b) => {
      const app = getInternalApp(b.appId);
      // 프로토콜 블록에는 번역하지 않은 **제품 이름**을 쓴다(브랜드 — 에이전트가 읽는 규약이다).
      const appName = app?.name ?? b.appId;
      return {
        id: b.id,
        appName,
        label: appNodeLabel(b, appName),
        accepts: app ? appOutputExtensions(app) : [],
        file: b.file,
      };
    }), [linked, excluded]);

  // ── 보내기 — 기존 큐 하나(§5.12 #2 와 같은 규율 — 새 전송 경로 ❌) ──
  //   §5.4 #36 (C) 개정 — 앱이 자기 브리프를 선언한 노드(작업 문서)는 그 브리프를 지어 붙인다(문서를 새로 만들었으면
  //   노드에 묶인다). 초안은 먼저 비운다 — 브리프를 짓는 짧은 왕복 동안 같은 글을 두 번 보내지 않게(전송이 실패하면
  //   `addCommand` 가 초안을 되돌린다).
  const { send: sendCurrent, sending, preparationFailed } = useAgentCardSend(agentId, sessionId, draft, outputNodes,
    tasks.projectId ? { projectId: tasks.projectId, ...(activeTask ? { taskId: activeTask.id } : {}) } : undefined);
  const taskTitle = activeTask?.title ?? (linked.map((node) => appNodeLabel(node, getInternalApp(node.appId)?.name ?? node.appId)).join(', ')
    || subs?.find((sub) => sub.id === sessionId)?.label || t('canvas.agentCard.tasks.current'));
  const taskError = (error: unknown): void => useCardTaskStore.getState().patch(tasks.key,
    { error: error instanceof Error ? error.message : 'task-prepare-failed' });
  const beginTask = (mode: 'new' | 'copy'): void => {
    if (sending || reserving || pendingTask) return;
    setDestinationChoice(null);
    useCardTaskStore.getState().patch(tasks.key, { mode, error: undefined });
  };
  const submitNewTask = (mode: 'new' | 'copy', text: string, fromCurrent = false): void => {
    if (!text.trim() || !tasks.projectId || pendingTask || reservationInFlight.current) return;
    reservationInFlight.current = true;
    setReserving(true);
    setDestinationChoice(null);
    useCardTaskStore.getState().patch(tasks.key, { mode, error: undefined });
    void reserveCardTask({ projectId: tasks.projectId, agentId, mode, text: text.trim(), sessionId,
      currentNodes: linked, targetNodeIds: outputNodes.map((node) => node.id), title: taskTitle })
      .then(() => {
        if (fromCurrent && useGraphStore.getState().agentSessionInputs[agentSessionInputKey(agentId, sessionId)]?.text === text)
          useGraphStore.getState().setAgentSessionInputText(agentId, sessionId, '');
      }).catch((error) => {
        useGraphStore.getState().setAgentSessionInputText(agentId, CARD_TASK_DRAFT, text);
        taskError(error);
      }).finally(() => { reservationInFlight.current = false; setReserving(false); });
  };
  const send = (live?: string): void => {
    const text = live ?? draft;
    if (pendingTask || reserving || sending) return;
    if (taskMode) { submitNewTask(taskMode, text); return; }
    if (tasks.projectId && needsCardTaskDestination(text, !!activeTask || linked.some((node) => !!node.ref || !!node.file))) {
      setDestinationChoice(text); return;
    }
    sendCurrent(text);
  };
  const onEnterKey = useEnterSubmit(send);

  // ── 선택 — 버블과 같은 상태기계(클릭 선택·확인 dismiss·더블클릭 IDE) ──
  const linkModifierHeld = useLinkFocusStore((s) => s.modifierHeld);
  const performSelect = useCallback((): void => {
    canvasSelection.replace();
    useGraphStore.getState().selectNode(agentId);
    if (shouldDismissOnSelect(data.status)) {
      fetch('/api/dismiss-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      }).catch(() => {});
    }
  }, [agentId, data.status, canvasSelection]);
  const gesture = useBubbleSelectGesture({
    doubleClickable: true,
    select: performSelect,
    toggle: canvasSelection.toggle,
    setIntent: (active) => useGraphStore.getState().setSelectIntent(active ? agentId : null),
    ignore: (e) => {
      // 입력칸·칩·버튼 위의 누름은 선택이 아니다 — 글을 치려던 손이 노드를 고르지 않게.
      if (isInteractiveTarget(e.target)) return true;
      // §5.4 #31 — Ctrl/Cmd 를 쥔 채 누르면 무리 잡기다(버블과 같다). 누름은 그대로 기록한다(§6) —
      //   끌면 무리 동반 이동, 움직임 없이 떼면 이 카드를 묶음에 넣거나 뺀다.
      if (linkModifierHeld) promoteLinkGrab(agentId);
      return false;
    },
  });
  const handlePointerUp = useCallback((e: React.PointerEvent): void => {
    gesture.handlers.onPointerUp(e);
    releaseLinkGrab();
  }, [gesture]);

  // ── 우클릭 — 노드 어디서든 #34 메뉴가 열리고, 그 맨 아래가 [버블로 되돌리기]다(§5.4 #36 (A)) ──
  //   고르지는 않는다 — 우측 패널은 왼쪽 클릭 선택에서만 뜬다(§6, 2026-10-11 사용자 지시). 대상은 `nodeId` 다.
  const handleContextMenu = useCallback((e: React.MouseEvent): void => {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent<BubbleMenuRequest>(BUBBLE_MENU_EVENT, {
      detail: { nodeId: agentId, screenX: e.clientX, screenY: e.clientY },
    }));
  }, [agentId]);
  /**
   * 입력칸 위 우클릭 — 말풍선은 거의 전부가 입력칸이라, 여기서 전역 글자 메뉴만 뜨면 되돌리는 길이 숨는다.
   * 그래서 이 칸은 자기 메뉴를 갖는다(`data-text-menu="own"`): 글자 항목을 맨 위에 그대로 두고 그 아래에
   * 같은 에이전트 메뉴를 잇는다. 선택 범위는 **지금** 떠 둔다(메뉴를 누를 때는 초점이 옮겨가 있을 수 있다).
   * 글을 치던 손이라 노드를 고르지는 않는다(입력칸 누름은 선택이 아니다 — 위 `ignore` 와 같은 규칙).
   */
  const handleFieldContextMenu = useCallback((e: React.MouseEvent<HTMLTextAreaElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    window.dispatchEvent(new CustomEvent<BubbleMenuRequest>(BUBBLE_MENU_EVENT, {
      detail: {
        nodeId: agentId,
        screenX: e.clientX,
        screenY: e.clientY,
        textField: { el, sel: readFieldSelection(el) },
      },
    }));
  }, [agentId]);

  // ── 위성 손잡이 — 누르면 위성줄 한 가닥이 원에서 나온다(놓기 판정·꽃은 `BubbleMap` 이 한다) ──
  const discRef = useRef<HTMLDivElement>(null);
  const onSatellitePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const r = discRef.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return;
    // 줌 배율 = 원의 화면 지름 ÷ 캔버스 지름 — 궤도 반지름을 화면 px 로 옮긴다(미리보기·꽃은 화면 좌표다).
    const scale = r.width / AGENT_CARD.discSize;
    useRefLinkDragStore.getState().start({
      agentId,
      downX: e.clientX,
      downY: e.clientY,
      originX: r.left + r.width / 2,
      originY: r.top + r.height / 2,
      originR: AGENT_CARD.orbitRadius * scale,
      color,
    });
  }, [agentId, color]);
  const dragging = useRefLinkDragStore((s) => s.drag?.agentId === agentId);

  // ── 표시 상태 ──
  const showRing = useGraphStore((s) => s.selectIntentId !== null && s.selectIntentId === agentId);
  const linkRole = useLinkRole(agentId);
  const linkPhase = useLinkFocusStore((s) => s.phase);
  const linkVisual = useMemo(() => linkFocusNodeStyle(linkRole, linkPhase), [linkRole, linkPhase]);
  const isDespawning = !!(data as Record<string, unknown>)['_despawning'];
  /** 이 마운트가 방금 바꾼 형태인가 — 그때만 말풍선이 원 쪽에서 펴진다. */
  const [morph] = useState(() => consumeFormChange(agentId));
  const [typing, setTyping] = useState(false);
  const status = data.status;
  const running = status !== 'awaiting_permission' && sessionWork === 'running';
  const waiting = sessionWork === 'waiting';
  const sendFailed = preparationFailed || !!sessionDraft?.sendFailure || !!sessionDraft?.sendError;
  const busy = sending || reserving || pendingTask?.status === 'preparing' || (running && !sendFailed);
  const statusText = sending || reserving || pendingTask?.status === 'preparing' ? t('ide.askQuestion.sending')
    : pendingTask?.status === 'failed' ? t('canvas.agentCard.status.error')
    : pendingTask?.status === 'waiting' ? t('panel.subAgent.status.waiting')
    : sendFailed ? t('canvas.agentCard.status.error')
      : status === 'awaiting_permission' ? t('canvas.agentCard.status.waiting')
        : running ? t('canvas.agentCard.status.active')
          : status === 'error' ? t('canvas.agentCard.status.error')
            : waiting ? t('panel.subAgent.status.waiting')
              : status === 'completed' ? t('canvas.agentCard.status.completed')
                : t('canvas.agentCard.status.idle');
  const statusDetail = sessionDraft?.sendError
    ? t('ide.orchestra.readiness.retry', { engine: sessionDraft.sendError.engine === 'codex' ? 'Codex' : 'Claude Code' })
    : sendFailed ? t(sessionDraft?.sendFailure === 'local-images-unsupported' ? 'ide.mainArea.localImagesUnsupported'
      : sessionDraft?.sendFailure === 'unconfirmed' ? 'ide.mainArea.sendUnconfirmed' : 'ide.mainArea.sendRejected')
      : statusText;
  const statusColor = sending ? 'text-sky-300'
    : sendFailed || status === 'error' ? 'text-rose-300'
      : status === 'awaiting_permission' || waiting ? 'text-amber-300'
        : running ? 'text-sky-300'
          : status === 'completed' ? 'text-cyan-300' : 'text-gray-400';
  const discTitle = [
    data.label,
    statusText,
    linked.length > 0 ? t('canvas.agentCard.linkedCount', { count: linked.length }) : null,
  ].filter(Boolean).join(' · ');

  // ── 기하(노드 좌표계) — 원 중심·궤도·위성 손잡이·이름 자리 ──
  const disc = agentCardDiscCenter();
  const orbitR = AGENT_CARD.orbitRadius;
  const discR = AGENT_CARD.discSize / 2;
  const sat = orbitPoint(AGENT_CARD.satelliteAngleDeg);
  const dotAngles = orbitDotAngles(linked.length);
  // §5.4 #36 (I) — 앱 작업 보기에서 접힌 버블(그리는 사본에만 실린 표시 값). 궤도 왼쪽 위(-135°)에 앉는다.
  const appWorkFolded = (data as Record<string, unknown>)['_appWorkFolded'] as AppWorkFoldedBadge | undefined;
  const foldedSeat = orbitPoint(FOLDED_DOT_ANGLE_DEG);
  const appWorkFoldedTitle = appWorkFolded && appWorkFolded.count > 0
    ? [
      t('canvas.appWork.folded', { count: appWorkFolded.count }),
      ...clipNameList(appWorkFolded.names).shown.map((n) => `  ${n}`),
      ...(clipNameList(appWorkFolded.names).more > 0
        ? [t('canvas.appWork.more', { count: clipNameList(appWorkFolded.names).more })]
        : []),
      t('canvas.appWork.foldedHint', { label: t('canvas.bubbleMenu.lensFiles') }),
    ].join(LINE_BREAK)
    : undefined;
  /** 이름 폭 — 원을 가운데로 말풍선 끝까지(말풍선 위로 넘어가지 않게). */
  const labelWidth = 2 * (disc.x - AGENT_CARD.balloonWidth);
  const balloonBorder = typing ? `${color}99` : BALLOON_BORDER_IDLE;

  // 원은 버블과 같은 에이전트 전체 상태. 입력줄·궤도는 보낼 세션의 실행/큐 상태를 유지한다.
  const ringClass = bubbleStatusRingClass(status, bubbleStyle);
  const surface = bubbleSurface(skin, color, bubbleStyle.glow, status, { creatingError: data.creatingStatus === 'error' });
  const selectionShadow = [
    // §6 — 묶음에 든 카드도 같은 고리다(버블의 묶음 고리와 같은 말 — 흰 고리 + 제 색 번짐).
    //   §4 앱 테마 — 흰 고리는 "앞쪽" 색 변수라 라이트 캔버스에서는 어두워진다(기본 테마는 종전 그대로 흰색).
    showRing || selected === true ? `0 0 0 2px var(--color-white), 0 0 0 6px ${color}4D` : null,
    linkVisual.boxShadow,
  ].filter(Boolean).join(', ') || undefined;

  const canSend = !sending && !reserving && !pendingTask && !destinationChoice && draft.trim().length > 0;

  return (
    <div
      className={`group relative ${isDespawning ? 'bubble-despawn' : ''}`}
      style={{
        width: AGENT_CARD.width,
        height: AGENT_CARD.height,
        opacity: linkVisual.opacityMul === 1 ? undefined : linkVisual.opacityMul,
        filter: linkVisual.filter ?? undefined,
        transition: `opacity ${linkRole === 'off' ? '0.4s ease-out' : `${LINK_FOCUS.TRANSITION_MS}ms ease-out`}, filter ${LINK_FOCUS.TRANSITION_MS}ms ease-out`,
      }}
    >
      {/* 선의 끝점 계산용 숨은 손잡이 — 노드 가운데. 끝점은 선이 말풍선 + 궤도의 실루엣에서 끊는다. */}
      <Handle type="source" id="src" position={Position.Top} style={HANDLE_STYLE} isConnectable={false} />
      <Handle type="target" id="tgt" position={Position.Top} style={HANDLE_STYLE} isConnectable={false} />

      {/* 말풍선 + 꼬리 — 원 쪽(오른쪽 가운데)에서 왼쪽으로 펴진다(바꾼 그 순간에만). */}
      <div
        className={`absolute left-0 top-0 ${morph ? 'agent-balloon-unfold' : ''}`}
        style={{ width: AGENT_CARD.balloonWidth, height: AGENT_CARD.height }}
      >
        {/* 말풍선 — 끌기 손잡이(`.bubble-body`)이자 입력 자리. */}
        <div
          className="bubble-body absolute inset-0 flex flex-col overflow-hidden border transition-[border-color] duration-150"
          {...gesture.handlers}
          onPointerUp={handlePointerUp}
          onDoubleClick={() => gesture.cancelPendingSelect()}
          onContextMenu={handleContextMenu}
          style={{
            borderRadius: AGENT_CARD.balloonRadius,
            borderColor: balloonBorder,
            background: `linear-gradient(160deg, ${color}24, transparent 55%), ${AGENT_CARD.balloonFill}`,
            boxShadow: '0 10px 28px rgba(0,0,0,0.45)',
          }}
        >
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            aria-busy={busy}
            title={statusDetail}
            className={`flex shrink-0 items-center gap-1.5 border-b border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-[12px] font-medium leading-4 ${statusColor}`}
          >
            {busy ? (
              // 진행 표시는 동작 줄이기에서도 멈추지 않고 더 천천히 회전한다.
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:[animation-duration:2s]" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-9-9" />
              </svg>
            ) : <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />}
            <span className="min-w-0 truncate">{statusText}</span>
          </div>
          <AgentCardTaskControls book={tasks.entry.book} title={taskTitle}
            disabled={!tasks.projectId || !tasks.entry.book || sending || reserving}
            canCopy={linked.length > 0 && linked.every((node) => !!getInternalApp(node.appId)?.taskDocument)}
            mode={taskMode} error={tasks.entry.error} choosing={destinationChoice !== null}
            begin={beginTask}
            select={(taskId) => { if (tasks.projectId) void selectCardTask(tasks.projectId, agentId, taskId).catch(taskError); }}
            cancel={() => useCardTaskStore.getState().patch(tasks.key, { mode: undefined, error: undefined })}
            restore={() => { if (tasks.projectId) void restoreCardTaskDraft(tasks.projectId, agentId).catch(taskError); }}
            choose={(destination) => {
              const text = destinationChoice;
              setDestinationChoice(null);
              if (text === null) return;
              if (destination === 'new') submitNewTask('new', text, true); else sendCurrent(text);
            }} />
          <textarea
            {...IME_ENTER_OWNER}
            data-text-menu="own"
            onContextMenu={handleFieldContextMenu}
            value={pendingTask ? pendingTask.text : draft}
            readOnly={!!pendingTask || reserving}
            onChange={(e) => { setDestinationChoice(null); useGraphStore.getState().setAgentSessionInputText(agentId, inputSessionId, e.target.value); }}
            onFocus={() => setTyping(true)}
            onBlur={() => setTyping(false)}
            onKeyDown={(e) => {
              // 캔버스 단축키(Delete 등)가 글을 치는 손을 가로채지 않게.
              e.stopPropagation();
              // §6 — Enter 보내기 / Shift+Enter 줄바꿈. 조합 중 Enter 도 확정 뒤엔 보내기다.
              if (onEnterKey(e)) return;
              if (isComposingKeyEvent(e.nativeEvent)) return;
              if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur(); }
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            placeholder={t(taskMode ? 'canvas.agentCard.tasks.placeholder' : activeTask ? 'canvas.agentCard.tasks.editPlaceholder' : 'canvas.agentCard.placeholder')}
            aria-label={t('canvas.agentCard.inputLabel', { name: data.label })}
            spellCheck={false}
            className="nodrag nowheel nopan min-h-0 w-full flex-1 resize-none bg-transparent px-3 pt-2.5 text-[13px] leading-[1.45] text-gray-100 outline-none placeholder:text-gray-500"
          />

          {/* 아래 줄 — 위성 칩(이번 명령에 넣을 앱 노드 — 궤도 점과 같은 색) · 보내기 */}
          <div className="flex shrink-0 items-center gap-1.5 px-2 pb-2 pt-1">
            <div className="nowheel flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
              {linked.length === 0 ? (
                <span className="truncate px-1 text-[12px] text-gray-500">{t('canvas.agentCard.linkHint')}</span>
              ) : linked.map((b) => {
                const app = getInternalApp(b.appId);
                const glow = app?.glow ?? color;
                const appName = app ? t(app.nameKey, { defaultValue: app.name }) : b.appId;
                const label = appNodeLabel(b, appName);
                const off = excluded.has(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExcluded((prev) => {
                        const next = new Set(prev);
                        if (next.has(b.id)) next.delete(b.id); else next.add(b.id);
                        return next;
                      });
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                    aria-pressed={!off}
                    title={off ? t('canvas.agentCard.chipOff', { name: label }) : t('canvas.agentCard.chipOn', { name: label })}
                    className={`nodrag nopan flex max-w-[112px] shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px] transition-colors ${
                      off
                        ? 'border-white/10 text-gray-500 hover:text-gray-300'
                        : 'border-white/15 bg-white/[0.06] text-gray-200 hover:bg-white/[0.12]'
                    }`}
                  >
                    {/* 위성 점 — 넣으면 앱 색으로 찬 점, 빼면 속이 빈 고리(궤도 위 점과 같은 표시). */}
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={off ? { boxShadow: `inset 0 0 0 1px ${glow}` } : { background: glow, boxShadow: `0 0 6px ${glow}99` }}
                    />
                    <span className={`min-w-0 truncate ${off ? 'line-through' : ''}`}>{label}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); send(); }}
              onDoubleClick={(e) => e.stopPropagation()}
              disabled={!canSend}
              title={t('canvas.agentCard.send')}
              aria-label={t('canvas.agentCard.send')}
              className="nodrag nopan flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-white transition-colors disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-gray-600"
              style={canSend ? { background: color } : undefined}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>

        {/* 꼬리 — 원을 가리킨다. 같은 바탕·같은 테두리 두 변으로 말풍선 테두리를 덮어 한 몸으로 보이게. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rotate-45 transition-[border-color] duration-150"
          style={{
            left: AGENT_CARD.balloonWidth - AGENT_CARD.tailSize / 2,
            top: AGENT_CARD.height / 2 - AGENT_CARD.tailSize / 2,
            width: AGENT_CARD.tailSize,
            height: AGENT_CARD.tailSize,
            background: AGENT_CARD.balloonFill,
            borderTop: `1px solid ${balloonBorder}`,
            borderRight: `1px solid ${balloonBorder}`,
          }}
        />
      </div>

      {/* 궤도 — 흐린 점선 원과 이어진 앱 점들. 에이전트가 도는 동안 천천히 돈다(감싼 div 를 돌린다). */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute ${running ? 'agent-orbit-spin' : ''}`}
        style={{ left: disc.x - orbitR, top: disc.y - orbitR, width: orbitR * 2, height: orbitR * 2 }}
      >
        <div
          className="absolute inset-0 rounded-full border border-dashed"
          style={{ borderColor: running ? `${color}B3` : 'rgba(255,255,255,0.18)' }}
        />
        {dotAngles.map((deg, i) => {
          const b = linked[i];
          if (!b) return null;
          const glow = getInternalApp(b.appId)?.glow ?? color;
          const off = excluded.has(b.id);
          const p = orbitPoint(deg);
          return (
            <span
              key={b.id}
              className="absolute rounded-full"
              style={{
                left: orbitR + p.x - AGENT_CARD.orbitDotSize / 2,
                top: orbitR + p.y - AGENT_CARD.orbitDotSize / 2,
                width: AGENT_CARD.orbitDotSize,
                height: AGENT_CARD.orbitDotSize,
                background: off ? AGENT_CARD.balloonFill : glow,
                boxShadow: off ? `inset 0 0 0 1px ${glow}` : `0 0 6px ${glow}AA`,
              }}
            />
          );
        })}
      </div>

      {/* 원 — 접혀 남은 버블. 끌기 손잡이이자 상태 링(버블 링과 같은 규칙). 상태 글자는 툴팁. */}
      <div
        ref={discRef}
        data-agent-card-disc
        {...DARK_THEME_LOCK}
        data-bubble-skin={skin}
        className={`bubble-body absolute flex cursor-grab items-center justify-center rounded-full border-2 active:cursor-grabbing ${ringClass}`}
        {...gesture.handlers}
        onPointerUp={handlePointerUp}
        onDoubleClick={() => gesture.cancelPendingSelect()}
        onContextMenu={handleContextMenu}
        title={discTitle}
        style={{
          left: disc.x - discR,
          top: disc.y - discR,
          width: AGENT_CARD.discSize,
          height: AGENT_CARD.discSize,
          ...surface.body,
        }}
      >
        <BubbleSurfaceDetail surface={surface} />
        <EngineGlyph engine={engine} className="h-6 w-6 shrink-0 text-white/90" />
      </div>

      {/* 원 지름에만 맞춘 공통 상태 효과. 선택 고리는 별도 면으로 두어 상태 그림자를 덮지 않는다. */}
      <div
        aria-hidden="true"
        data-agent-card-status={status}
        className="pointer-events-none absolute"
        style={{ left: disc.x - discR, top: disc.y - discR, width: AGENT_CARD.discSize, height: AGENT_CARD.discSize }}
      >
        <BubbleStatusEffects status={status} glow={bubbleStyle.glow} />
        {selectionShadow && (
          <span className="pointer-events-none absolute inset-0 z-10 rounded-full" style={{ boxShadow: selectionShadow }} />
        )}
      </div>

      <BubbleHiddenIndicator
        bubblesHidden={data.bubblesHidden}
        linksHidden={data.linksHidden}
        style={{ left: disc.x - discR * Math.SQRT1_2 - 8, top: disc.y + discR * Math.SQRT1_2 - 8 }}
        {...gesture.handlers}
        onPointerUp={handlePointerUp}
        onDoubleClick={() => gesture.cancelPendingSelect()}
        onContextMenu={handleContextMenu}
      />

      {/* 권한 대기 종 — 버블과 같은 표식(원 오른쪽 위). */}
      {status === 'awaiting_permission' && (
        <div
          className="pointer-events-none absolute z-20 flex h-4 w-4 animate-pulse items-center justify-center rounded-full border border-amber-300 bg-amber-500/90 text-amber-50"
          style={{ left: disc.x + discR - 12, top: disc.y - discR - 2 }}
          title={t('common.bubble.awaitingPermission')}
          aria-label={t('common.bubble.awaitingPermission')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-2.5 w-2.5" aria-hidden="true">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
        </div>
      )}

      {/* §5.4 #36 (I) — 앱 작업 보기에서 접힌 버블 수(회색 숫자 점 · 표시 전용). 궤도 왼쪽 위 — 위성 손잡이(오른쪽 위)·
          이어진 앱 점(오른쪽 아래)·꼬리(왼쪽 가운데)를 피한다. */}
      {appWorkFolded && appWorkFolded.count > 0 ? (
        <span
          className="absolute z-20 flex items-center justify-center rounded-full border border-gray-500/70 bg-gray-800 font-semibold leading-none tabular-nums text-gray-200"
          style={{
            left: disc.x + foldedSeat.x - FOLDED_DOT / 2,
            top: disc.y + foldedSeat.y - FOLDED_DOT / 2,
            minWidth: FOLDED_DOT,
            height: FOLDED_DOT,
            padding: '0 4px',
            fontSize: 12,
          }}
          title={appWorkFoldedTitle}
          aria-label={appWorkFoldedTitle}
        >
          {appWorkFolded.count}
        </span>
      ) : null}

      {/* 이름 — 원 아래(버블 문법). 이것도 끌기 손잡이다(같은 선택 상태기계·같은 우클릭·더블클릭 IDE). */}
      <div
        className="bubble-body absolute cursor-grab truncate text-center text-[12px] font-medium leading-[14px] text-gray-200 active:cursor-grabbing"
        {...gesture.handlers}
        onPointerUp={handlePointerUp}
        onDoubleClick={() => gesture.cancelPendingSelect()}
        onContextMenu={handleContextMenu}
        title={data.label}
        style={{ left: disc.x - labelWidth / 2, width: labelWidth, top: disc.y + orbitR + AGENT_CARD.labelGap }}
      >
        {data.label}
      </div>

      {/* 위성 손잡이 — 궤도 위 흰 점. 끌면 위성줄, 누르면 원 오른쪽에 꽃(앱 고르기). `+` 단자 ❌. */}
      <button
        type="button"
        onPointerDown={onSatellitePointerDown}
        onDoubleClick={(e) => e.stopPropagation()}
        // 손잡이 위 우클릭도 같은 에이전트 메뉴다 — 어디서 우클릭해도 [버블로 되돌리기]에 닿는다.
        onContextMenu={(e) => { e.stopPropagation(); handleContextMenu(e); }}
        title={t('canvas.agentCard.handleTitle')}
        aria-label={t('canvas.agentCard.handleTitle')}
        className="nodrag nopan group/sat absolute z-10 flex cursor-grab items-center justify-center rounded-full active:cursor-grabbing"
        style={{
          left: disc.x + sat.x - AGENT_CARD.satelliteHitSize / 2,
          top: disc.y + sat.y - AGENT_CARD.satelliteHitSize / 2,
          width: AGENT_CARD.satelliteHitSize,
          height: AGENT_CARD.satelliteHitSize,
        }}
      >
        <span
          aria-hidden="true"
          className={`block rounded-full bg-slate-50 transition-[scale,box-shadow] duration-150 group-hover/sat:scale-[1.35] ${dragging ? 'scale-[1.35]' : ''}`}
          style={{
            width: AGENT_CARD.satelliteSize,
            height: AGENT_CARD.satelliteSize,
            boxShadow: `0 0 0 2px ${color}, 0 0 ${dragging ? 14 : 8}px ${color}${dragging ? 'CC' : '80'}`,
          }}
        />
      </button>
    </div>
  );
});

/**
 * 캔버스의 `bubble` 노드 — 형태만 갈라 그린다(§5.4 #36 (A)).
 *
 * 노드 타입을 새로 만들지 않는 이유: 선택·삭제·Task Edge·더블클릭 IDE·무리 강조·체크포인트가 전부
 * `bubble` 타입을 기준으로 돌기 때문이다. 오버레이 위젯(§5.5 #17-6) 안에서는 늘 버블이다(그 창은 말을 거는
 * 자리가 아니라 지켜보는 자리다).
 */
export const CanvasBubbleNode = memo(function CanvasBubbleNode(props: NodeProps): React.JSX.Element {
  const data = props.data as unknown as BubbleData & Record<string, unknown>;
  // 말풍선은 메인 뷰에서만 — 폴더·워크트리·휴지통 안은 앱 노드도 없고 고르는 자리다(판정은 결과 한 글자만 구독).
  const mainView = useGraphStore((s) => isMainCanvasView(s));
  if (mainView && isAgentCardForm(data) && data['_overlayMode'] !== true) {
    return <AgentCardNode {...(props as CardNodeProps)} />;
  }
  return <BubbleNode {...(props as unknown as React.ComponentProps<typeof BubbleNode>)} />;
});
