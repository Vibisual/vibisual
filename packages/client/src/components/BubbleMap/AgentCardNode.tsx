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
import { codexProviderOf } from '../Codex/codexModelEntry.js';
import { localProviderOf } from '../LocalModel/localModelEntry.js';
import { BubbleNode } from './BubbleNode.js';
import { BUBBLE_MENU_EVENT, type BubbleMenuRequest } from './BubbleContextMenu.js';
import { isInteractiveTarget, useBubbleSelectGesture } from './bubbleSelectGesture.js';
import { shouldDismissOnSelect } from './agentDismiss.js';
import { isMainCanvasView } from './canvasScope.js';
import { linkFocusNodeStyle } from './linkedBubbles.js';
import { BRAND_ICON_PATHS } from './brandIconPaths.js';
import {
  appNodeLabel,
  isAgentCardForm,
  linkedAppBubblesKey,
  linkedAppBubblesOf,
  pickCardSession,
  withLinkedOutputBrief,
  type LinkedOutputNode,
} from './agentCard.js';

/**
 * AgentCardNode.tsx — §5.4 #36 (A) **에이전트 입력 카드.**
 *
 * 커스텀 에이전트 버블을 우클릭하면 같은 자리에서 이 판으로 바뀐다. 캔버스에서 **바로 말을 거는 자리**다 —
 * IDE 를 열지 않고 한 줄을 보내고, 오른쪽 `+` 로 우리 앱 노드(영상·소리·3D·이미지)를 끌어 잇는다(§5.4 #36 (B)).
 *
 * 노드 타입은 여전히 `bubble` 이다(`CanvasBubbleNode` 가 형태만 갈라 그린다). 그래야 선택·삭제·Task Edge·
 * 더블클릭 IDE·무리 강조가 버블과 **한 벌**로 돈다 — 카드만의 길을 새로 깔면 버블에서 고친 것이 카드에서 샌다.
 *
 * 생김새는 이 앱의 것이다 — 이름("입력 카드")·Lucide 글리프·우리 상태 색·에이전트 색. 남의 화면 자산 ❌(§5.4 #36 (D)).
 */

/** 버블 링과 같은 상태 규칙의 판 테두리(클래스). 실행 중은 에이전트 색이라 인라인으로 준다. */
function statusBorderClass(status: BubbleData['status']): string {
  if (status === 'awaiting_permission') return 'border-amber-400';
  if (status === 'error') return 'border-rose-500';
  if (status === 'completed') return 'border-cyan-400';
  if (status === 'active') return '';
  return 'border-white/15';
}

/** 라벨 옆 상태 점의 색(클래스). */
function statusDotClass(status: BubbleData['status']): string {
  if (status === 'awaiting_permission') return 'bg-amber-400 animate-pulse';
  if (status === 'error') return 'bg-rose-500';
  if (status === 'completed') return 'bg-cyan-400';
  if (status === 'active') return 'bg-sky-400 animate-pulse';
  return 'bg-gray-500';
}

