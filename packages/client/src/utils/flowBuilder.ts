import type { Node, Edge, XYPosition } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';
import type { BubbleData, HeatScale } from '@vibisual/shared';
import {
  EDGE_STYLE,
  AGENT_CLUSTER_BASE_RADIUS,
  AGENT_CLUSTER_RADIUS_PER_AGENT,
  ORBIT_BASE_RADIUS,
  ORBIT_RADIUS_PER_ITEM,
  WEB_ORBIT_TYPES,
} from '@vibisual/shared';
import { calcBubbleSize } from './sizeCalc.js';
import type { EdgeInput, SatelliteInfo } from './satellite.js';

// ─── 공통 엣지 빌더 (config 기반) ───

export function buildFlowEdge(input: EdgeInput): Edge {
  const strokeColor = input.isActive
    ? `${input.color}${EDGE_STYLE.activeOpacity}`
    : EDGE_STYLE.inactiveColor;
  const strokeWidth = input.isActive
    ? EDGE_STYLE.activeWidth
    : EDGE_STYLE.inactiveWidth;

  return {
    id: input.id,
    source: input.source,
    target: input.target,
    sourceHandle: 'src',
    targetHandle: 'tgt',
    type: 'curved',
    animated: input.isActive,
    label: input.label,
    labelStyle: {
      fill: input.isActive ? '#e2e8f0' : '#64748b',
      fontSize: 11,
      fontWeight: input.isActive ? 600 : 400,
    },
    labelBgStyle: { fill: '#0f172a', fillOpacity: 0.9 },
    labelBgPadding: [6, 3] as [number, number],
    labelBgBorderRadius: 4,
    data: { sourceRadius: input.sourceRadius, targetRadius: input.targetRadius },
    style: { stroke: strokeColor, strokeWidth },
    markerEnd: { type: MarkerType.ArrowClosed, color: strokeColor, width: 14, height: 14 },
  };
}

// ─── 반경 조회 ───

/**
 * §5.24 — `heat` 는 **필수 인자**다(옵션 ❌). 레이아웃이 쓰는 지름과 `BubbleNode` 가 그리는 지름이
 * 어긋나면 그 버블만 다른 크기로 앉아 화살표가 빗나간다 — 빠뜨림을 주석이 아니라 타입 검사가 막게 한다.
 * 히트맵이 꺼져 있으면 호출부가 `undefined` 를 **명시적으로** 넘긴다.
 */
export function findRadius(bubbles: BubbleData[], id: string, heat: HeatScale | undefined): number {
  const b = bubbles.find((x) => x.id === id);
  return b ? calcBubbleSize(b, undefined, heat) / 2 : 45;
}

// ─── 방사형 레이아웃 ───

export interface LayoutOptions {
  offsetX?: number;
  offsetY?: number;
}

/**
 * 방사형 레이아웃 -- centers가 1개면 중앙 배치, 2개 이상이면 클러스터.
 * items(폴더)는 클러스터 중심 기준으로 공전.
 */
export function radialLayout(
  centers: BubbleData[],
  items: BubbleData[],
  cx: number,
  cy: number,
  heat: HeatScale | undefined,
  opts?: LayoutOptions,
): Map<string, XYPosition> {
  const positions = new Map<string, XYPosition>();
  const ox = opts?.offsetX ?? 0;
  const oy = opts?.offsetY ?? 0;

  if (centers.length === 1) {
    const size = calcBubbleSize(centers[0]!, undefined, heat);
    positions.set(centers[0]!.id, { x: cx + ox - size / 2, y: cy + oy - size / 2 });
  } else if (centers.length > 1) {
    const clusterR = AGENT_CLUSTER_BASE_RADIUS + centers.length * AGENT_CLUSTER_RADIUS_PER_AGENT;
    const step = (2 * Math.PI) / centers.length;
    for (let i = 0; i < centers.length; i++) {
      const c = centers[i]!;
      const size = calcBubbleSize(c, undefined, heat);
      const angle = step * i - Math.PI / 2;
      positions.set(c.id, {
        x: cx + ox + Math.cos(angle) * clusterR - size / 2,
        y: cy + oy + Math.sin(angle) * clusterR - size / 2,
      });
    }
  }

  if (items.length === 0) return positions;

  const clusterSpan = centers.length > 1
    ? AGENT_CLUSTER_BASE_RADIUS + centers.length * AGENT_CLUSTER_RADIUS_PER_AGENT
    : 0;
  const baseRadius = ORBIT_BASE_RADIUS + items.length * ORBIT_RADIUS_PER_ITEM + clusterSpan;
  const angleStep = (2 * Math.PI) / items.length;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    const size = calcBubbleSize(item, undefined, heat);
    const angle = angleStep * i - Math.PI / 2;
    positions.set(item.id, {
      x: cx + Math.cos(angle) * baseRadius - size / 2,
      y: cy + Math.sin(angle) * baseRadius - size / 2,
    });
  }
  return positions;
}

