import { TIDY_LAYOUT, WEB_ORBIT } from '@vibisual/shared';
import { MAGNET_GAP } from '../../hooks/physicsGeometry.js';

/**
 * §5.23 **웹 궤도** — 새 도메인 버블이 처음 설 자리를 정하는 순수 기하.
 *
 * 종전에는 새 버블의 첫 자리를 `radialLayout` 이 정했다. 에이전트가 아닌 최상위 버블 전부를 원 하나에
 * 순번대로 세우고 반지름이 개수에 비례해 자라서(180 + N×20), 자료조사 한 번에 호스트가 100곳 서면
 * 원이 물리 상자를 넘고 클램프가 그 버블들을 상자 벽에 눌러 **사각 테두리**를 만들었다(사용자 보고
 * "과도하게 나온다"). 여기서는 그 대신 **읽은 에이전트 둘레의 동심 궤도**에서 첫 빈칸을 고른다 —
 * 12시에서 시작해 시계 방향, 안쪽 궤도부터. 리서치 순서가 시곗바늘처럼 읽힌다.
 *
 * 화면(React Flow 노드·스토어)을 모른다 — 원과 상자만 받는다. 화면 값을 원으로 바꾸는 것은
 * `webOrbitSeating.ts` 다. UI 없이 숫자로 검증한다(`webOrbit.test.ts`).
 */

/** 원 하나 — 중심과 반경(px). */
export interface OrbitCircle {
  cx: number;
  cy: number;
  r: number;
}

/** 물리 상자 — 중심과 반치수(px). 물리 클램프(`usePhysicsLayout`)가 버블을 가두는 그 상자다. */
export interface OrbitBounds {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
}

export interface WebOrbitSeatInput {
  /** 궤도의 중심 — 읽은 에이전트(없으면 반경 0 인 캔버스 중심). */
  anchor: OrbitCircle;
  /** 앉힐 버블의 지름(px). 겹침 판정에 쓴다. */
  diameter: number;
  /**
   * 궤도 칸의 기준 지름(px). 궤도 반경과 칸 수를 정한다 — **모든 칸이 같은 격자를 나눠 써야** 궤도가
   * 궤도로 보이므로, 버블마다 제 지름으로 격자를 다시 짜지 않는다(큰 버블은 겹침 판정이 걸러 낸다).
   */
  slotDiameter: number;
  /** 이미 떠 있는 것들 — 에이전트·폴더·위성 모두. */
  occupied: readonly OrbitCircle[];
  bounds: OrbitBounds;
}

/** 앉을 자리(중심 좌표). `free` 가 false 면 빈칸이 없어 겹친 채 세운 것이다 — 남은 겹침은 물리가 푼다. */
export interface WebOrbitSeat {
  cx: number;
  cy: number;
  free: boolean;
}

/** 화면에 그려진 선 하나의 두 끝(`flowEdges` 와 같은 모양). */
export interface OrbitEdgeRef {
  source: string;
  target: string;
}

const TWO_PI = Math.PI * 2;

/**
 * `ring` 번째 궤도의 반경. 첫 궤도는 앵커 테두리에서 `RING_GAP` 밖, 궤도 사이는 `ROW_GAP` —
 * §5.4 #33 정리와 같은 간격이라 물리가 다시 밀어낼 이유가 없다.
 */
export function webOrbitRingRadius(anchorRadius: number, slotDiameter: number, ring: number): number {
  return anchorRadius + TIDY_LAYOUT.RING_GAP + slotDiameter / 2 + ring * (slotDiameter + TIDY_LAYOUT.ROW_GAP);
}

/** 반경 `radius` 궤도의 칸 수 — 이웃 사이 호가 `칸 지름 + RING_GAP` 이 되도록. */
export function webOrbitSlotCount(radius: number, slotDiameter: number): number {
  return Math.max(1, Math.floor((TWO_PI * radius) / (slotDiameter + TIDY_LAYOUT.RING_GAP)));
}

