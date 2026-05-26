import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import type { TaskEdgeStatus, TaskEdgeKind } from '@vibisual/shared';
import { TASK_EDGE_STYLES, TASK_EDGE_KIND_STYLES, TASK_EDGE_DEFAULTS } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { computeTaskEdgePath, readRadiusFromData } from './taskEdgePath.js';

/** v1.33 — 엣지 이벤트 펄스 타입. 엣지 path 를 따라 3회 날아가는 아이콘의 종류. */
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
  const p = {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, className, style,
  };
  if (kind === 'critique') {
    return <svg {...p} aria-label="Critique (watcher)"><path d="M2 12 Q12 4 22 12 Q12 20 2 12 Z" /><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /></svg>;
  }
  if (kind === 'artifact') {
    return <svg {...p}><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg>;
  }
  if (kind === 'request') {
    return <svg {...p}><polyline points="9 10 4 15 9 20" /><path d="M20 4v7a4 4 0 0 1-4 4H4" /></svg>;
  }
  return <svg {...p}><polygon points="7 4 19 12 7 20 7 4" /></svg>;
}

/**
 * Task Edge 시각 렌더링 — Unreal Engine 스테이트머신의 트랜지션 룰 노드 스타일.
 * 엣지 중점에 동그란 아이콘 배치 → 더블클릭 시 편집 팝업 오픈.
 */