/** 판 바깥 라벨의 엔진 글리프 — 버블이 쓰는 그 브랜드 로고(같은 정체는 어디서 보든 같은 그림). */
function EngineGlyph({ engine }: { engine: 'claude' | 'codex' | 'local' }): React.JSX.Element {
  if (engine === 'local') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
        <rect x="6" y="6" width="12" height="12" rx="2" />
        <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
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

type CardNodeProps = NodeProps & { data: BubbleData & Record<string, unknown> };

/**
 * 방금 형태를 바꾼 에이전트 — 원 → 판 전이는 **바꾼 그 순간에만** 돈다. 캔버스는 화면 밖 노드를 내렸다가
 * 다시 올리므로(§4 v3.71 컬링) 마운트마다 돌리면 팬할 때마다 카드가 원에서 다시 퍼진다.
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

export const AgentCardNode = memo(function AgentCardNode({ data }: CardNodeProps): React.JSX.Element {
  const { t } = useTranslation();
  const agentId = data.id;

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

  // ── 초안 — IDE 입력창과 같은 칸(카드에서 치던 글이 IDE 에서 이어진다) ──
  const draft = useGraphStore((s) => s.agentSessionInputs[agentSessionInputKey(agentId, sessionId)]?.text ?? '');

  // ── 참조 칩 — 이 에이전트를 참조하는 앱 노드들(지문 구독 → getState 재구성) ──
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
  const send = useCallback((live?: string): void => {
    const text = (live ?? draft).trim();
    if (!text) return;
    const st = useGraphStore.getState();
    st.addCommand(agentId, withLinkedOutputBrief(text, outputNodes), sessionId);
    st.setAgentSessionInputText(agentId, sessionId, '');
  }, [draft, agentId, sessionId, outputNodes]);
  const onEnterKey = useEnterSubmit(send);

  // ── 선택 — 버블과 같은 상태기계(클릭 선택·확인 dismiss·더블클릭 IDE) ──
  const linkModifierHeld = useLinkFocusStore((s) => s.modifierHeld);
  const performSelect = useCallback((): void => {
    useGraphStore.getState().selectNode(agentId);
    if (shouldDismissOnSelect(data.status)) {
      fetch('/api/dismiss-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      }).catch(() => {});
    }
  }, [agentId, data.status]);
  const gesture = useBubbleSelectGesture({
    doubleClickable: true,
    leftButtonOnly: false,
    select: performSelect,
    setIntent: (active) => useGraphStore.getState().setSelectIntent(active ? agentId : null),
    ignore: (e) => {
      // §5.4 #31 — Ctrl/Cmd 를 쥔 채 누르면 무리 잡기다(버블과 같다).
      if (linkModifierHeld) {
        promoteLinkGrab(agentId);
        return true;
      }
      // 입력칸·칩·버튼 위의 누름은 선택이 아니다 — 글을 치려던 손이 판을 고르지 않게.
      return isInteractiveTarget(e.target);
    },
  });
  const handlePointerUp = useCallback((e: React.PointerEvent): void => {
    gesture.handlers.onPointerUp(e);
    releaseLinkGrab();
  }, [gesture]);

  // ── 우클릭 — 카드 위(입력칸 밖)는 #34 메뉴(맨 위 [버블로 접기]). 입력칸은 전역 입력칸 메뉴가 가져간다 ──
  const handleContextMenu = useCallback((e: React.MouseEvent): void => {
    e.preventDefault();
    gesture.selectNow();
    window.dispatchEvent(new CustomEvent<BubbleMenuRequest>(BUBBLE_MENU_EVENT, {
      detail: { nodeId: agentId, screenX: e.clientX, screenY: e.clientY },
    }));
  }, [agentId, gesture]);

  // ── `+` 손잡이 — 누르면 참조선 한 가닥이 시작된다(놓기 판정은 `BubbleMap` 이 한다) ──
  const handleRef = useRef<HTMLButtonElement>(null);
  const onHandlePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    useRefLinkDragStore.getState().start({
      agentId,
      startX: r.left + r.width / 2,
      startY: r.top + r.height / 2,
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
  /** 이 마운트가 방금 바꾼 형태인가 — 그때만 원에서 판으로 퍼진다. */
  const [morph] = useState(() => consumeFormChange(agentId));
  const status = data.status;
  const statusText = status === 'active'
    ? t('canvas.agentCard.status.active')
    : status === 'awaiting_permission'
      ? t('canvas.agentCard.status.waiting')
      : status === 'completed'
        ? t('canvas.agentCard.status.completed')
        : status === 'error'
          ? t('canvas.agentCard.status.error')
          : t('canvas.agentCard.status.idle');

  const frameShadow = [
    '0 10px 28px rgba(0,0,0,0.45)',
    status === 'active' ? `0 0 0 1px ${color}99, 0 0 22px ${color}40` : null,
    showRing ? `0 0 0 2px #FFFFFF, 0 0 0 6px ${color}4D` : null,
    linkVisual.boxShadow,
  ].filter(Boolean).join(', ');

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
      {/* 선의 끝점 계산용 숨은 손잡이 — 버블과 같은 자리(가운데). 끝점은 선이 판 테두리에서 끊는다. */}
      <Handle type="source" id="src" position={Position.Top} style={HANDLE_STYLE} isConnectable={false} />
      <Handle type="target" id="tgt" position={Position.Top} style={HANDLE_STYLE} isConnectable={false} />

      {/* 판 바깥 위 라벨 — 무엇이 말을 받는지(엔진 글리프·이름·상태). 판 안은 대부분 입력칸이라, 이 라벨이
          판과 함께 **끌기 손잡이**다(같은 선택 상태기계·같은 우클릭·더블클릭 IDE). */}
      <div
        className="bubble-body absolute left-1 right-1 flex cursor-grab items-center gap-1.5 text-[12px] leading-none text-gray-300 active:cursor-grabbing"
        style={{ bottom: `calc(100% + ${AGENT_CARD.labelGap}px)` }}
        {...gesture.handlers}
        onPointerUp={handlePointerUp}
        onDoubleClick={() => gesture.cancelPendingSelect()}
        onContextMenu={handleContextMenu}
      >
        <span className="text-gray-400"><EngineGlyph engine={engine} /></span>
        <span className="min-w-0 truncate font-medium text-gray-200">{data.label}</span>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass(status)}`} aria-hidden="true" />
        <span className="shrink-0 text-gray-500">{statusText}</span>
      </div>

      {/* 판 — 끌기 손잡이(`.bubble-body`)이자 입력 자리. 원에서 판으로 퍼지며 나타난다. */}
      <div
        className={`bubble-body ${morph ? 'agent-card-morph ' : ''}absolute inset-0 flex flex-col overflow-hidden border ${statusBorderClass(status)}`}
        {...gesture.handlers}
        onPointerUp={handlePointerUp}
        onDoubleClick={() => gesture.cancelPendingSelect()}
        onContextMenu={handleContextMenu}
        style={{
          borderRadius: AGENT_CARD.radius,
          borderColor: status === 'active' ? color : undefined,
          background: `linear-gradient(160deg, ${color}26, transparent 58%), rgba(9,11,17,0.94)`,
          boxShadow: frameShadow,
        }}
      >
        <textarea
          {...IME_ENTER_OWNER}
          value={draft}
          onChange={(e) => useGraphStore.getState().setAgentSessionInputText(agentId, sessionId, e.target.value)}
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

        {/* 아래 줄 — 참조 칩(이번 명령에 넣을 노드) · 보내기 */}
        <div className="flex shrink-0 items-center gap-1.5 px-2 pb-2 pt-1">
          <div className="nowheel flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
            {linked.length === 0 ? (
              <span className="truncate px-1 text-[12px] text-gray-500">{t('canvas.agentCard.linkHint')}</span>
            ) : linked.map((b) => {
              const app = getInternalApp(b.appId);
              const Icon = app?.icon;
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
                  className={`nodrag nopan flex max-w-[112px] shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[12px] transition-colors ${
                    off
                      ? 'border-white/10 text-gray-500 opacity-60 hover:opacity-90'
                      : 'border-white/15 bg-white/[0.06] text-gray-200 hover:bg-white/[0.12]'
                  }`}
                >
                  {Icon && <span className="[&>svg]:h-3 [&>svg]:w-3" style={{ color: app?.glow }}><Icon /></span>}
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

      {/* `+` 손잡이 — 판 오른쪽 가운데, 반쯤 밖으로. 끌면 참조선, 누르면 그 자리 목록. */}
      <button
        ref={handleRef}
        type="button"
        onPointerDown={onHandlePointerDown}
        onDoubleClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
        title={t('canvas.agentCard.handleTitle')}
        aria-label={t('canvas.agentCard.handleTitle')}
        className={`nodrag nopan absolute top-1/2 z-10 flex items-center justify-center rounded-full border bg-gray-950 text-gray-200 shadow-md shadow-black/50 transition-[transform,border-color,box-shadow] duration-150 hover:scale-110 ${
          dragging ? 'scale-110' : ''
        }`}
        style={{
          right: -AGENT_CARD.handleSize / 2,
          width: AGENT_CARD.handleSize,
          height: AGENT_CARD.handleSize,
          marginTop: -AGENT_CARD.handleSize / 2,
          borderColor: dragging ? color : 'rgba(255,255,255,0.55)',
          boxShadow: dragging ? `0 0 12px ${color}99` : undefined,
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
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
  // 카드는 메인 뷰에서만 — 폴더·워크트리·휴지통 안은 앱 노드도 없고 고르는 자리다(판정은 결과 한 글자만 구독).
  const mainView = useGraphStore((s) => isMainCanvasView(s));
  if (mainView && isAgentCardForm(data) && data['_overlayMode'] !== true) {
    return <AgentCardNode {...(props as CardNodeProps)} />;
  }
  return <BubbleNode {...(props as unknown as React.ComponentProps<typeof BubbleNode>)} />;
});
