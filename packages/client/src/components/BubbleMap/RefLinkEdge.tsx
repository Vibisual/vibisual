import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EdgeLabelRenderer, useInternalNode, type EdgeProps, type InternalNode } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { BUBBLE_STYLES, LINK_FOCUS, REF_LINK_STYLE } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { useLinkEdgeRole, useLinkFocusPhase } from '../../stores/linkFocus.js';
import { getInternalApp } from '../../apps/registry.js';
import { formChangeMove } from '../../apps/appNodeForm.js';
import { codexProviderOf } from '../Codex/codexModelEntry.js';
import { linkFocusEdgeStyle } from './linkedBubbles.js';
import { refLinkEnds, refLinkPath, type NodeBox } from './agentCard.js';
import { RefDock, RefTether } from './RefTether.js';

/**
 * RefLinkEdge.tsx — §5.4 #36 (B) **위성줄.** 에이전트(말풍선의 원·버블)에서 그 에이전트를 참조하는 앱 노드로.
 *
 * 기존 두 선과 **일부러 다르다** — 파일 선은 회색 곡선 + 화살촉, Task Edge 는 파란 점선 + 가운데 원 아이콘이다.
 * 이 줄은 원 중심에서 앱 노드 중심을 향해 곧게 나가 아래로 살짝 처지는 가는 실에 구슬이 꿰인 모양이다.
 * 색은 에이전트 색에서 **그 앱의 색**으로 넘어가고, 앱 쪽 끝은 도킹 고리다. 에이전트가 도는 동안만 구슬이
 * 에이전트 → 앱 쪽으로 흐른다. 그리기는 `RefTether` 한 벌(끄는 중 미리보기·보류 줄과 같다).
 * 줄 위에 손을 올리면 구슬이 밝아지고 가운데에 [연결 끊기] 원 단추가 뜬다.
 */

/** 단추가 사라지기까지의 여유 — 줄에서 단추로 손을 옮기는 사이에 꺼지지 않게. */
const HOVER_LEAVE_MS = 220;

/** 노드의 실측 상자(중심·반폭·반높이). 아직 재지 않았으면 null — 그 프레임은 그리지 않는다. */
function boxOf(node: InternalNode | undefined): NodeBox | null {
  if (!node) return null;
  const w = node.measured?.width;
  const h = node.measured?.height;
  if (typeof w !== 'number' || typeof h !== 'number' || w <= 0 || h <= 0) return null;
  const { x, y } = node.internals.positionAbsolute;
  return { cx: x + w / 2, cy: y + h / 2, halfW: w / 2, halfH: h / 2 };
}

export interface RefLinkEdgeData extends Record<string, unknown> {
  agentId: string;
  appBubbleId: string;
}

export const RefLinkEdge = memo(function RefLinkEdge({ id, source, target, data }: EdgeProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const d = data as RefLinkEdgeData | undefined;
  const agentId = d?.agentId ?? source;
  const appBubbleId = d?.appBubbleId ?? target;

  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  // 출발 색 = 에이전트 색(사용자 지정 → 엔진 색 → 기본). 말풍선·버블과 같은 출처.
  const customColor = useGraphStore((s) => s.agentConfigs[agentId]?.color);
  const isCodex = useGraphStore((s) => codexProviderOf(s.agentConfigs[agentId]) !== null);
  const color = customColor || (isCodex ? '#8B5CF6' : BUBBLE_STYLES.agent.color);
  // 도착 색 = 그 앱의 색(레지스트리 선언 — 코어는 앱 이름을 모른다). 판정 결과(앱 id)만 구독한다.
  const appId = useGraphStore((s) => s.appBubbles.find((b) => b.id === appBubbleId)?.appId);
  const appColor = (appId ? getInternalApp(appId)?.glow : undefined) || REF_LINK_STYLE.fallbackColor;
  // 도는 동안만 구슬이 흐른다 — 판정 결과(불리언)만 구독한다.
  const running = useGraphStore((s) => s.agents.some((a) => a.id === agentId && a.status === 'active'));

  // §5.4 #31 — 무리 강조는 이 줄에도 곱한다(무리 밖이면 물러난다).
  const linkRole = useLinkEdgeRole(id);
  const linkPhase = useLinkFocusPhase();
  const focus = useMemo(() => linkFocusEdgeStyle(linkRole, linkPhase), [linkRole, linkPhase]);

  const [hover, setHover] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }, []);
  const enter = useCallback((): void => {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    setHover(true);
  }, []);
  const leave = useCallback((): void => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => { leaveTimer.current = null; setHover(false); }, HOVER_LEAVE_MS);
  }, []);
  const unlink = useCallback((e: React.MouseEvent): void => {
    e.stopPropagation();
    const store = useGraphStore.getState();
    const bubble = store.appBubbles.find((b) => b.id === appBubbleId);
    // §5.4 #36 (F) — 결과 없는 화면의 마지막 줄을 끊으면 명패로 돌아간다 — 가운데를 지키는 자리로 함께 옮긴다.
    const at = bubble
      ? formChangeMove(getInternalApp(bubble.appId), bubble, {
          linkedAgentIds: (bubble.linkedAgentIds ?? []).filter((id) => id !== agentId),
          file: bubble.file,
          ref: bubble.ref,
        })
      : null;
    store.unlinkAppBubbleAgent(appBubbleId, agentId, at);
  }, [appBubbleId, agentId]);

  const src = boxOf(sourceNode);
  const dst = boxOf(targetNode);
  if (!src || !dst) return null;

  const ends = refLinkEnds(src, dst);
  const geo = refLinkPath(ends.sx, ends.sy, ends.tx, ends.ty);
  const gradientId = `ref-link-grad-${id.replace(/[^\w-]/g, '')}`;

  return (
    <>
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={ends.sx} y1={ends.sy} x2={ends.tx} y2={ends.ty}>
          <stop offset="0%" stopColor={color} />
          <stop offset="100%" stopColor={appColor} />
        </linearGradient>
      </defs>
      <g
        style={{ opacity: focus.opacityMul, transition: `opacity ${LINK_FOCUS.TRANSITION_MS}ms ease-out` }}
        className="react-flow__ref-link"
      >
        <RefTether d={geo.path} stroke={`url(#${gradientId})`} bright={hover} flowing={running} widthMul={focus.widthMul} />
        {/* 끝 — 화살촉이 아니라 도킹 고리(위성이 걸린 자리). */}
        <RefDock x={ends.tx} y={ends.ty} color={appColor} />
        {/* 손을 올릴 자리 — 보이지 않는 넓은 선. */}
        <path
          d={geo.path}
          fill="none"
          stroke="transparent"
          strokeWidth={REF_LINK_STYLE.hitWidth}
          className="react-flow__edge-interaction"
          style={{ pointerEvents: 'stroke', cursor: 'default' }}
          onMouseEnter={enter}
          onMouseLeave={leave}
        />
      </g>
      {hover && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="nodrag nopan absolute flex h-5 w-5 items-center justify-center rounded-full border border-white/40 bg-gray-950 text-gray-300 shadow-md shadow-black/50 transition-colors hover:border-rose-400 hover:text-rose-300"
            style={{
              transform: `translate(-50%, -50%) translate(${geo.midX}px, ${geo.midY}px)`,
              pointerEvents: 'all',
            }}
            onMouseEnter={enter}
            onMouseLeave={leave}
            onClick={unlink}
            onDoubleClick={(e) => e.stopPropagation()}
            title={t('canvas.refLink.unlink')}
            aria-label={t('canvas.refLink.unlink')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
