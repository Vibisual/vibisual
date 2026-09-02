import { useMemo } from 'react';
import type { HeatScale } from '@vibisual/shared';
import { useGraphStore } from '../stores/graphStore.js';

/**
 * §5.24 — 지금 화면에 적용할 히트 척도. 히트맵이 꺼져 있으면 `undefined`.
 *
 * **읽는 곳이 여럿이라 훅 하나로 묶는다** — 레이아웃(궤도·위성 배치)·렌더(`BubbleNode`)·
 * 엣지 클리핑(`EdgeMask`)이 전부 이 값을 쓰는데, 각자 스토어에서 따로 조합하면 한 곳만
 * 조건을 다르게 써도 그 버블만 다른 크기로 앉아 화살표가 빗나간다.
 *
 * 두 원시값(`heatmapMode` boolean · `readCountRange.max` number)만 구독하므로,
 * 스냅샷이 흘러도 **실제로 척도가 바뀔 때만** 리렌더한다(§9 "안 바뀐 것은 새것이 아니다").
 */
export function useHeatScale(): HeatScale | undefined {
  const enabled = useGraphStore((s) => s.heatmapMode);
  const max = useGraphStore((s) => s.readCountRange.max);
  return useMemo(() => (enabled ? { max } : undefined), [enabled, max]);
}
