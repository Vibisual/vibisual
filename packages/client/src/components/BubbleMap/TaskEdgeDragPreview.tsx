import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { ReactFlowInstance, Node } from '@xyflow/react';
import type { BubbleData } from '@vibisual/shared';
import { TASK_EDGE_STYLES } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { calcBubbleSize } from '../../utils/sizeCalc.js';
import { computeTaskEdgePath } from './taskEdgePath.js';

/**
 * Task Edge 드래그 프리뷰 — 스크린 좌표계 고정 SVG 오버레이.
 *
 * 왜 이 방식?
 *   - React Flow 엣지 + 가상 타겟 노드로 구현했을 때 노드 측정 lifecycle과
 *     zoom 반영 타이밍이 엇갈려 커서 추적이 부자연스러웠음.
 *   - 여기선 mouseX/Y(스크린) + 소스 버블의 스크린 좌표/반지름만 알면 되므로
 *     한 프레임 내에 확정적으로 렌더된다.
 *
 * 스타일/geometry는 TaskEdgeComponent 와 동일한 헬퍼를 써서 확정 엣지로 넘어가도
 * 모양이 이어지도록 맞춘다.
 */

const PREVIEW_COLOR = '#3B82F6';
const PREVIEW_MARKER_ID = 'task-edge-drag-preview-arrow';

interface TaskEdgeDragPreviewProps {
  rfRef: RefObject<ReactFlowInstance | null>;
  /**
   * 메인 BubbleMap 의 ReactFlow 컨테이너 ref.
   *
   * 왜 필요한가: debug 모드가 켜지면 DebugPanel 이 자체 `<ReactFlow>` 를 또 렌더하므로
   * `document.querySelector('.react-flow')` 가 먼저 DOM 에 나타나는 DebugPanel 쪽을 잡아
   * 소스 오프셋(offX/offY) 이 0 근처로 계산된다. 결과적으로 드래그 프리뷰 출발점이
   * 실제 버블에서 좌하단으로 어긋나 보인다. 이 ref 내부에서만 `.react-flow` 를 탐색해
   * 해당 혼선을 제거한다.
   */
  rfContainerRef: RefObject<HTMLDivElement | null>;
  flowNodes: Node[];
}

export function TaskEdgeDragPreview({ rfRef, rfContainerRef, flowNodes }: TaskEdgeDragPreviewProps): React.JSX.Element | null {
  const taskEdgeDrag = useGraphStore((s) => s.taskEdgeDrag);
  // viewport 변경(pan/zoom) 이 일어나도 재렌더 되도록 frame 카운터 유지
  const [, forceFrame] = useState(0);

  // requestAnimationFrame 루프 — 드래그 중엔 항상 최신 viewport 를 반영
  useEffect(() => {
    if (!taskEdgeDrag) return;
    let raf = 0;
    const tick = (): void => {
      forceFrame((v) => (v + 1) & 0xffff);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [taskEdgeDrag]);

  if (!taskEdgeDrag) return null;
  const rf = rfRef.current;
  if (!rf) return null;

  const srcNode = flowNodes.find((n) => n.id === taskEdgeDrag.sourceId);
  if (!srcNode) return null;

  // 소스 반지름 (flow 좌표계) — 측정값 우선, 없으면 BubbleData 기반
  const measuredW = srcNode.measured?.width;
  const srcBubble = srcNode.data as unknown as BubbleData | undefined;
  const flowRadius = typeof measuredW === 'number'
    ? measuredW / 2
    : (srcBubble ? calcBubbleSize(srcBubble) / 2 : 45);

  const w = srcNode.measured?.width ?? (srcBubble ? calcBubbleSize(srcBubble) : 90);
  const h = srcNode.measured?.height ?? w;

  // 소스 중심 (flow 좌표) → 스크린 좌표
  // RF container의 left/top offset까지 포함해야 브라우저 전체 기준 fixed 좌표가 된다.
  const vp = rf.getViewport();
  // 메인 ReactFlow 컨테이너 내부에서만 `.react-flow` 탐색 (DebugPanel 의 ReactFlow 오염 방지)
  const rfEl = rfContainerRef.current?.querySelector('.react-flow') ?? null;
  const rfRect = rfEl?.getBoundingClientRect();
  const offX = rfRect?.left ?? 0;
  const offY = rfRect?.top ?? 0;
  const flowCenterX = srcNode.position.x + w / 2;
  const flowCenterY = srcNode.position.y + h / 2;
  const screenCenter = {
    x: flowCenterX * vp.zoom + vp.x + offX,
    y: flowCenterY * vp.zoom + vp.y + offY,
  };
  const screenRadius = flowRadius * vp.zoom;

  const { path } = computeTaskEdgePath({
    sourceX: screenCenter.x,
    sourceY: screenCenter.y,
    targetX: taskEdgeDrag.mouseX,
    targetY: taskEdgeDrag.mouseY,
    sourceRadius: screenRadius,
    targetRadius: 0,
  });

  const idle = TASK_EDGE_STYLES['idle'];
  const dash = idle?.strokeDasharray ?? '6 4';
  // stroke 는 실 엣지(플로우 내부 SVG)도 zoom 과 함께 스케일되므로 동일 비율로 맞춤
  const strokeWidth = Math.max(1.5, 2.5 * vp.zoom);

  return (
    <svg
      className="pointer-events-none fixed inset-0 z-40"
      style={{ width: '100vw', height: '100vh' }}
    >
      <defs>
        <marker
          id={PREVIEW_MARKER_ID}
          viewBox="0 0 12 12"
          refX="10"
          refY="6"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 12 6 L 0 12 z" fill={PREVIEW_COLOR} />
        </marker>
      </defs>
      <path
        d={path}
        fill="none"
        stroke={PREVIEW_COLOR}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
        opacity={0.95}
        markerEnd={`url(#${PREVIEW_MARKER_ID})`}
      />
    </svg>
  );
}
