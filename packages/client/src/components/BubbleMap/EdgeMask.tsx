import { useEffect, useRef } from 'react';
import { useNodes, useEdges } from '@xyflow/react';
import type { BubbleData } from '@vibisual/shared';
import { calcBubbleSize } from '../../utils/sizeCalc.js';

/**
 * 엣지가 버블 영역을 지나갈 때 해당 부분만 투명하게 만드는 SVG 마스크.
 * ReactFlow 내부에 렌더링해야 useNodes()가 동작한다.
 *
 * React Flow v12 DOM 구조:
 *   div.react-flow__edges
 *     svg  (MarkerDefs)
 *     svg > g.react-flow__edge[data-id]   ← 개별 엣지 (data-id = edge id)
 *
 * 전략: body에 숨긴 SVG로 mask 정의 → 각 엣지 <g>에 SVG mask 속성 직접 적용.
 *
 * 핵심: 엣지는 "자기가 출발한 소스 버블"에는 마스킹되면 안 된다. 그래야
 * 라인이 버블에서 뻗어 나오는 게 보인다(안 그러면 두 버블 사이에 둥둥 뜬다).
 * → 소스 노드별로 "그 노드만 빼고 전부 가리는" 마스크를 따로 만들고,
 *   각 엣지에 자기 소스에 맞는 마스크를 붙인다.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const MASK_ID = 'vibisual-edge-mask';
const BOUNDS = 1_000_000;
/** 마스크 반지름을 버블보다 살짝 줄여서 화살표·외곽선이 잘리지 않게 */
const RADIUS_SHRINK = 4;

interface MaskCircle {
  id: string;
  cx: number;
  cy: number;
  r: number;
}

export function EdgeMask(): null {
  const nodes = useNodes();
  const edges = useEdges();
  const maskSvgRef = useRef<SVGSVGElement | null>(null);

  // 1회: mask 정의용 SVG를 body에 생성
  useEffect(() => {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.style.position = 'absolute';
    svg.style.width = '0';
    svg.style.height = '0';
    svg.style.overflow = 'hidden';
    svg.setAttribute('aria-hidden', 'true');
    document.body.appendChild(svg);
    maskSvgRef.current = svg;

    return () => {
      svg.remove();
      maskSvgRef.current = null;
    };
  }, []);

  // 노드/엣지 변경 시: 소스별 mask 갱신 + 엣지 <g>에 자기 소스 mask 적용
  useEffect(() => {
    const svg = maskSvgRef.current;
    if (!svg) return;

    // 모든 버블의 가림 원을 한 번만 계산 (소스별로 1개만 제외하고 재사용).
    // CurvedEdge 와 동일하게 실측 지오메트리 우선 — 그래야 크기 애니메이션 중에도
    // 마스크 원과 엣지 끝점이 같은 원을 본다(어긋나면 라인이 잘리거나 둥둥 뜸).
    const circles: MaskCircle[] = [];
    for (const node of nodes) {
      const data = node.data as unknown as BubbleData;
      const localRange = (node.data as Record<string, unknown>)['_localRange'] as { min: number; max: number } | undefined;
      const mw = node.measured?.width;
      const mh = node.measured?.height;
      const size = typeof mw === 'number' && typeof mh === 'number' && mw > 0 && mh > 0
        ? Math.min(mw, mh)
        : calcBubbleSize(data, localRange);
      const r = size / 2 - RADIUS_SHRINK;
      if (r <= 0) continue;
      circles.push({
        id: node.id,
        cx: node.position.x + (typeof mw === 'number' ? mw : size) / 2,
        cy: node.position.y + (typeof mh === 'number' ? mh : size) / 2,
        r,
      });
    }

    /** 주어진 노드 id 하나만 빼고(또는 전부) 가리는 mask 엘리먼트 생성 */
    const buildMask = (maskId: string, excludeNodeId: string | null): SVGMaskElement => {
      const mask = document.createElementNS(SVG_NS, 'mask');
      mask.id = maskId;
      mask.setAttribute('maskUnits', 'userSpaceOnUse');
      mask.setAttribute('x', String(-BOUNDS));
      mask.setAttribute('y', String(-BOUNDS));
      mask.setAttribute('width', String(BOUNDS * 2));
      mask.setAttribute('height', String(BOUNDS * 2));

      // 흰색 배경 = 전부 보임
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(-BOUNDS));
      rect.setAttribute('y', String(-BOUNDS));
      rect.setAttribute('width', String(BOUNDS * 2));
      rect.setAttribute('height', String(BOUNDS * 2));
      rect.setAttribute('fill', 'white');
      mask.appendChild(rect);

      // 각 버블 위치에 검은 원 = 해당 영역만 엣지 안 보임. 단 소스 버블은 제외.
      for (const c of circles) {
        if (c.id === excludeNodeId) continue;
        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', String(c.cx));
        circle.setAttribute('cy', String(c.cy));
        circle.setAttribute('r', String(c.r));
        circle.setAttribute('fill', 'black');
        mask.appendChild(circle);
      }
      return mask;
    };

    const defs = document.createElementNS(SVG_NS, 'defs');

    // 기본 mask (소스를 못 찾는 엣지용 — 전부 가림)
    defs.appendChild(buildMask(MASK_ID, null));

    // 엣지에 쓰이는 소스 노드별 mask 1개씩 (그 소스만 제외).
    // mask DOM id 는 노드 id 의 특수문자 영향을 피하려 인덱스로 발급.
    const sourceToMaskId = new Map<string, string>();
    let idx = 0;
    for (const edge of edges) {
      if (sourceToMaskId.has(edge.source)) continue;
      const maskId = `${MASK_ID}--s${idx++}`;
      sourceToMaskId.set(edge.source, maskId);
      defs.appendChild(buildMask(maskId, edge.source));
    }

    svg.replaceChildren(defs);

    // ── 각 엣지 <g>에 자기 소스에 맞는 mask 적용 ──
    const edgeIdToSource = new Map<string, string>();
    for (const edge of edges) edgeIdToSource.set(edge.id, edge.source);

    const edgeGroups = document.querySelectorAll<SVGGElement>('g.react-flow__edge');
    for (const g of edgeGroups) {
      const edgeId = g.getAttribute('data-id') ?? '';
      const src = edgeIdToSource.get(edgeId);
      const maskId = (src && sourceToMaskId.get(src)) || MASK_ID;
      g.setAttribute('mask', `url(#${maskId})`);
    }
  }, [nodes, edges]);

  return null;
}
