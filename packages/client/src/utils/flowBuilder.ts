import type { Node, Edge, XYPosition } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';
import type { BubbleData } from '@vibisual/shared';
import {
  EDGE_STYLE,
  AGENT_CLUSTER_BASE_RADIUS,
  AGENT_CLUSTER_RADIUS_PER_AGENT,
  ORBIT_BASE_RADIUS,
  ORBIT_RADIUS_PER_ITEM,
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

export function findRadius(bubbles: BubbleData[], id: string): number {
  const b = bubbles.find((x) => x.id === id);
  return b ? calcBubbleSize(b) / 2 : 45;
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
  opts?: LayoutOptions,
): Map<string, XYPosition> {
  const positions = new Map<string, XYPosition>();
  const ox = opts?.offsetX ?? 0;
  const oy = opts?.offsetY ?? 0;

  if (centers.length === 1) {
    const size = calcBubbleSize(centers[0]!);
    positions.set(centers[0]!.id, { x: cx + ox - size / 2, y: cy + oy - size / 2 });
  } else if (centers.length > 1) {
    const clusterR = AGENT_CLUSTER_BASE_RADIUS + centers.length * AGENT_CLUSTER_RADIUS_PER_AGENT;
    const step = (2 * Math.PI) / centers.length;
    for (let i = 0; i < centers.length; i++) {
      const c = centers[i]!;
      const size = calcBubbleSize(c);
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
    const size = calcBubbleSize(item);
    const angle = angleStep * i - Math.PI / 2;
    positions.set(item.id, {
      x: cx + Math.cos(angle) * baseRadius - size / 2,
      y: cy + Math.sin(angle) * baseRadius - size / 2,
    });
  }
  return positions;
}

// ─── 충돌 방지 배치 ───

export const SPAWN_RADIUS = 300;
export const SPAWN_MIN_DIST = 60;
const SPAWN_MAX_TRIES = 50;

/** anchor 중심 반경 SPAWN_RADIUS 내에서 기존 노드와 겹치지 않는 랜덤 위치 */
export function findNonCollidingPosition(
  anchor: XYPosition,
  occupied: Map<string, XYPosition>,
): XYPosition {
  for (let i = 0; i < SPAWN_MAX_TRIES; i++) {
    const angle = Math.random() * 2 * Math.PI;
    const r = SPAWN_MIN_DIST + Math.random() * (SPAWN_RADIUS - SPAWN_MIN_DIST);
    const candidate = { x: anchor.x + Math.cos(angle) * r, y: anchor.y + Math.sin(angle) * r };
    let collides = false;
    for (const pos of occupied.values()) {
      const dx = pos.x - candidate.x;
      const dy = pos.y - candidate.y;
      if (dx * dx + dy * dy < SPAWN_MIN_DIST * SPAWN_MIN_DIST) { collides = true; break; }
    }
    if (!collides) return candidate;
  }
  // 못 찾으면 랜덤 각도로 반경 끝에 배치
  const fallbackAngle = Math.random() * 2 * Math.PI;
  return { x: anchor.x + Math.cos(fallbackAngle) * SPAWN_RADIUS, y: anchor.y + Math.sin(fallbackAngle) * SPAWN_RADIUS };
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
  return satInfos.map((s) => buildFlowEdge(s.edge));
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