/**
 * §5.23 — 큰 원(`radialLayout`)에 세울 항목. 웹 버블(`WEB_ORBIT_TYPES`)은 뺀다.
 *
 * 그 원의 반지름은 개수에 비례해 자란다. 자료조사 한 번에 호스트 수십 곳이 거기 들면 원이 물리 상자를
 * 넘고, 물리 클램프가 함께 선 항목까지 상자 벽에 눌러 사각 테두리가 된다. 메인 캔버스·폴더 안의 새 버블은
 * 이 원이 아니라 주인 둘레 등장 영역에서 첫 자리를 받는다(§5.1 #2-2 `spawnZoneSeating.ts` — 종전의
 * 무작위 첫 자리 `findNonCollidingPosition` 도 그 규칙으로 대체됐다).
 */
export function radialItemsOf(items: readonly BubbleData[]): BubbleData[] {
  return items.filter((b) => !WEB_ORBIT_TYPES.has(b.bubbleType));
}

/**
 * 두 노드 `data` 레코드의 얕은 동등 비교 — 키 집합과 각 값(Object.is)이 모두 같으면 true.
 * 실시간 sync 에서 내용이 바뀌지 않은 버블의 `data` 참조를 재사용해, BubbleNode(memo) 가
 * 매 프레임 리렌더되는 것을 막는 데 쓴다(드래그·물리 이동 시 위치만 바뀌고 내용은 그대로인 경우).
 */
export function shallowEqualData(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.is(a[k], b[k])) return false;
  }
  return true;
}

// ─── FlowNode 변환 ───

export function toFlowNodes(
  bubbles: BubbleData[],
  positions: Map<string, XYPosition>,
  layout?: Map<string, XYPosition>,
): Node[] {
  return bubbles.map((b) => ({
    id: b.id,
    type: 'bubble' as const,
    position: positions.get(b.id) ?? layout?.get(b.id) ?? b.position ?? { x: 0, y: 0 },
    dragHandle: '.bubble-body',
    // §5.1 #2-1 (B) — 묶음 버블은 고르지 않는다(지울·잠글 데이터가 없는 자리).
    ...(b.bubbleType === 'bundle' ? { selectable: false } : {}),
    data: { ...b },
  }));
}

// ─── 위성 → 버블 배열 병합 ───

export function appendSatelliteBubbles(
  allBubbles: BubbleData[],
  satInfos: SatelliteInfo[],
): BubbleData[] {
  return [
    ...allBubbles,
    ...satInfos.map((s) => ({ ...s.bubble, _localRange: s.localRange }) as BubbleData),
  ];
}

// ─── 위성 엣지 빌드 ───

export function buildSatelliteEdges(satInfos: SatelliteInfo[]): Edge[] {
  // §5.1 #2-1 (B) — 별자리 중심인 앱 노드가 연결선을 숨겼으면 그 위성선도 그리지 않는다(연결은 그대로 — `hidden`).
  return satInfos.map((s) => (s.edgeHidden === true ? { ...buildFlowEdge(s.edge), hidden: true } : buildFlowEdge(s.edge)));
}

// ─── ViewData 결과 타입 ───

export interface ViewData {
  bubbles: BubbleData[];
  layout: Map<string, XYPosition>;
  flowEdges: Edge[];
  satInfos: SatelliteInfo[];
}

/** 빈 ViewData (에이전트 없을 때) */
export const EMPTY_VIEW_DATA: ViewData = {
  bubbles: [],
  layout: new Map(),
  flowEdges: [],
  satInfos: [],
};
