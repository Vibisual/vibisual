import { memo } from 'react';
import { useViewport, type Node } from '@xyflow/react';
import { SPAWN_RADIUS, SPAWN_MIN_DIST } from '../../utils/flowBuilder.js';

interface DebugOverlayProps {
  flowNodes: Node[];
}

/** 디버그 모드: root 노드 주변 스폰 반경을 시각화 */
export const DebugOverlay = memo(function DebugOverlay({ flowNodes }: DebugOverlayProps): React.JSX.Element | null {
  const { x, y, zoom } = useViewport();

  const rootNode = flowNodes.find((n) => (n.data as { bubbleType?: string }).bubbleType === 'root');
  if (!rootNode) return null;

  // root 노드 중심 (position은 좌상단이므로 크기/2 보정)
  const w = rootNode.measured?.width ?? 100;
  const h = rootNode.measured?.height ?? 100;
  const cx = (rootNode.position.x + w / 2) * zoom + x;
  const cy = (rootNode.position.y + h / 2) * zoom + y;

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full">
      {/* 최대 스폰 반경 */}
      <circle cx={cx} cy={cy} r={SPAWN_RADIUS * zoom} fill="none" stroke="#a78bfa" strokeWidth={1} strokeDasharray="4 4" opacity={0.5} />
      {/* 최소 거리 반경 */}
      <circle cx={cx} cy={cy} r={SPAWN_MIN_DIST * zoom} fill="none" stroke="#f87171" strokeWidth={1} strokeDasharray="2 2" opacity={0.4} />
      {/* 레이블 */}
      <text x={cx} y={cy - SPAWN_RADIUS * zoom - 6} textAnchor="middle" fill="#a78bfa" fontSize={10 * Math.min(zoom, 1)} opacity={0.7}>
        spawn r={SPAWN_RADIUS}
      </text>
      <text x={cx} y={cy - SPAWN_MIN_DIST * zoom - 6} textAnchor="middle" fill="#f87171" fontSize={10 * Math.min(zoom, 1)} opacity={0.6}>
        min={SPAWN_MIN_DIST}
      </text>
    </svg>
  );
});