export const TaskEdgeComponent = memo(function TaskEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps): React.JSX.Element {
  const { t } = useTranslation();
  const edgeData = data as Record<string, unknown> | undefined;
  // v1.33 — status 기반 "지속" 시각 전이 OFF. 엣지 모양은 kind(의미)로만 결정.
  // status 는 이벤트 펄스(아이콘이 path 따라 3회 날아감) 트리거 용도로만 사용.
  const status = (edgeData?.['status'] as TaskEdgeStatus) ?? 'idle';
  const kind = (edgeData?.['kind'] as TaskEdgeKind | undefined) ?? TASK_EDGE_DEFAULTS.kind;
  const command = (edgeData?.['command'] as string) ?? '';
  const taskEdgeId = (edgeData?.['taskEdgeId'] as string) ?? '';
  const bundleId = (edgeData?.['bundleId'] as string | undefined) ?? undefined;
  const bundleRole = (edgeData?.['bundleRole'] as 'primary' | 'auto-artifact' | 'auto-rework' | undefined) ?? undefined;
  const sourceRadius = readRadiusFromData(edgeData, 'sourceRadius');
  const targetRadius = readRadiusFromData(edgeData, 'targetRadius');
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
  // v1.54 — auto-rework 자매 엣지는 kind='command' 라 일반 command 엣지와 동일한 색/스타일.
  // 시각 구분은 같은 두 에이전트 사이를 흐르는 보라(critique primary) 엣지와 짝지어 보이는 것으로 충분.
  const lineColor = kindStyle.color;
  const iconColor = lineColor;

  const { path, labelX, labelY } = computeTaskEdgePath({
    sourceX, sourceY, targetX, targetY, sourceRadius, targetRadius,
    offset: parallelOffset,
    targetAngularOffset,
  });

  const openTaskEdgeEdit = useGraphStore((s) => s.openTaskEdgeEdit);
  const selectTaskEdge = useGraphStore((s) => s.selectTaskEdge);
  const isSelected = useGraphStore((s) => s.selectedTaskEdgeId === taskEdgeId);
  const debugMode = useGraphStore((s) => s.debugMode);

  // v1.33 — status 전이 감지 → 이벤트 펄스 트리거.
  // 역할 분리(한 방향만 흐르게):
  //   - primary(command) 엣지:   idle→executing 때 'sending' 만 (명령 발사 방향)
  //                              번들 없으면(=artifact 짝 없음) 완료/에러도 여기서 피드백
  //   - auto-artifact 엣지:      executing→completed 때 'completed' (결과 회귀 방향)
  //                              → error 때 'error'
  // 이렇게 하면 번들 쌍이 동시에 펄스 돌지 않고, 항상 한 엣지에서 arrow 방향 한 번만 흐른다.
  const [pulse, setPulse] = useState<{ event: EdgePulseEvent; key: number } | null>(null);
  const prevStatusRef = useRef<TaskEdgeStatus>(status);
  const pulseCounterRef = useRef(0);
  const hasBundle = Boolean(bundleId);
  const isAutoArtifact = bundleRole === 'auto-artifact';
  // v1.54 — 자동 생성된 자매 엣지(auto-artifact / auto-rework)는 알파 살짝 빼서 자동 생성 티 표시.
  const isAutoSibling = bundleRole === 'auto-artifact' || bundleRole === 'auto-rework';

  // 수동 트리거 — debug 테스트 버튼용. status 와 무관하게 즉시 펄스 재생.
  const triggerPulse = useCallback((event: EdgePulseEvent) => {
    pulseCounterRef.current += 1;
    setPulse({ event, key: pulseCounterRef.current });
    setTimeout(() => setPulse(null), PULSE_TOTAL_MS + 100);
  }, []);

  // v1.33 / v1.54 — 이 엣지가 자기 role 기준으로 담당하는 이벤트 목록 (디버그 테스트 버튼용).
  //   - primary + 번들 있음 : sending, error (송신 담당, 결과는 짝 artifact 가 처리)
  //   - auto-artifact       : completed, error (결과 회귀 담당)
  //   - auto-rework         : sending, error (감시자→작업자 rework 지시 발사 담당)
  //   - primary + 번들 없음 : sending, error (송신 + 피드백은 자기 혼자지만 버튼은 2개로 통일)
  const myEvents: EdgePulseEvent[] = isAutoArtifact ? ['completed', 'error'] : ['sending', 'error'];

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prev === status) return;
    // v1.33 — status 전이 트리거. 이전이 뭐였든(idle/error/completed) executing 진입하면 sending 울리도록
    // 완화. 예전 고착된 error → 새 dispatch 의 executing 전환도 잡혀야 함.
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

  // 더블클릭: 엣지 편집 팝업 오픈. 아이콘 현재 스크린 좌표를 기준점으로.
  // v1.54 — auto-artifact / auto-rework 자매 엣지는 편집 자체가 불가 — 더블클릭 무시(primary 로 리디렉트 ❌).
  //         사용자는 primary 엣지를 직접 더블클릭해야 편집 팝업이 열린다.
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

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: lineColor,
          strokeWidth: kind === 'artifact' ? 3.5 : 2.5,
          strokeDasharray: idleDash,
          opacity: isAutoSibling ? 0.55 : 1,
        }}
        markerEnd={`url(#task-arrow-${kind})`}
        interactionWidth={15}
      />
      <EdgeLabelRenderer>
        <svg style={{ position: 'absolute', width: 0, height: 0 }}>
          <defs>
            {/* v1.33 — marker id 는 kind 단독 (status 무반응). 화살촉 색 = kind 색 고정. */}
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
            // v1.54 — auto-sibling 은 아이콘도 함께 흐리게.
            opacity: isAutoSibling ? 0.55 : 1,
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
            {/* v1.33 — status 기호 제거, kind 아이콘만 상시 표시.
                전 kind 인라인 stroke SVG 통일(이모지/Unicode 텍스트 글리프 제거 — currentColor 추종). */}
            <KindIcon kind={kind} className="h-2.5 w-2.5" style={{ color: kindStyle.color, overflow: 'visible' }} />
          </div>
          {/* v1.33 — 디버그 모드 테스트 버튼. `~` 로 debugMode 토글 시 각 엣지 중앙 아이콘 위에
              자기 역할 이벤트 2개 버튼이 뜬다. 클릭 시 클라에서만 펄스 재생 (서버/status 불변). */}
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
                    className="flex h-5 min-w-5 items-center justify-center rounded px-1 text-[11px] hover:bg-gray-700"
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
        {/* v1.33 — 엣지 이벤트 펄스: path 를 따라 3회 날아가는 아이콘. 엣지 자체 모양은 불변. */}
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
      </EdgeLabelRenderer>
    </>
  );
});