/** `slot` 번째 칸의 중심 — `WEB_ORBIT.START_ANGLE`(12시)에서 시계 방향. */
function slotCenter(anchor: OrbitCircle, radius: number, slot: number, count: number): { cx: number; cy: number } {
  const theta = WEB_ORBIT.START_ANGLE + (slot * TWO_PI) / count;
  return { cx: anchor.cx + Math.cos(theta) * radius, cy: anchor.cy + Math.sin(theta) * radius };
}

/** 물리 클램프와 같은 판정 — 중심이 `상자 반치수 − 반경` 안에 있어야 벽에 눌리지 않는다. */
function insideBounds(cx: number, cy: number, r: number, b: OrbitBounds): boolean {
  return Math.abs(cx - b.cx) <= b.hw - r && Math.abs(cy - b.cy) <= b.hh - r;
}

/** 이미 떠 있는 것 중 하나라도 물리 최소 간격(`MAGNET_GAP`) 안으로 들어오는가. */
function overlapsAny(cx: number, cy: number, r: number, occupied: readonly OrbitCircle[]): boolean {
  for (const o of occupied) {
    const need = r + o.r + MAGNET_GAP;
    const dx = cx - o.cx;
    const dy = cy - o.cy;
    if (dx * dx + dy * dy < need * need) return true;
  }
  return false;
}

/** 앵커에서 상자의 가장 먼 모서리까지 — 이보다 큰 궤도에는 상자 안 칸이 없다(탐색이 끝나는 자리). */
function farthestCorner(anchor: OrbitCircle, b: OrbitBounds): number {
  const dx = Math.max(Math.abs(anchor.cx - (b.cx - b.hw)), Math.abs(anchor.cx - (b.cx + b.hw)));
  const dy = Math.max(Math.abs(anchor.cy - (b.cy - b.hh)), Math.abs(anchor.cy - (b.cy + b.hh)));
  return Math.hypot(dx, dy);
}

function allFinite(...values: number[]): boolean {
  return values.every((v) => Number.isFinite(v));
}

/**
 * 첫 빈칸 — 안쪽 궤도부터, 궤도 안에서는 12시에서 시계 방향으로 훑어 처음 만나는 빈칸에 앉는다.
 *
 * 빈칸 = 물리 상자 안 + 이미 떠 있는 어떤 것과도 물리 최소 간격 안으로 겹치지 않음. 앞서 사라진 자리는
 * 다음 버블이 채운다(같은 순서로 다시 훑으므로). 상자 안에 빈칸이 하나도 없으면 상자 안의 첫 칸에
 * 겹친 채 세운다 — 어디에도 세우지 않는 것보다 낫고, 남은 겹침은 물리가 푼다.
 */
export function webOrbitSeat(input: WebOrbitSeatInput): WebOrbitSeat {
  const { anchor, occupied, bounds } = input;
  const diameter = Number.isFinite(input.diameter) && input.diameter > 0 ? input.diameter : 0;
  // 칸 지름이 깨져 들어오면 격자를 짤 수 없다 — 그 버블의 지름으로 대신한다(반경이 NaN 이면 탐색이 끝나지 않는다).
  const slot = Number.isFinite(input.slotDiameter) && input.slotDiameter > 0 ? input.slotDiameter : Math.max(1, diameter);
  const r = diameter / 2;
  const firstSlot = (): WebOrbitSeat => ({
    ...slotCenter(anchor, webOrbitRingRadius(anchor.r, slot, 0), 0, 1),
    free: false,
  });
  if (!allFinite(anchor.cx, anchor.cy, anchor.r, bounds.cx, bounds.cy, bounds.hw, bounds.hh)) return firstSlot();

  const reach = farthestCorner(anchor, bounds) + slot;
  let firstInside: WebOrbitSeat | null = null;
  for (let ring = 0; ; ring++) {
    const radius = webOrbitRingRadius(anchor.r, slot, ring);
    if (radius > reach) break;
    const count = webOrbitSlotCount(radius, slot);
    for (let i = 0; i < count; i++) {
      const { cx, cy } = slotCenter(anchor, radius, i, count);
      if (!insideBounds(cx, cy, r, bounds)) continue;
      if (!overlapsAny(cx, cy, r, occupied)) return { cx, cy, free: true };
      if (firstInside === null) firstInside = { cx, cy, free: false };
    }
  }
  // 상자 안에 든 칸이 하나도 없으면(앵커가 상자 밖이거나 상자가 버블보다 작다) 첫 칸에 세우고 클램프에 넘긴다.
  return firstInside ?? firstSlot();
}

