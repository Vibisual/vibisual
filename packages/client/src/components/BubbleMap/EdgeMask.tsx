import { useLayoutEffect } from 'react';
import { useNodes } from '@xyflow/react';
import { useHeatScale } from '../../hooks/useHeatScale.js';
import { edgeMaskCircles } from './edgeMaskGeometry.js';
import { publishOccluders, useOccluderInstance } from './edgeOccluders.js';

/**
 * 엣지가 버블 영역을 지나갈 때 그 부분만 지운다 — 그래야 반투명 버블 너머로 선이 비치지 않는다.
 * ReactFlow 내부에 렌더링해야 useNodes()가 동작한다.
 *
 * §5.4 #31 (K) 2026-10-09 — **마스크가 아니라 선이 스스로 잘린다.** 종전에는 출발 버블마다 SVG
 * `<mask>`(버블 수만큼의 검은 원)를 짓고 엣지 `<g>` 마다 걸었는데, 마스크가 걸린 선은 다시 그릴
 * 때마다 선마다 오프스크린 두 장을 거쳐 GPU 래스터가 포화했다(가만히도 초당 12~15 프레임, 선택
 * 초점 전환에서 1초 가까이 끊김). 이제 여기서는 **원 목록을 이 캔버스의 React Flow 인스턴스에
 * 게시만 한다** — 각 선(`CurvedEdge`·`TaskEdgeComponent`)이 자기 곡선이 지나는 원 밖 구간만
 * 경로로 그린다(`edgeOcclusion.ts`). 원은 종전과 같다(실측 지름 우선, 반지름 −4).
 *
 * 핵심은 그대로다: 선은 "자기가 출발한 소스 버블"에는 가려지지 않는다. 그래야 라인이 버블에서
 * 뻗어 나오는 게 보인다(안 그러면 두 버블 사이에 둥둥 뜬다) — 선 쪽이 고를 때 소스를 뺀다.
 *
 * §5.5 #17-17 ㉖(a) — 게시판은 인스턴스마다 따로라(무대 지도·디버그 그래프가 같은 화면에 선다)
 * 이 캔버스의 원이 남의 캔버스 선을 자르지 않는다. 문서·DOM 은 아예 걷지 않는다.
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
