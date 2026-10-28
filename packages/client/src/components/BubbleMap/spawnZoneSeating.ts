import type { Node } from '@xyflow/react';
import type { BubbleData, HeatScale } from '@vibisual/shared';
import { AGENT_CARD, TIDY_LAYOUT } from '@vibisual/shared';
import { calcBubbleSize } from '../../utils/sizeCalc.js';
import {
  createSpawnField,
  seatZoneBatch,
  type SpawnField,
  type ZoneBounds,
  type ZoneEdgeRef,
  type ZoneGrid,
  type ZoneObstacle,
} from '../../utils/spawnZone.js';
import { FOLDER_NAV_IDS } from '../../hooks/useBubbleLayout.js';
import { isAgentCardForm } from './agentCard.js';
import { LINEAGE_HUB_TYPES } from './tidySort.js';

/**
 * §5.1 #2-2 등장 영역 — 화면 값을 원·사각으로 바꿔 `spawnZone.ts` 에 넘기고 받은 중심을 좌상단으로 돌린다.
 * 크기는 **렌더와 같은 자**: 실측 → 말풍선 상자 → `calcBubbleSize`(`tidyDiameterOf` 와 같은 순서) — 어긋나면 이웃을 밟는다. 정사각이 아닌 실측은 사각(물리와 같다).
 */

