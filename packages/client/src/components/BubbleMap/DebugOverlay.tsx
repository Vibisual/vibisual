import { memo } from 'react';
import { useViewport, type Node } from '@xyflow/react';
import type { BubbleType } from '@vibisual/shared';
import { zoneGridRadius } from '../../utils/spawnZone.js';
import { spawnTopGrid } from './spawnZoneSeating.js';
import { LINEAGE_HUB_TYPES } from './tidySort.js';

interface DebugOverlayProps {
  flowNodes: Node[];
}

/** 그려 보일 고리 수 — 첫 고리와 그 바깥 둘(영역이 넓어지는 모양이 읽히는 만큼). */
const DEBUG_RINGS = [0, 1, 2] as const;

/** 디버그: §5.1 #2-2 등장 영역 고리 0~2. 새 버블은 12시부터 시계 방향, 붐비면(남의 버블 포함) 바깥 고리. 반경은 배치와 같은 `zoneGridRadius`. */
export const DebugOverlay = memo(function DebugOverlay({ flowNodes }: DebugOverlayProps): React.JSX.Element | null {
  const { x, y, zoom } = useViewport();

  const hubs = flowNodes.filter((n) => {
    const type = (n.data as { bubbleType?: BubbleType }).bubbleType;
    return type !== undefined && LINEAGE_HUB_TYPES.has(type);
  });
  if (hubs.length === 0) return null;
  const grid = spawnTopGrid();

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full">
      {hubs.map((node) => {
        // 중심은 좌상단 + 크기/2. 사각 노드(말풍선)는 긴 변의 반이 반경이다 — 배치가 재는 것과 같다.
        const w = node.measured?.width ?? 100;
        const h = node.measured?.height ?? w;
        const cx = (node.position.x + w / 2) * zoom + x;
        const cy = (node.position.y + h / 2) * zoom + y;
        const anchorR = Math.max(w, h) / 2;
        return (
          <g key={node.id}>
            {DEBUG_RINGS.map((ring) => {
              const r = zoneGridRadius(anchorR, grid, ring) * zoom;
              return (
                <circle key={ring} cx={cx} cy={cy} r={r} fill="none" stroke="#a78bfa" strokeWidth={1} strokeDasharray="4 4" opacity={0.5 - ring * 0.12} />
              );
            })}
            <text x={cx} y={cy - zoneGridRadius(anchorR, grid, 0) * zoom - 6} textAnchor="middle" fill="#a78bfa" fontSize={10 * Math.min(zoom, 1)} opacity={0.7}>
              spawn ring 0
            </text>
          </g>
        );
      })}
    </svg>
  );
});
