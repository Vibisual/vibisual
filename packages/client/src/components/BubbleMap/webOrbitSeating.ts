import type { Node } from '@xyflow/react';
import type { BubbleData, HeatScale } from '@vibisual/shared';
import { AGENT_CARD } from '@vibisual/shared';
import { calcBubbleSize } from '../../utils/sizeCalc.js';
import { isAgentCardForm } from './agentCard.js';
import { LINEAGE_HUB_TYPES } from './tidySort.js';
import { seatWebOrbitBatch, type OrbitBounds, type OrbitCircle, type OrbitEdgeRef } from './webOrbit.js';

/**
 * §5.23 웹 궤도 — 화면 값(버블·노드·좌상단 좌표)을 원으로 바꿔 `webOrbit.ts` 에 넘기고, 받은 중심을 다시
 * 좌상단으로 돌려준다. BubbleMap 동기화 effect 가 새 도메인 버블의 첫 자리를 정할 때 부른다.
 *
 * 크기는 **렌더와 같은 자**로 잰다 — 실측이 있으면 실측, 말풍선이면 그 상자, 아니면 `calcBubbleSize`
 * (§5.4 #33 (C) `tidyDiameterOf` 와 같은 순서). 자가 어긋나면 그 버블만 다른 크기로 앉아 이웃을 밟는다.
 */

export interface WebOrbitSeatingInput {
  /** 이번에 첫 자리를 받을 웹 버블(저장된 자리도, 캐시된 자리도 없는 것). */
  pending: readonly BubbleData[];
  /** 지금 뷰의 버블 전부(위성 포함) — 장애물과 앵커 후보를 여기서 찾는다. */
  bubbles: readonly BubbleData[];
  /** 렌더된 노드 — 실측 크기가 있으면 그것을 쓴다. */
  nodes: readonly Node[];
  /** id → 좌상단 좌표(동기화 effect 의 위치 캐시). 여기 자리가 있는 것만 장애물·앵커가 된다. */
  positions: ReadonlyMap<string, { x: number; y: number }>;
  /** 화면에 그려진 선 — 누가 읽었나는 이것이 정한다(§5.4 #33 (I-3) 과 같은 근거). */
  edges: readonly OrbitEdgeRef[];
  heat: HeatScale | undefined;
  fileSizeRange: { min: number; max: number } | undefined;
  bounds: OrbitBounds;
  /** 지금 메인 캔버스인가 — 커스텀 에이전트가 말풍선(가로 상자)으로 그려지는 곳이다(§5.4 #36 (A)). */
  cardForm: boolean;
  /** 읽은 에이전트가 화면에 없을 때 궤도의 중심. */
  fallbackCenter: { x: number; y: number };
}

/**
 * 궤도 칸의 기준 지름 — 방금 선 웹 버블(활동 1·작업 중)이 그려지는 지름. 렌더와 같은 자에서 딴다.
 * 히트맵은 넣지 않는다 — 켜고 끌 때마다 격자 간격이 달라지면 같은 궤도가 두 격자로 갈린다
 * (히트맵 아래의 실제 지름은 겹침 판정이 따로 본다).
 */
export function webOrbitSlotDiameter(): number {
  return calcBubbleSize({ id: '', label: '', path: '', bubbleType: 'domain', status: 'active', activity: 1 });
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
function footprintOf(bubble: BubbleData, node: Node | undefined, input: WebOrbitSeatingInput): { w: number; h: number } {
  const w = node?.measured?.width;
  const h = node?.measured?.height;
  if (typeof w === 'number' && w > 0 && typeof h === 'number' && h > 0) return { w, h };
  if (input.cardForm && isAgentCardForm(bubble)) return { w: AGENT_CARD.width, h: AGENT_CARD.height };
  const d = calcBubbleSize(bubble, localRangeOf(bubble) ?? input.fileSizeRange, input.heat);
  return { w: d, h: d };
}

/**
 * 새 웹 버블들의 첫 자리(좌상단 좌표). 이미 자리가 있는 버블은 하나도 옮기지 않는다 — 이 함수가 정하는
 * 것은 처음 설 자리뿐이다(§5.23 웹 궤도 (f)).
 */
export function seatWebOrbitBubbles(input: WebOrbitSeatingInput): Map<string, { x: number; y: number }> {
  const nodeById = new Map<string, Node>();
  for (const node of input.nodes) nodeById.set(node.id, node);
  const pendingIds = new Set(input.pending.map((b) => b.id));

  // 사각 상자(말풍선)도 원으로 잰다 — 반경을 긴 변의 반으로 잡아 궤도가 상자를 밟지 않게 한다.
  const placed = new Map<string, OrbitCircle>();
  const readers = new Map<string, number>();
  for (const bubble of input.bubbles) {
    if (pendingIds.has(bubble.id)) continue;
    const pos = input.positions.get(bubble.id);
    if (!pos) continue;
    const { w, h } = footprintOf(bubble, nodeById.get(bubble.id), input);
    placed.set(bubble.id, { cx: pos.x + w / 2, cy: pos.y + h / 2, r: Math.max(w, h) / 2 });
    if (LINEAGE_HUB_TYPES.has(bubble.bubbleType)) readers.set(bubble.id, bubble.lastActivity ?? 0);
  }

  const diameterById = new Map<string, number>();
  const pending = input.pending.map((bubble) => {
    const diameter = calcBubbleSize(bubble, undefined, input.heat);
    diameterById.set(bubble.id, diameter);
    return { id: bubble.id, diameter, lastActivity: bubble.lastActivity };
  });

  const centers = seatWebOrbitBatch({
    pending,
    placed,
    edges: input.edges,
    readers,
    slotDiameter: webOrbitSlotDiameter(),
    bounds: input.bounds,
    fallbackCenter: input.fallbackCenter,
  });

  const out = new Map<string, { x: number; y: number }>();
  for (const [id, c] of centers) {
    const d = diameterById.get(id) ?? 0;
    out.set(id, { x: c.cx - d / 2, y: c.cy - d / 2 });
  }
  return out;
}