/** 화면의 사각 창 하나(앱 노드·캡처·플레이·스펙·랩·선반) — 좌상단 + 크기. */
export interface SpawnPanel {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpawnFieldInput {
  /** 지금 뷰의 버블 전부(위성 포함). 자리가 있는 것만 장부에 오른다. */
  bubbles: readonly BubbleData[];
  /** 렌더된 노드 — 실측 크기가 있으면 그것을 쓴다. */
  nodes: readonly Node[];
  /** id → 좌상단 좌표(동기화 effect 의 위치 캐시). */
  positions: ReadonlyMap<string, { x: number; y: number }>;
  /** 사각 창 — 장애물이자 셀 거리(코멘트 박스는 넣지 않는다 — 버블을 담는 상자다). */
  panels: readonly SpawnPanel[];
  heat: HeatScale | undefined;
  fileSizeRange: { min: number; max: number } | undefined;
  bounds: ZoneBounds;
  /** 지금 메인 캔버스인가 — 커스텀 에이전트가 말풍선(가로 상자)으로 그려지는 곳이다(§5.4 #36 (A)). */
  cardForm: boolean;
}

/** 방금 선 버블(활동 1·작업 중)의 렌더 지름. 히트맵은 넣지 않는다 — 켜고 끌 때마다 격자 간격이 바뀌어 같은 고리가 두 격자로 갈린다. */
export function spawnTopSlotDiameter(): number {
  return calcBubbleSize({ id: '', label: '', path: '', bubbleType: 'internal_folder', status: 'active', activity: 1 });
}

/** 최상위 버블의 격자 — 첫 고리 앞도 이웃 사이도 `RING_GAP`(§5.4 #33 (C) 간격). */
export function spawnTopGrid(): ZoneGrid {
  return { slot: spawnTopSlotDiameter(), firstGap: TIDY_LAYOUT.RING_GAP };
}

/** 에이전트(영역의 주인)·내비게이션(Back·Root)은 그 화면의 배치가, 위성(`sat-`)은 `placeSatellitePositions` 가 같은 기하로 앉힌다. */
export function isSpawnZoneSeated(bubble: BubbleData): boolean {
  if (bubble.id.startsWith('sat-')) return false;
  if (LINEAGE_HUB_TYPES.has(bubble.bubbleType)) return false;
  if (bubble.bubbleType === 'back') return false;
  return !FOLDER_NAV_IDS.has(bubble.id);
}

/** 위성 버블에 실려 오는 지역 파일 크기 범위(`appendSatelliteBubbles` 가 붙인다). 없으면 undefined. */
function localRangeOf(bubble: BubbleData): { min: number; max: number } | undefined {
  // `_localRange` 는 `BubbleData` 타입 밖에서 붙는 표시용 칸이라 레코드로 읽는다.
  const raw = (bubble as unknown as Record<string, unknown>)['_localRange'];
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { min, max } = raw as { min?: unknown; max?: unknown };
  return typeof min === 'number' && typeof max === 'number' ? { min, max } : undefined;
}

/** 그려지는 상자 — 실측 → 말풍선 → 계산 지름 순. */
function footprintOf(
  bubble: BubbleData,
  node: Node | undefined,
  input: Pick<SpawnFieldInput, 'cardForm' | 'heat' | 'fileSizeRange'>,
): { w: number; h: number } {
  const w = node?.measured?.width;
  const h = node?.measured?.height;
  if (typeof w === 'number' && w > 0 && typeof h === 'number' && h > 0) return { w, h };
  if (input.cardForm && isAgentCardForm(bubble)) return { w: AGENT_CARD.width, h: AGENT_CARD.height };
  const d = calcBubbleSize(bubble, localRangeOf(bubble) ?? input.fileSizeRange, input.heat);
  return { w: d, h: d };
}

/** §5.1 #2-2 (J) — 묶음 위성의 몸집 반경(`constellationView` 가 싣는 `_orbitReach`, 가장 큰 달의 바깥 테두리까지). 타입 밖 표시용 칸이라 레코드로 읽는다. */
export function orbitReachOf(bubble: BubbleData): number | undefined {
  const raw = (bubble as unknown as Record<string, unknown>)['_orbitReach'];
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

/** 정사각이 아니면 사각(1px 은 측정 반올림). 묶음 위성은 몸이 달 궤도까지(`reach`), 주인으로는 제 원(`core`). */
function obstacleOf(id: string, x: number, y: number, w: number, h: number, reach?: number): ZoneObstacle {
  const cx = x + w / 2;
  const cy = y + h / 2;
  if (Math.abs(w - h) > 1) return { id, cx, cy, r: Math.max(w, h) / 2, hw: w / 2, hh: h / 2 };
  if (reach !== undefined && reach > w / 2) return { id, cx, cy, r: reach, core: w / 2 };
  return { id, cx, cy, r: w / 2 };
}

/** 이미 자리가 있는 것 전부(에이전트·폴더·위성·사각 창). 위성을 앉힐 때도 같은 장부를 이어 쓴다(앉힌 것이 더해진다). */
export function buildSpawnField(input: SpawnFieldInput): SpawnField {
  const nodeById = new Map<string, Node>();
  for (const node of input.nodes) nodeById.set(node.id, node);
  const obstacles: ZoneObstacle[] = [];
  for (const bubble of input.bubbles) {
    const pos = input.positions.get(bubble.id);
    if (!pos) continue;
    const { w, h } = footprintOf(bubble, nodeById.get(bubble.id), input);
    obstacles.push(obstacleOf(bubble.id, pos.x, pos.y, w, h, orbitReachOf(bubble)));
  }
  for (const panel of input.panels) {
    if (!(panel.width > 0) || !(panel.height > 0)) continue;
    obstacles.push(obstacleOf(panel.id, panel.x, panel.y, panel.width, panel.height));
  }
  return createSpawnField(obstacles, input.bounds);
}

export interface SpawnSeatingInput {
  /** 이번에 첫 자리를 받을 최상위 버블(저장된 자리도, 캐시된 자리도 없는 것). */
  pending: readonly BubbleData[];
  /** 그 화면의 장부(`buildSpawnField`). 앉힌 버블이 더해진다. */
  field: SpawnField;
  /** 지금 뷰의 버블 전부 — 주인(에이전트) 후보를 여기서 찾는다. */
  bubbles: readonly BubbleData[];
  /** 화면에 그려진 선 — 누가 주인인가는 이것이 정한다(§5.4 #33 (I-3) 과 같은 근거). */
  edges: readonly ZoneEdgeRef[];
  heat: HeatScale | undefined;
  /** 이어진 에이전트가 화면에 없을 때 영역의 중심. */
  fallbackCenter: { x: number; y: number };
}

/** 이미 자리가 있는 버블은 옮기지 않는다 — 처음 설 자리만 정한다(§5.1 #2-2 (H)). */
export function seatSpawnZoneBubbles(input: SpawnSeatingInput): Map<string, { x: number; y: number }> {
  const hubs = new Map<string, number>();
  for (const bubble of input.bubbles) {
    if (LINEAGE_HUB_TYPES.has(bubble.bubbleType)) hubs.set(bubble.id, bubble.lastActivity ?? 0);
  }
  const diameterById = new Map<string, number>();
  const pending = input.pending.map((bubble) => {
    const diameter = calcBubbleSize(bubble, undefined, input.heat);
    diameterById.set(bubble.id, diameter);
    return { id: bubble.id, diameter, lastActivity: bubble.lastActivity };
  });

  const centers = seatZoneBatch({
    pending,
    field: input.field,
    edges: input.edges,
    hubs,
    grid: spawnTopGrid(),
    fallbackCenter: input.fallbackCenter,
  });

  const out = new Map<string, { x: number; y: number }>();
  for (const [id, c] of centers) {
    const d = diameterById.get(id) ?? 0;
    out.set(id, { x: c.cx - d / 2, y: c.cy - d / 2 });
  }
  return out;
}
