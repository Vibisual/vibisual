import { useLayoutEffect } from 'react';
import { useNodes } from '@xyflow/react';
import { useHeatScale } from '../../hooks/useHeatScale.js';
import { edgeMaskCircles } from './edgeMaskGeometry.js';
import { publishOccluders, useOccluderInstance } from './edgeOccluders.js';

/**
 * 선이 버블 영역을 지나는 부분을 지운다(반투명 버블 너머 비침 방지). useNodes() 때문에 ReactFlow 안에 렌더한다.
 * §5.4 #31 (K) — 원 목록을 이 인스턴스 게시판에 올릴 뿐, 선(`CurvedEdge`·`TaskEdgeComponent`)이 원 밖만 그린다(`edgeOcclusion.ts`).
 * SVG `<mask>` 로 되돌리지 마라 — 선마다 오프스크린 두 장으로 GPU 래스터가 포화한다(2026-10-09 실측: 정지 중 초당 12~15 프레임, 초점 전환 때 1초 가까이 끊김).
 * 선은 자기 출발 버블에는 가려지지 않는다(선 쪽이 소스를 뺀다). 게시판은 인스턴스마다 따로다(§5.5 #17-17 ㉖(a)).
 */
export function EdgeMask(): null {
  const nodes = useNodes();
  const instance = useOccluderInstance();
  // §5.24 — 실측(`node.measured`)이 아직 없는 프레임의 폴백도 렌더와 **같은 자**를 써야 한다.
  const heat = useHeatScale();

  // 레이아웃 단계에서 게시한다 — 선이 이 원을 받아 다시 잘리는 일이 같은 커밋 안에서 끝나야
  // 처음 그려지는 한 프레임에 버블 너머로 선이 비치지 않는다.
  useLayoutEffect(() => {
    publishOccluders(instance, edgeMaskCircles(nodes.filter((node) => !node.hidden), heat));
  }, [nodes, heat, instance]);

  useLayoutEffect(() => () => publishOccluders(instance, []), [instance]);

  return null;
}
