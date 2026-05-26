import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { ReactFlowInstance, Node } from '@xyflow/react';
import type { BubbleData } from '@vibisual/shared';
import { TASK_EDGE_STYLES } from '@vibisual/shared';
import { calcBubbleSize } from '../../utils/sizeCalc.js';
import { computeTaskEdgePath } from './taskEdgePath.js';

/**
 * Task Edge 팝업 프리뷰 — popup(입력창)이 열려있는 동안 source↔target 을 잇는
 * 점선 엣지 예시를 스크린 좌표로 유지 렌더한다.
 *
 * 왜 필요한가: 드롭 순간 endTaskEdgeDrag() 로 DragPreview 가 사라지면 popup 뒤에
 * 연결될 엣지 모양이 전혀 안 보여서 사용자 멘탈 모델이 끊긴다. Connect 확정 시에만
 * 실제 엣지가 남고, Cancel 이면 이 프리뷰도 같이 사라지므로 popup 과 생명주기를 맞춘다.
 */

const PREVIEW_COLOR = '#3B82F6';
const PREVIEW_MARKER_ID = 'task-edge-popup-preview-arrow';

interface TaskEdgePopupPreviewProps {
  rfRef: RefObject<ReactFlowInstance | null>;
  rfContainerRef: RefObject<HTMLDivElement | null>;
  flowNodes: Node[];
  sourceId: string;
  targetId: string;
  /** 평행 엣지 분산 — 같은 쌍에 다른 엣지가 있을 때 비키도록. 0 이면 직선. */
  parallelOffset?: number;
  /** 타겟 원둘레 각도 분산 — 동일 타겟 클러스터 있을 때 화살촉 endpoint 만 회전(경로 커브엔 영향 없음). */
  targetAngularOffset?: number;
}

function resolveBubbleMetrics(node: Node): { cx: number; cy: number; radius: number } {
  const data = node.data as unknown as BubbleData | undefined;
  const w = node.measured?.width ?? (data ? calcBubbleSize(data) : 90);
  const h = node.measured?.height ?? w;
  return {
    cx: node.position.x + w / 2,
    cy: node.position.y + h / 2,
    radius: w / 2,
  };
}

export function TaskEdgePopupPreview({
  rfRef,
  rfContainerRef,
  flowNodes,
  sourceId,
  targetId,
  parallelOffset = 0,
  targetAngularOffset = 0,
}: TaskEdgePopupPreviewProps): React.JSX.Element | null {
  // popup 이 떠있는 동안에도 물리 엔진/드래그로 노드가 움직이거나 viewport 가 바뀔 수 있으므로
  // rAF 로 재렌더해 엣지가 양쪽 버블을 따라가게 한다.
  const [, forceFrame] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      forceFrame((v) => (v + 1) & 0xffff);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const rf = rfRef.current;
  if (!rf) return null;

  const srcNode = flowNodes.find((n) => n.id === sourceId);
  const tgtNode = flowNodes.find((n) => n.id === targetId);
  if (!srcNode || !tgtNode) return null;

  const src = resolveBubbleMetrics(srcNode);
  const tgt = resolveBubbleMetrics(tgtNode);

  const vp = rf.getViewport();
  const rfEl = rfContainerRef.current?.querySelector('.react-flow') ?? null;
  const rfRect = rfEl?.getBoundingClientRect();
  const offX = rfRect?.left ?? 0;
  const offY = rfRect?.top ?? 0;

  const screenSrc = { x: src.cx * vp.zoom + vp.x + offX, y: src.cy * vp.zoom + vp.y + offY };
  const screenTgt = { x: tgt.cx * vp.zoom + vp.x + offX, y: tgt.cy * vp.zoom + vp.y + offY };

  const { path } = computeTaskEdgePath({
    sourceX: screenSrc.x,
    sourceY: screenSrc.y,
    targetX: screenTgt.x,
    targetY: screenTgt.y,
    sourceRadius: src.radius * vp.zoom,
    targetRadius: tgt.radius * vp.zoom,
    offset: parallelOffset,
    targetAngularOffset,
  });

  const idle = TASK_EDGE_STYLES['idle'];
  const dash = idle?.strokeDasharray ?? '6 4';
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
