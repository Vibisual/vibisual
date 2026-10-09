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
 * 모든 버블의 가림 원. CurvedEdge 와 동일하게 실측 지오메트리 우선 — 그래야 크기 애니메이션 중에도
 * 가림 원과 엣지 끝점이 같은 원을 본다(어긋나면 라인이 잘리거나 둥둥 뜸).
 * §5.24 — 실측(`node.measured`)이 아직 없는 프레임의 폴백도 렌더와 **같은 자**(`heat`)를 쓴다.
 *
 * §5.4 #31 (K) 2026-10-09 — 이 원들은 더 이상 SVG 마스크로 지어지지 않는다. `EdgeMask` 가 인스턴스
 * 게시판에 올리고, 선이 그 원 밖 구간만 잘라 그린다(`edgeOcclusion.ts`).
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
