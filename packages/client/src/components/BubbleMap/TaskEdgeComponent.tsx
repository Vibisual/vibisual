import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseEdge, EdgeLabelRenderer, useInternalNode, type EdgeProps, type InternalNode } from '@xyflow/react';
import type { TaskEdgeStatus, TaskEdgeKind } from '@vibisual/shared';
import { TASK_EDGE_STYLES, TASK_EDGE_KIND_STYLES, TASK_EDGE_DEFAULTS, LINK_FOCUS, resolveBubbleEdgeStyle } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { useLinkEdgeRole, useLinkFocusPhase } from '../../stores/linkFocus.js';
import { linkFocusEdgeStyle } from './linkedBubbles.js';
import { computeTaskEdgePath, readRadiusFromData } from './taskEdgePath.js';
import { clipCurvePath } from './edgeOcclusion.js';
import { useEdgeOccluders } from './edgeOccluders.js';
import { isRectNode, nodeBorderDistance } from './agentCard.js';
import { bubbleEdgeAppearance, bubbleEdgeMarkerStyle } from './bubbleEdgeAppearance.js';

/** §5.4 #36 (A) — 끝 노드가 말풍선이면 그 방향 실루엣까지 거리, 아니면 null. 원 반지름으로 재면 위임 화살이 말풍선 안에 묻힌다. */
function rectReach(node: InternalNode | undefined, nx: number, ny: number): number | null {
  const w = node?.measured?.width;
  const h = node?.measured?.height;
  if (typeof w !== 'number' || typeof h !== 'number' || !isRectNode(w, h)) return null;
  return nodeBorderDistance(w, h, nx, ny);
}

/** path 를 따라 3회 날아가는 펄스 아이콘의 종류. */
type EdgePulseEvent = 'sending' | 'completed' | 'error';

const PULSE_CONFIG: Record<EdgePulseEvent, { color: string; labelKey: string }> = {
  sending: { color: '#60A5FA', labelKey: 'bubbleMap.taskEdge.pulse.sending' },
  completed: { color: '#34D399', labelKey: 'bubbleMap.taskEdge.pulse.completed' },
  error: { color: '#F87171', labelKey: 'bubbleMap.taskEdge.pulse.error' },
};

const PULSE_DURATION_MS = 1400;
const PULSE_REPEAT = 3;
const PULSE_TOTAL_MS = PULSE_DURATION_MS * PULSE_REPEAT;

/** 펄스 아이콘 — 이모지(📨📋⚠️) 대신 Lucide 톤 stroke SVG (currentColor 추종). */
function PulseIcon({ event, className }: { event: EdgePulseEvent; className?: string }): React.JSX.Element {
  const p = {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, className,
  };
  if (event === 'sending') {
    return <svg {...p}><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>;
  }
  if (event === 'completed') {
    return <svg {...p}><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /><path d="m9 14 2 2 4-4" /></svg>;
  }
  return <svg {...p}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>;
}

/** kind 아이콘 — command/artifact/request/critique 통합 stroke SVG (viewBox 0 0 24 24 통일). */
function KindIcon(
  { kind, className, style }: { kind: TaskEdgeKind; className?: string; style?: React.CSSProperties },
): React.JSX.Element {
  const { t } = useTranslation();
  const p = {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, className, style,
  };
  if (kind === 'critique') {
    return <svg {...p} aria-label={t('bubbleMap.taskEdge.critiqueIconLabel')}><path d="M2 12 Q12 4 22 12 Q12 20 2 12 Z" /><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /></svg>;
  }
  if (kind === 'artifact') {
    return <svg {...p}><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg>;
  }
  if (kind === 'request') {
    return <svg {...p}><polyline points="9 10 4 15 9 20" /><path d="M20 4v7a4 4 0 0 1-4 4H4" /></svg>;
  }
  return <svg {...p}><polygon points="7 4 19 12 7 20 7 4" /></svg>;
}

