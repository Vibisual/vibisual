import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import type { BubbleData } from '@vibisual/shared';
import { AGENT_CARD, BUBBLE_STYLES, LINK_FOCUS } from '@vibisual/shared';
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
import { BUBBLE_MENU_EVENT, type BubbleMenuRequest } from './BubbleContextMenu.js';
import { isInteractiveTarget, useBubbleSelectGesture } from './bubbleSelectGesture.js';
import { useCanvasNodeSelection } from './useCanvasNodeSelection.js';
import { shouldDismissOnSelect } from './agentDismiss.js';
import { isMainCanvasView } from './canvasScope.js';
import { linkFocusNodeStyle } from './linkedBubbles.js';
import { BRAND_ICON_PATHS } from './brandIconPaths.js';
import { composeLinkedBriefs } from './linkedNodeBriefs.js';
import {
  agentCardDiscCenter,
  appNodeLabel,
  isAgentCardForm,
  linkedAppBubblesKey,
  linkedAppBubblesOf,
  orbitDotAngles,
  orbitPoint,
  pickCardSession,
  withLinkedOutputBrief,
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

/** 원의 링 — 버블 링과 같은 상태 규칙(클래스). 실행 중·평시는 에이전트 색이라 인라인으로 준다(빈 문자열). */
function statusRingClass(status: BubbleData['status']): string {
  if (status === 'awaiting_permission') return 'border-amber-400';
  if (status === 'error') return 'border-rose-500';
  if (status === 'completed') return 'border-cyan-400';
  return '';
}

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
  // 빈 문자열도 "지정 안 함"이다(`BubbleNode` 와 같은 판정 — `if (!customColor)`).
  const color = customColor || (isCodex ? '#8B5CF6' : BUBBLE_STYLES.agent.color);
  const engine: 'claude' | 'codex' | 'local' = isLocal ? 'local' : isCodex ? 'codex' : 'claude';

  // ── 보낼 세션 — 버블이 보여 주는 세션과 같은 우선순위 ──
  const subs = useGraphStore((s) => s.subAgents[agentId]);
  const ideActive = useGraphStore((s) => selectIDEActiveSessionForAgent(s, agentId));
  const sticky = useGraphStore((s) => s.selectedSubByAgent[agentId]);
  const sessionId = useMemo(() => pickCardSession(subs, ideActive, sticky), [subs, ideActive, sticky]);

  // ── 초안 — IDE 입력창과 같은 칸(말풍선에서 치던 글이 IDE 에서 이어진다) ──
  const draft = useGraphStore((s) => s.agentSessionInputs[agentSessionInputKey(agentId, sessionId)]?.text ?? '');

  // ── 위성 칩 — 이 에이전트를 참조하는 앱 노드들(지문 구독 → getState 재구성) ──
  const activeProject = useGraphStore((s) => s.activeProject);
  const linkKey = useGraphStore((s) => linkedAppBubblesKey(s.appBubbles, agentId, s.activeProject));
  const linked = useMemo(
    () => linkedAppBubblesOf(useGraphStore.getState().appBubbles, agentId, activeProject),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [linkKey, agentId, activeProject],
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
  const send = useCallback((live?: string): void => {
    const text = (live ?? draft).trim();
    if (!text) return;
    useGraphStore.getState().setAgentSessionInputText(agentId, sessionId, '');
    void composeLinkedBriefs(outputNodes).then((nodes) => {
      useGraphStore.getState().addCommand(agentId, withLinkedOutputBrief(text, nodes), sessionId);
    });
  }, [draft, agentId, sessionId, outputNodes]);
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
  const running = status === 'active';
  const statusText = status === 'active'
    ? t('canvas.agentCard.status.active')
    : status === 'awaiting_permission'
      ? t('canvas.agentCard.status.waiting')
      : status === 'completed'
        ? t('canvas.agentCard.status.completed')
        : status === 'error'
          ? t('canvas.agentCard.status.error')
          : t('canvas.agentCard.status.idle');
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
  /** 이름 폭 — 원을 가운데로 말풍선 끝까지(말풍선 위로 넘어가지 않게). */
  const labelWidth = 2 * (disc.x - AGENT_CARD.balloonWidth);
  const balloonBorder = typing ? `${color}99` : BALLOON_BORDER_IDLE;

  const ringClass = statusRingClass(status);
  const discShadow = [
    running ? `0 0 18px ${color}80` : null,
    // §6 — 묶음에 든 카드도 같은 고리다(버블의 묶음 고리와 같은 말 — 흰 고리 + 제 색 번짐).
    //   §4 앱 테마 — 흰 고리는 "앞쪽" 색 변수라 라이트 캔버스에서는 어두워진다(기본 테마는 종전 그대로 흰색).
    showRing || selected === true ? `0 0 0 2px var(--color-white), 0 0 0 6px ${color}4D` : null,
    linkVisual.boxShadow,
  ].filter(Boolean).join(', ') || undefined;

  const canSend = draft.trim().length > 0;

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
          <textarea
            {...IME_ENTER_OWNER}
            data-text-menu="own"
            onContextMenu={handleFieldContextMenu}
            value={draft}
            onChange={(e) => useGraphStore.getState().setAgentSessionInputText(agentId, sessionId, e.target.value)}
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
            placeholder={t('canvas.agentCard.placeholder')}
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
          borderColor: ringClass ? undefined : running ? color : `${color}99`,
          background: `radial-gradient(circle at 35% 35%, ${color}66, ${color}26)`,
          boxShadow: discShadow,
        }}
      >
        <EngineGlyph engine={engine} className="h-6 w-6 shrink-0 text-white/90" />
      </div>

      {/* 권한 대기 종 — 버블과 같은 표식(원 오른쪽 위). */}
      {status === 'awaiting_permission' && (
        <div
          className="pointer-events-none absolute flex h-4 w-4 animate-pulse items-center justify-center rounded-full border border-amber-300 bg-amber-500/90 text-amber-50"
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
