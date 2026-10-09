import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EdgeLabelRenderer, useInternalNode, type EdgeProps, type InternalNode } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { BUBBLE_STYLES, LINK_FOCUS, REF_LINK_STYLE } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { useLinkEdgeRole, useLinkFocusPhase } from '../../stores/linkFocus.js';
import { codexProviderOf } from '../Codex/codexModelEntry.js';
import { linkFocusEdgeStyle } from './linkedBubbles.js';
import { refLinkEndpoints, refLinkPath } from './agentCard.js';

/**
 * RefLinkEdge.tsx — §5.4 #36 (B) **참조선.** 에이전트(카드·버블)에서 그 에이전트를 참조하는 앱 노드로.
 *
 * 기존 두 선과 **일부러 다르다** — 파일 선은 회색 곡선 + 화살촉, Task Edge 는 파란 점선 + 가운데 원 아이콘이다.
 * 이 선은 옆구리에서 나가 옆구리로 들어가는 수평 S 곡선, 에이전트 색 → 흰빛 그라디언트, 넓고 흐린 한 겹(글로우),
 * 끝은 작은 점이다. 에이전트가 도는 동안만 빛 한 점이 흐른다.
 *
 * 글로우는 SVG 필터가 아니라 **두 번째 path** 다 — 선마다 필터·마스크를 걸면 래스터가 포화한다(§5.4 #31 (K)).
 * 선 위에 손을 올리면 가운데에 [연결 끊기] 원 단추가 뜬다.
 */

/** 단추가 사라지기까지의 여유 — 선에서 단추로 손을 옮기는 사이에 꺼지지 않게. */
const HOVER_LEAVE_MS = 220;

interface Box {
  cx: number;
  cy: number;
  halfW: number;
  halfH: number;
}

/** 노드의 실측 상자(중심·반폭·반높이). 아직 재지 않았으면 null — 그 프레임은 그리지 않는다. */
function boxOf(node: InternalNode | undefined): Box | null {
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

  // 선 색 = 에이전트 색(사용자 지정 → 엔진 색 → 기본). 버블·카드와 같은 출처.
  const customColor = useGraphStore((s) => s.agentConfigs[agentId]?.color);
  const isCodex = useGraphStore((s) => codexProviderOf(s.agentConfigs[agentId]) !== null);
  const color = customColor || (isCodex ? '#8B5CF6' : BUBBLE_STYLES.agent.color);
  // 도는 동안만 빛이 흐른다 — 판정 결과(불리언)만 구독한다.
  const running = useGraphStore((s) => s.agents.some((a) => a.id === agentId && a.status === 'active'));

  // §5.4 #31 — 무리 강조는 이 선에도 곱한다(무리 밖이면 물러난다).
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
    useGraphStore.getState().unlinkAppBubbleAgent(appBubbleId, agentId);
  }, [appBubbleId, agentId]);

  const src = boxOf(sourceNode);
  const dst = boxOf(targetNode);
  if (!src || !dst) return null;

  const ends = refLinkEndpoints(src, dst);
  const geo = refLinkPath(ends.sx, ends.sy, ends.tx, ends.ty, ends.side);
  const gradientId = `ref-link-grad-${id.replace(/[^\w-]/g, '')}`;
  const opacity = focus.opacityMul;
  const width = REF_LINK_STYLE.lineWidth * focus.widthMul;

  return (
    <>
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={ends.sx} y1={ends.sy} x2={ends.tx} y2={ends.ty}>
          <stop offset="0%" stopColor={color} />
          <stop offset="100%" stopColor={REF_LINK_STYLE.endColor} />
        </linearGradient>
      </defs>
      <g
        style={{ opacity, transition: `opacity ${LINK_FOCUS.TRANSITION_MS}ms ease-out` }}
        className="react-flow__ref-link"
      >
        {/* 글로우 — 넓고 흐린 한 겹(필터 ❌). */}
        <path
          d={geo.path}
          fill="none"
          stroke={color}
          strokeWidth={REF_LINK_STYLE.glowWidth}
          strokeOpacity={hover ? REF_LINK_STYLE.glowActiveOpacity : REF_LINK_STYLE.glowOpacity}
          strokeLinecap="round"
          pointerEvents="none"
        />
        {/* 본선 — 에이전트 색에서 흰빛으로. */}
        <path
          d={geo.path}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={width}
          strokeLinecap="round"
          pointerEvents="none"
        />
        {/* 도는 동안 흐르는 빛 한 점(움직임 줄이기면 CSS 가 숨긴다). */}
        {running && (
          <path
            d={geo.path}
            fill="none"
            stroke={REF_LINK_STYLE.endColor}
            strokeWidth={width + 1}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${REF_LINK_STYLE.pulsePercent} ${100 - REF_LINK_STYLE.pulsePercent}`}
            className="ref-link-pulse"
            pointerEvents="none"
          />
        )}
        {/* 끝 — 화살촉이 아니라 작은 점(받는 쪽에 앉았다). */}
        <circle cx={ends.tx} cy={ends.ty} r={REF_LINK_STYLE.endDotRadius} fill={REF_LINK_STYLE.endColor} pointerEvents="none" />
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
