import type { Node } from '@xyflow/react';
import type { BubbleData, HeatScale } from '@vibisual/shared';
import { calcBubbleSize } from '../../utils/sizeCalc.js';

/** 가림 원 반지름을 버블보다 살짝 줄여서 화살표·외곽선이 잘리지 않게 */
const RADIUS_SHRINK = 4;

export interface MaskCircle {
  id: string;
  cx: number;
  cy: number;
  r: number;
}

/**
 * 가림 원 — CurvedEdge 와 같은 실측 우선(애니메이션 중에도 끝점과 같은 원이어야 선이 잘리거나 뜨지 않는다). 실측 없는 프레임도 렌더와 같은 `heat` 자(§5.24).
 * 마스크가 아니라 선이 잘라 그린다(§5.4 #31 (K)).
 */
export function edgeMaskCircles(nodes: readonly Node[], heat: HeatScale | undefined): MaskCircle[] {
  const circles: MaskCircle[] = [];
  for (const node of nodes) {
    const data = node.data as unknown as BubbleData;
    const localRange = (node.data as Record<string, unknown>)['_localRange'] as { min: number; max: number } | undefined;
    const mw = node.measured?.width;
    const mh = node.measured?.height;
    const size = typeof mw === 'number' && typeof mh === 'number' && mw > 0 && mh > 0
      ? Math.min(mw, mh)
      : calcBubbleSize(data, localRange, heat);
    const r = size / 2 - RADIUS_SHRINK;
    if (r <= 0) continue;
    circles.push({
      id: node.id,
      cx: node.position.x + (typeof mw === 'number' ? mw : size) / 2,
      cy: node.position.y + (typeof mh === 'number' ? mh : size) / 2,
      r,
    });
  }
  return circles;
}