export const TaskEdgeComponent = memo(function TaskEdgeComponent({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps): React.JSX.Element {
  const { t } = useTranslation();
  const edgeData = data as Record<string, unknown> | undefined;
  const appearance = useGraphStore((s) => resolveBubbleEdgeStyle(
    s.bubbleAppearancePending?.edgeStyle ?? s.userDefaults?.appearance?.edgeStyle,
  ));
  const selectionFocusClassName = typeof edgeData?.['selectionFocusClassName'] === 'string'
    ? edgeData['selectionFocusClassName'] : undefined;
  // 모양은 kind 로만 — status 는 펄스 트리거로만 쓴다.
  const status = (edgeData?.['status'] as TaskEdgeStatus) ?? 'idle';
  const kind = (edgeData?.['kind'] as TaskEdgeKind | undefined) ?? TASK_EDGE_DEFAULTS.kind;
  const command = (edgeData?.['command'] as string) ?? '';
  const taskEdgeId = (edgeData?.['taskEdgeId'] as string) ?? '';
  const bundleId = (edgeData?.['bundleId'] as string | undefined) ?? undefined;
  const bundleRole = (edgeData?.['bundleRole'] as 'primary' | 'auto-artifact' | 'auto-rework' | undefined) ?? undefined;
  // §5.4 #36 (A) — 끝이 말풍선이면 반지름 대신 그 방향의 실루엣까지 거리(버블이면 data 의 반지름 그대로).
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const centerDx = targetX - sourceX;
  const centerDy = targetY - sourceY;
  const centerDist = Math.sqrt(centerDx * centerDx + centerDy * centerDy) || 1;
  const sourceRadius = rectReach(sourceNode, centerDx / centerDist, centerDy / centerDist)
    ?? readRadiusFromData(edgeData, 'sourceRadius');
  const targetRadius = rectReach(targetNode, -centerDx / centerDist, -centerDy / centerDist)
    ?? readRadiusFromData(edgeData, 'targetRadius');
  // 같은 source/target 쌍의 평행 엣지 분산 오프셋 (BubbleMap 에서 주입)
  const parallelOffset = typeof edgeData?.['parallelOffset'] === 'number'
    ? (edgeData['parallelOffset'] as number)
    : 0;
  // 타겟 원둘레 상 각도 분산 — 같은 타겟에 여러 엣지가 모일 때 endpoint(화살촉) 겹침 방지.
  // 소스 endpoint 는 항상 자연 각도 고정.
  const targetAngularOffset = typeof edgeData?.['targetAngularOffset'] === 'number'
    ? (edgeData['targetAngularOffset'] as number)
    : 0;

  const kindStyle = TASK_EDGE_KIND_STYLES[kind] ?? TASK_EDGE_KIND_STYLES.command;
  // idle 스타일의 dasharray 를 kind 와 무관한 고정 dash 로 사용 (status 무반응).
  const idleDash = TASK_EDGE_STYLES['idle']?.strokeDasharray ?? '6 4';
  // auto-rework 자매 엣지는 command 와 같은 스타일 — 구분은 같은 두 에이전트 사이 critique 엣지와 짝으로 보이는 것으로 충분하다.
  const lineColor = kindStyle.color;
  const iconColor = lineColor;

  const { path, curve, labelX, labelY } = computeTaskEdgePath({
    sourceX, sourceY, targetX, targetY, sourceRadius, targetRadius,
    offset: parallelOffset,
    targetAngularOffset,
  });
  // §5.4 #31 (K) — 선은 지나가는 버블 원 안에서 잘린다(종전 SVG 마스크 자리). 펄스는 아래에서
  //   잘리지 않은 `path` 를 그대로 따라간다 — 버블 밑에서도 날아가는 아이콘이 끊기지 않게.
  const occluders = useEdgeOccluders(curve, source);
  // path 가 곡선을 그대로 담고 있다 — 같은 path 면 같은 곡선이다.
  const clipped = useMemo(() => clipCurvePath(curve, occluders, path), [path, occluders]); // eslint-disable-line react-hooks/exhaustive-deps

  const openTaskEdgeEdit = useGraphStore((s) => s.openTaskEdgeEdit);
  const selectTaskEdge = useGraphStore((s) => s.selectTaskEdge);
  const isSelected = useGraphStore((s) => s.selectedTaskEdgeId === taskEdgeId);
  const debugMode = useGraphStore((s) => s.debugMode);

  // status 전이 → 펄스는 한 엣지에서 한 방향만: primary 는 executing 진입 때 'sending'(번들이 없으면 완료/에러도),
  // auto-artifact 는 completed/error. 번들 쌍이 동시에 펄스하지 않는다.
  const [pulse, setPulse] = useState<{ event: EdgePulseEvent; key: number } | null>(null);
  const prevStatusRef = useRef<TaskEdgeStatus>(status);
  const pulseCounterRef = useRef(0);
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasBundle = Boolean(bundleId);
  const isAutoArtifact = bundleRole === 'auto-artifact';
  // 자동 생성 자매 엣지는 알파를 살짝 뺀다.
  const isAutoSibling = bundleRole === 'auto-artifact' || bundleRole === 'auto-rework';

  // 수동 트리거 — debug 테스트 버튼용. status 와 무관하게 즉시 펄스 재생.
  const triggerPulse = useCallback((event: EdgePulseEvent) => {
    // 연속 완료/재실행 때 이전 펄스의 만료가 새 신호를 지우지 않게 수명을 넘겨준다.
    if (pulseTimerRef.current !== null) clearTimeout(pulseTimerRef.current);
    pulseCounterRef.current += 1;
    setPulse({ event, key: pulseCounterRef.current });
    pulseTimerRef.current = setTimeout(() => {
      pulseTimerRef.current = null;
      setPulse(null);
    }, PULSE_TOTAL_MS + 100);
  }, []);

  useEffect(() => () => {
    if (pulseTimerRef.current !== null) clearTimeout(pulseTimerRef.current);
  }, []);

  // 디버그 버튼용 역할 이벤트: auto-artifact = completed·error, 그 밖 = sending·error(번들 없는 primary 도 버튼 2개로 통일).
  const myEvents: EdgePulseEvent[] = isAutoArtifact ? ['completed', 'error'] : ['sending', 'error'];

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prev === status) return;
    // 이전 상태와 무관하게 executing 진입이면 sending — 고착된 error 뒤 새 dispatch 도 잡아야 한다.
    let event: EdgePulseEvent | null = null;
    if (isAutoArtifact) {
      if (status === 'completed') event = 'completed';
      else if (status === 'error') event = 'error';
    } else {
      if (status === 'executing') event = 'sending';
      else if (!hasBundle && status === 'completed') event = 'completed';
      else if (!hasBundle && status === 'error') event = 'error';
    }
    if (!event) return;
    triggerPulse(event);
  }, [status, isAutoArtifact, hasBundle, triggerPulse]);

  // 자매 엣지(auto-artifact/rework)는 편집 불가 — 더블클릭 무시(primary 로 리디렉트 ❌).
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!taskEdgeId) return;
    if (bundleRole === 'auto-artifact' || bundleRole === 'auto-rework') return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openTaskEdgeEdit(taskEdgeId, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [taskEdgeId, openTaskEdgeEdit, bundleRole]);

  // 싱글 클릭: DetailPanel 선택 (버블 싱글 클릭과 대칭)
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!taskEdgeId) return;
    selectTaskEdge(taskEdgeId);
  }, [taskEdgeId, selectTaskEdge]);

  const hasCommand = command.trim().length > 0;

  // §5.4 #31 연결 무리 강조 — 활동 엣지(`CurvedEdge`)와 같은 규칙을 위임 엣지에도 그대로 건다.
  const linkRole = useLinkEdgeRole(id);
  const linkPhase = useLinkFocusPhase();
  const linkVisual = linkFocusEdgeStyle(linkRole, linkPhase);
  const lineStyle: React.CSSProperties = {
    stroke: lineColor,
    strokeWidth: (kind === 'artifact' ? 3.5 : 2.5) * linkVisual.widthMul,
    strokeDasharray: idleDash,
    opacity: (isAutoSibling ? 0.55 : 1) * linkVisual.opacityMul,
    transition: `opacity ${LINK_FOCUS.TRANSITION_MS}ms ease-out, stroke-width ${LINK_FOCUS.TRANSITION_MS}ms ease-out`,
  };
  const paint = bubbleEdgeAppearance(appearance, { semantic: 'task', base: lineStyle });

  return (
    <>
      {paint.map((layer) => (
        <path key={layer.role} className="bubble-edge-paint" data-paint-layer={layer.role}
          d={clipped.path} style={layer.style} pointerEvents="none" aria-hidden="true" />
      ))}
      <BaseEdge
        id={id}
        path={clipped.path}
        style={bubbleEdgeMarkerStyle(lineStyle)}
        markerEnd={clipped.endVisible ? `url(#task-arrow-${kind})` : undefined}
        interactionWidth={15}
      />
      <EdgeLabelRenderer>
        {/* The portal shares the SVG edge's opacity without replacing each icon's own opacity. */}
        <div className={selectionFocusClassName}>
        <svg style={{ position: 'absolute', width: 0, height: 0 }}>
          <defs>
            {/* marker 는 kind 단독 — 화살촉 색은 status 와 무관. */}
            {(Object.keys(TASK_EDGE_KIND_STYLES) as TaskEdgeKind[]).map((k) => (
              <marker
                key={k}
                id={`task-arrow-${k}`}
                viewBox="0 0 12 12"
                refX="10"
                refY="6"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 12 6 L 0 12 z" fill={TASK_EDGE_KIND_STYLES[k].color} />
              </marker>
            ))}
          </defs>
        </svg>
        {/* 원형 트랜지션 룰 아이콘 — 엣지 중점에 배치 */}
        <div
          className="nodrag nopan pointer-events-auto group"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            // §5.4 #31 — 아이콘도 선과 같은 비율로 흐려진다(아이콘만 또렷하면 지워진 선 위에 점만 뜬다).
            opacity: (isAutoSibling ? 0.55 : 1) * linkVisual.opacityMul,
            transition: `opacity ${LINK_FOCUS.TRANSITION_MS}ms ease-out`,
          }}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          title={hasCommand ? `${command}\n\n(${t('bubbleMap.taskEdge.iconHint')})` : t('bubbleMap.taskEdge.iconHint')}
        >
          <div
            className={`flex h-4 w-4 items-center justify-center rounded-full border bg-gray-900 shadow transition-transform group-hover:scale-[1.8] ${
              isSelected ? 'scale-[1.6]' : ''
            }`}
            style={{
              borderColor: iconColor,
              boxShadow: isSelected
                ? `0 0 14px ${iconColor}, 0 0 4px ${iconColor}`
                : `0 0 6px ${iconColor}80`,
            }}
          >
            {/* kind 아이콘만 — 인라인 stroke SVG(currentColor, 이모지·글리프 ❌). */}
            <KindIcon kind={kind} className="h-2.5 w-2.5" style={{ color: kindStyle.color, overflow: 'visible' }} />
          </div>
          {/* 디버그(`~`) 테스트 버튼 — 클라에서만 펄스 재생(서버/status 불변). */}
          {debugMode && (
            <div
              className="pointer-events-auto absolute left-1/2 flex -translate-x-1/2 gap-1 rounded border border-gray-700 bg-gray-900/90 px-1 py-0.5 shadow-lg"
              style={{ bottom: 'calc(100% + 6px)' }}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              {myEvents.map((ev) => {
                const cfg = PULSE_CONFIG[ev];
                return (
                  <button
                    key={ev}
                    type="button"
                    className="flex h-5 min-w-5 items-center justify-center rounded px-1 text-[12px] hover:bg-gray-700"
                    style={{ color: cfg.color }}
                    title={t('bubbleMap.taskEdge.pulseDebugTitle', { label: t(cfg.labelKey) })}
                    onClick={(e) => { e.stopPropagation(); triggerPulse(ev); }}
                  >
                    <PulseIcon event={ev} className="h-3 w-3" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {pulse && (() => {
          const cfg = PULSE_CONFIG[pulse.event];
          return (
            <div
              key={pulse.key}
              className="pointer-events-none absolute left-0 top-0 flex h-6 w-6 items-center justify-center rounded-full shadow-lg"
              style={{
                offsetPath: `path('${path}')`,
                offsetDistance: '0%',
                offsetRotate: '0deg',
                animation: `task-edge-travel ${PULSE_DURATION_MS}ms ease-in-out ${PULSE_REPEAT} forwards`,
                backgroundColor: `${cfg.color}26`,
                border: `1.5px solid ${cfg.color}`,
                boxShadow: `0 0 10px ${cfg.color}`,
              }}
              title={t(cfg.labelKey)}
            >
              <PulseIcon event={pulse.event} className="h-3.5 w-3.5" />
            </div>
          );
        })()}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
