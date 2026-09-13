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
 * 네 원시값(`heatmapMode` boolean · `heatAxis`·`heatCurve` 문자열 · 그 축의 `max` number)과
 * 분포 배열 하나만 구독하므로, 스냅샷이 흘러도 **실제로 척도가 바뀔 때만** 리렌더한다
 * (분포는 스토어가 `structuralShare` 로 참조를 고정한다 — §9 "안 바뀐 것은 새것이 아니다").
 *
 * **축·곡선을 척도에 담아 함께 흘린다** — 색·지름·숫자 배지·범례 눈금이 그것을 각자 스토어에서
 * 읽으면 한 프레임 어긋나 "쓰기로 칠해진 지도에 읽기 숫자가 적히는" · "로그로 칠해진 지도에
 * 선형 눈금이 적히는" 상태가 생긴다(§5.24).
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