/**
 * 이 버블을 읽은 쪽 — 화면의 선으로 이어진 것 중 `readers`(에이전트)에 든 것, 그중 활동이 가장 최근인
 * 쪽이다(동점은 id 순). §5.4 #33 (I-3) `lineage` 와 같은 규칙이다 — 한 버블은 한 자리에만 앉는다.
 * 이어진 에이전트가 없으면 `null`.
 */
export function webOrbitReaderOf(
  id: string,
  edges: readonly OrbitEdgeRef[],
  readers: ReadonlyMap<string, number>,
): string | null {
  let best: string | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const e of edges) {
    const other = e.source === id ? e.target : e.target === id ? e.source : null;
    if (other === null || other === id) continue;
    const at = readers.get(other);
    if (at === undefined) continue;
    if (at > bestAt || (at === bestAt && best !== null && other < best)) {
      best = other;
      bestAt = at;
    }
  }
  return best;
}

/** 이번에 첫 자리를 받을 버블 하나. */
export interface PendingOrbitBubble {
  id: string;
  diameter: number;
  lastActivity?: number;
}

export interface WebOrbitBatchInput {
  pending: readonly PendingOrbitBubble[];
  /** 이미 자리가 있는 것 — id → 원. 장애물이자, 앵커(에이전트)를 찾는 곳이다. */
  placed: ReadonlyMap<string, OrbitCircle>;
  edges: readonly OrbitEdgeRef[];
  /** 앵커가 될 수 있는 버블(에이전트) id → 마지막 활동. */
  readers: ReadonlyMap<string, number>;
  slotDiameter: number;
  bounds: OrbitBounds;
  /** 읽은 에이전트가 화면에 없을 때 궤도의 중심(캔버스 중심). */
  fallbackCenter: { x: number; y: number };
}

/**
 * 이번에 자리를 받을 버블들을 차례로 앉힌다 — **마지막 활동이 이른 것부터**라 리서치 순서가 곧 시계
 * 순서다(동점은 id 순 — 같은 입력이 늘 같은 그림을 낸다). 먼저 앉은 것은 다음 것의 장애물이 된다.
 * 돌려주는 것은 **중심** 좌표다.
 */
export function seatWebOrbitBatch(input: WebOrbitBatchInput): Map<string, { cx: number; cy: number }> {
  const order = [...input.pending].sort((a, b) => {
    const byTime = (a.lastActivity ?? 0) - (b.lastActivity ?? 0);
    if (byTime !== 0) return byTime;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const occupied: OrbitCircle[] = [...input.placed.values()];
  const out = new Map<string, { cx: number; cy: number }>();
  for (const p of order) {
    const readerId = webOrbitReaderOf(p.id, input.edges, input.readers);
    const anchor = (readerId !== null ? input.placed.get(readerId) : undefined)
      ?? { cx: input.fallbackCenter.x, cy: input.fallbackCenter.y, r: 0 };
    const seat = webOrbitSeat({
      anchor,
      diameter: p.diameter,
      slotDiameter: input.slotDiameter,
      occupied,
      bounds: input.bounds,
    });
    out.set(p.id, { cx: seat.cx, cy: seat.cy });
    occupied.push({ cx: seat.cx, cy: seat.cy, r: p.diameter / 2 });
  }
  return out;
}
