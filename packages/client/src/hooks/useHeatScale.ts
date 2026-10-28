import { useMemo } from 'react';
import type { HeatScale } from '@vibisual/shared';
import { useGraphStore } from '../stores/graphStore.js';

/**
 * §5.24 — 지금 화면의 히트 척도(꺼지면 `undefined`). 레이아웃·`BubbleNode`·`EdgeMask` 가 **이 훅 하나**로 읽는다 — 따로 조합하면 그 버블만 크기가 달라 화살표가 빗나간다.
 * 원시값과 분포 배열(참조 고정)만 구독한다. 축·곡선도 척도에 담는다 — 따로 읽으면 한 프레임 어긋난 숫자·눈금이 적힌다.
 */
export function useHeatScale(): HeatScale | undefined {
  const enabled = useGraphStore((s) => s.heatmapMode);
  const axis = useGraphStore((s) => s.heatAxis);
  const curve = useGraphStore((s) => s.heatCurve);
  const max = useGraphStore((s) => (s.heatAxis === 'write' ? s.writeCountRange.max : s.readCountRange.max));
  // 분포는 `quantile` 곡선만 읽지만 **척도 한 벌에 함께 담는다** — 곡선을 바꾸는 순간 다른 값을
  //   조회하러 가야 하면 그 프레임에 색과 눈금이 서로 다른 척도를 본다.
  const quantiles = useGraphStore((s) => (
    s.heatAxis === 'write' ? s.writeCountQuantiles : s.readCountQuantiles
  ));
  return useMemo(
    () => (enabled ? { max, axis, curve, quantiles } : undefined),
    [enabled, max, axis, curve, quantiles],
  );
}
