import { PHYSICS_MAGNET_GAP, SPAWN_ZONE, TIDY_LAYOUT } from '@vibisual/shared';

/**
 * §5.1 #2-2 **등장 영역** — 새 버블이 처음 설 자리를 정하는 순수 기하.
 *
 * 종전 첫 자리는 셋 다 주인과 무관하거나 무작위였다 — 최상위 버블은 `radialLayout` 의 큰 원에 목록 순번대로,
 * 파일 위성은 부모 둘레 250px 안 무작위, 고정 노드는 루트 둘레 무작위. 여기서는 하나의 규칙으로 앉힌다.
 *
 * 1. **칸** — 주인 둘레 동심 고리. 고리마다 12시에서 시작해 시계 방향으로 칸을 나눈다.
 * 2. **세기** — 고리 0..k 를 덮는 원판 안에 중심이 든 것을 **주인이 누구든 전부** 센다(주인 자신만 뺀다).
 *    원형 버블은 하나, 사각 창·말풍선은 원판 안에 든 넓이를 칸 넓이로 나눈 개수.
 * 3. **넓히기** — 센 수가 그 원판의 칸 수 이상이면 고리 하나를 넓힌다. 수가 칸 수보다 적은 첫 원판이 등장
 *    영역이고, 새 버블은 그 영역의 **가장 바깥 고리**의 첫 빈칸에 선다(붐빈 안쪽 틈에 끼워 넣지 않는다).
 * 4. **고르게** (§5.1 #2-2 (J)) — 첫 고리는 주인이 거느릴 수(`firstRingSlots` — 폴더의 위성 상한 · 묶음의 구성 수)만큼만 나눈다.
 *    다 차면 정다각형으로 둘러싸고, 덜 차면 12시부터 시계 방향의 호다 — 담을 수 있는 칸을 다 쓰면 한쪽에 몰린 초승달이 된다.
 *
 * 화면(React Flow 노드·스토어)을 모른다 — 원·사각·상자만 받는다. 화면 값을 이 모양으로 바꾸는 것은
 * `components/BubbleMap/spawnZoneSeating.ts`, 위성 첫 자리는 `satellite.ts` 의 `placeSatellitePositions` 다.
 * UI 없이 숫자로 검증한다(`spawnZone.test.ts`).
 */

/** 이미 떠 있는 것 하나 — 원(버블) 또는 사각(창·말풍선). 세기와 겹침 판정이 같은 목록을 본다. */
export interface ZoneObstacle {
  id: string;
  cx: number;
  cy: number;
  /** 원의 반경. 사각이면 긴 변의 반 — 그것이 주인이 될 때 고리의 기준이 된다. */
  r: number;
  /** 사각이면 반치수 — 둘 다 있으면 사각으로 겹침·넓이를 잰다. */
  hw?: number;
  hh?: number;
  /**
   * §5.1 #2-2 (J) — 이 칸이 **주인**이 될 때의 반경. 달을 거느린 위성(묶음)은 장애물로는 달 궤도까지가 몸(`r`)이지만, 제 달을
   * 앉힐 때의 주인은 제 원이다. 없으면 `r`.
   */
  core?: number;
}

/** 물리 상자 — 중심과 반치수(px). 물리 클램프(`usePhysicsLayout`)가 버블을 가두는 그 상자다. */
export interface ZoneBounds {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
}

/** 한 주인 둘레의 격자. */
export interface ZoneGrid {
  /** 칸의 기준 지름(px) — 한 주인 둘레가 한 격자를 나눠 쓴다. */
  slot: number;
  /** 주인 테두리와 첫 고리 버블 테두리 사이 틈(px). 최상위 `RING_GAP` · 위성 `SATELLITE_ORBIT_GAP`. */
  firstGap: number;
  /** 같은 고리 이웃 사이 틈(호, px). 없으면 `TIDY_LAYOUT.RING_GAP` — 위성은 `SATELLITE_RING_SPACING.NEIGHBOR_GAP`(§5.1 #2-2 (J)). */
  neighborGap?: number;
  /** 고리 사이 틈(px). 없으면 `TIDY_LAYOUT.ROW_GAP` — 위성은 `SATELLITE_RING_SPACING.ROW_GAP`. */
  rowGap?: number;
  /**
   * §5.1 #2-2 (J) — 첫 고리를 이 수만큼만 나눈다(주인이 거느릴 위성 수 — 폴더는 위성 상한, 묶음은 구성 수). 다 차면 정다각형으로
   * 고르게 둘러싸고, 덜 차면 12시부터 시계 방향의 호다. 고리가 그만큼 담지 못하면 담을 수 있는 만큼이다(`fitFirstRing` 이 아니면).
   */
  firstRingSlots?: number;
  /** 첫 고리가 `firstRingSlots` 를 다 담도록 반경을 넓힌다 — 고리 하나에만 앉는 달(묶음의 구성)은 넘칠 바깥 고리가 없다. */
  fitFirstRing?: boolean;
}

/** 영역의 주인 — 중심과 반경. `id` 가 있으면 세기에서 그 자신을 뺀다(없으면 캔버스 중심 같은 빈 자리). */
export interface ZoneAnchor {
  id: string | null;
  cx: number;
  cy: number;
  r: number;
}

export interface ZoneSeatInput {
  anchor: ZoneAnchor;
  /** 앉힐 버블의 지름(px). */
  diameter: number;
  grid: ZoneGrid;
  /** 이미 떠 있는 것들 — 장애물이자 셀 거리. */
  obstacles: readonly ZoneObstacle[];
  /** 물리 상자. `null` 이면 상자 없이(고리 수 상한 `SPAWN_ZONE.MAX_RINGS` 까지) 훑는다. */
  bounds: ZoneBounds | null;
  /** 이 고리에만 앉는다 — 별자리 달(궤도가 무리의 표식이라 넓히지 않는다). */
  onlyRing?: number;
}

/** 앉을 자리(중심 좌표). `free` 가 false 면 빈칸이 없어 겹친 채 세운 것이다 — 남은 겹침은 물리가 푼다. */
export interface ZoneSeat {
  cx: number;
  cy: number;
  free: boolean;
  /** 앉은 고리. */
  ring: number;
  /** 등장 영역 단계(센 수가 칸 수보다 적은 첫 원판). */
  level: number;
}

/** 화면에 그려진 선 하나의 두 끝(`flowEdges` 와 같은 모양). */
export interface ZoneEdgeRef {
  source: string;
  target: string;
}

const TWO_PI = Math.PI * 2;

function finitePositive(v: number): boolean {
  return Number.isFinite(v) && v > 0;
}

function isRect(o: ZoneObstacle): o is ZoneObstacle & { hw: number; hh: number } {
  return typeof o.hw === 'number' && typeof o.hh === 'number' && Number.isFinite(o.hw) && Number.isFinite(o.hh);
}

/** 같은 고리 이웃 사이 틈 — 격자가 정하지 않으면 최상위 간격(`RING_GAP`). */
function neighborGapOf(grid: ZoneGrid): number {
  return grid.neighborGap ?? TIDY_LAYOUT.RING_GAP;
}

/** 고리 사이 간격 — 한 고리에서 다음 고리까지(px). */
function ringStep(grid: ZoneGrid): number {
  return grid.slot + (grid.rowGap ?? TIDY_LAYOUT.ROW_GAP);
}

/** 첫 고리를 나눌 수(정한 것이 있으면) — 1 보다 작거나 숫자가 아니면 정하지 않은 것이다. */
function firstRingSlotsOf(grid: ZoneGrid): number | null {
  const n = grid.firstRingSlots;
  return typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
}

/**
 * 첫 고리의 격자 반경 — 주인 테두리에서 `firstGap` 밖. `fitFirstRing` 이면 `firstRingSlots` 칸이 다 들어가도록
 * (칸마다 호 `칸 지름 + 이웃 틈`) 반경을 넓힌다.
 */
function firstRingRadius(anchorR: number, grid: ZoneGrid): number {
  const base = anchorR + grid.firstGap + grid.slot / 2;
  const slots = grid.fitFirstRing === true ? firstRingSlotsOf(grid) : null;
  if (slots === null) return base;
  return Math.max(base, (slots * (grid.slot + neighborGapOf(grid))) / TWO_PI);
}

/**
 * `ring` 번째 고리의 **격자** 반경 — 칸 지름 버블이 앉는 반경이다. 칸 수·원판(세기)은 이 반경으로 잰다.
 * 첫 고리는 주인 테두리에서 `firstGap` 밖, 고리 사이는 `ROW_GAP` — §5.4 #33 정리와 같은 간격이다.
 */
export function zoneGridRadius(anchorR: number, grid: ZoneGrid, ring: number): number {
  return firstRingRadius(anchorR, grid) + ring * ringStep(grid);
}

/**
 * 지름 `diameter` 버블이 `ring` 번째 고리에 앉는 반경 — 제 크기와 상관없이 **주인 테두리와의 틈이 같게**
 * 앉는다(칸보다 큰 버블은 지름 차의 반만큼 바깥). 위성의 첫 고리는 곧 물리 스프링의 평형점이다.
 */
export function zoneSeatRadius(anchorR: number, grid: ZoneGrid, diameter: number, ring: number): number {
  return zoneGridRadius(anchorR, grid, ring) + (diameter - grid.slot) / 2;
}

/**
 * 반경 `radius` 고리의 칸 수 — 이웃 사이 호가 `칸 지름 + 이웃 틈` 이 되도록. 반경을 칸 수에 맞춰 넓힌 고리(`fitFirstRing`)가
 * 부동소수 오차로 한 칸을 잃지 않게 아주 작은 여유를 둔다.
 */
export function zoneSlotCount(radius: number, slot: number, neighborGap: number = TIDY_LAYOUT.RING_GAP): number {
  return Math.max(1, Math.floor((TWO_PI * radius) / (slot + neighborGap) + 1e-9));
}

/** `ring` 번째 고리의 칸 수 — 첫 고리는 주인이 거느릴 수(`firstRingSlots`)까지만 나눈다(§5.1 #2-2 (J)). */
export function zoneRingSlots(anchorR: number, grid: ZoneGrid, ring: number): number {
  const physical = zoneSlotCount(zoneGridRadius(anchorR, grid, ring), grid.slot, neighborGapOf(grid));
  const slots = ring === 0 ? firstRingSlotsOf(grid) : null;
  return slots === null ? physical : Math.min(physical, slots);
}

/** `level` 단계 원판의 반경 — 그 고리 띠의 바깥 끝(고리 사이 간격의 반까지). */
export function zoneDiscRadius(anchorR: number, grid: ZoneGrid, level: number): number {
  return zoneGridRadius(anchorR, grid, level) + ringStep(grid) / 2;
}

/** `level` 단계 원판의 수용량 — 고리 0..level 의 칸 수 합. */
export function zoneCapacity(anchorR: number, grid: ZoneGrid, level: number): number {
  let sum = 0;
  for (let k = 0; k <= level; k++) sum += zoneRingSlots(anchorR, grid, k);
  return sum;
}

/** 칸 하나가 차지하는 넓이 — 사각 창을 "칸 몇 개"로 셀 때의 단위. */
export function zoneCellArea(grid: ZoneGrid): number {
  return (grid.slot + neighborGapOf(grid)) * ringStep(grid);
}

/** 사각 하나의 표본 — 격자 칸 가운데들의 주인 중심까지 거리(오름차순). */
function rectSampleDistances(o: ZoneObstacle & { hw: number; hh: number }, anchor: ZoneAnchor): number[] {
  const n = Math.max(1, Math.floor(SPAWN_ZONE.AREA_SAMPLES));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = o.cx - o.hw + ((i + 0.5) * 2 * o.hw) / n;
    for (let j = 0; j < n; j++) {
      const y = o.cy - o.hh + ((j + 0.5) * 2 * o.hh) / n;
      out.push(Math.hypot(x - anchor.cx, y - anchor.cy));
    }
  }
  return out.sort((a, b) => a - b);
}

/** 정렬된 거리 목록에서 `limit` 이하인 것의 수(이분 탐색). */
function countWithin(sorted: readonly number[], limit: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= limit) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 원판 안에 든 넓이를 칸 개수로 — 걸치면 최소 하나, 안 걸치면 0. */
function rectWeight(samples: readonly number[], area: number, discR: number, cellArea: number): number {
  const inside = countWithin(samples, discR);
  if (inside === 0) return 0;
  return Math.max(1, Math.round(((inside / samples.length) * area) / cellArea));
}

interface PreparedCount {
  /** 원형: 처음 들어가는 단계별 개수(히스토그램). */
  circleAt: number[];
  /** 사각: 표본 거리 + 넓이. */
  rects: { samples: number[]; area: number }[];
}

function prepareCount(anchor: ZoneAnchor, grid: ZoneGrid, obstacles: readonly ZoneObstacle[], maxLevel: number): PreparedCount {
  const circleAt = new Array<number>(maxLevel + 1).fill(0);
  const rects: { samples: number[]; area: number }[] = [];
  const base = zoneDiscRadius(anchor.r, grid, 0);
  const step = ringStep(grid);
  for (const o of obstacles) {
    if (anchor.id !== null && o.id === anchor.id) continue;
    if (!Number.isFinite(o.cx) || !Number.isFinite(o.cy)) continue;
    if (isRect(o)) {
      if (!(o.hw > 0) || !(o.hh > 0)) continue;
      rects.push({ samples: rectSampleDistances(o, anchor), area: 4 * o.hw * o.hh });
      continue;
    }
    const dist = Math.hypot(o.cx - anchor.cx, o.cy - anchor.cy);
    // 처음 그 중심을 품는 단계 — 원판 반경은 단계마다 `step` 씩 자란다.
    const level = dist <= base ? 0 : Math.ceil((dist - base) / step);
    if (level <= maxLevel) circleAt[level]! += 1;
  }
  return { circleAt, rects };
}

function occupancyAt(prepared: PreparedCount, anchorR: number, grid: ZoneGrid, level: number, circlesSoFar: number): number {
  const discR = zoneDiscRadius(anchorR, grid, level);
  const cell = zoneCellArea(grid);
  let sum = circlesSoFar;
  for (const rect of prepared.rects) sum += rectWeight(rect.samples, rect.area, discR, cell);
  return sum;
}

/**
 * `level` 단계 원판 안에 든 것의 수 — 주인이 누구든 전부(주인 자신만 뺀다). 원형은 중심이 들면 하나,
 * 사각은 든 넓이를 칸 넓이로 나눈 개수(걸치면 최소 하나).
 */
export function zoneOccupancy(anchor: ZoneAnchor, grid: ZoneGrid, obstacles: readonly ZoneObstacle[], level: number): number {
  const prepared = prepareCount(anchor, grid, obstacles, level);
  let circles = 0;
  for (let k = 0; k <= level; k++) circles += prepared.circleAt[k]!;
  return occupancyAt(prepared, anchor.r, grid, level, circles);
}

/**
 * 등장 영역 단계 — 센 수가 수용량보다 적은 첫 원판. `maxLevel` 까지 다 붐볐으면 `maxLevel + 1`
 * (상자 안에는 넓힐 자리가 없다는 뜻 — 호출부가 안쪽 틈을 찾는다).
 */
export function zoneLevel(anchor: ZoneAnchor, grid: ZoneGrid, obstacles: readonly ZoneObstacle[], maxLevel: number): number {
  const prepared = prepareCount(anchor, grid, obstacles, maxLevel);
  let circles = 0;
  let capacity = 0;
  for (let k = 0; k <= maxLevel; k++) {
    circles += prepared.circleAt[k]!;
    capacity += zoneRingSlots(anchor.r, grid, k);
    if (occupancyAt(prepared, anchor.r, grid, k, circles) < capacity) return k;
  }
  return maxLevel + 1;
}

/** 물리 클램프와 같은 판정 — 중심이 `상자 반치수 − 반경` 안에 있어야 벽에 눌리지 않는다. */
function insideBounds(cx: number, cy: number, r: number, b: ZoneBounds): boolean {
  return Math.abs(cx - b.cx) <= b.hw - r && Math.abs(cy - b.cy) <= b.hh - r;
}

/** 이미 떠 있는 것 중 하나라도 물리 최소 간격 안으로 들어오는가. 사각은 테두리에서 잰다. */
function overlapsAny(cx: number, cy: number, r: number, obstacles: readonly ZoneObstacle[]): boolean {
  for (const o of obstacles) {
    if (isRect(o)) {
      const nx = Math.max(o.cx - o.hw, Math.min(cx, o.cx + o.hw));
      const ny = Math.max(o.cy - o.hh, Math.min(cy, o.cy + o.hh));
      const dx = cx - nx;
      const dy = cy - ny;
      const need = r + PHYSICS_MAGNET_GAP;
      if (dx * dx + dy * dy < need * need) return true;
      continue;
    }
    const need = r + o.r + PHYSICS_MAGNET_GAP;
    const dx = cx - o.cx;
    const dy = cy - o.cy;
    if (dx * dx + dy * dy < need * need) return true;
  }
  return false;
}

/** 주인에서 상자의 가장 먼 모서리까지 — 이보다 큰 고리에는 상자 안 칸이 없다(탐색이 끝나는 자리). */
function farthestCorner(anchor: ZoneAnchor, b: ZoneBounds): number {
  const dx = Math.max(Math.abs(anchor.cx - (b.cx - b.hw)), Math.abs(anchor.cx - (b.cx + b.hw)));
  const dy = Math.max(Math.abs(anchor.cy - (b.cy - b.hh)), Math.abs(anchor.cy - (b.cy + b.hh)));
  return Math.hypot(dx, dy);
}

function validBounds(b: ZoneBounds | null): ZoneBounds | null {
  if (!b) return null;
  return [b.cx, b.cy, b.hw, b.hh].every((v) => Number.isFinite(v)) ? b : null;
}

/**
 * 한 버블의 첫 자리.
 *
 * 등장 영역 단계 K(센 수 < 수용량인 첫 원판)를 구하고 **고리 K 부터 바깥으로** 훑어 첫 빈칸에 앉는다 —
 * 고리 안에서는 12시에서 시계 방향. 바깥이 상자를 넘어 빈칸이 없을 때만 안쪽 고리(0..K-1)의 빈칸을 쓰고,
 * 그래도 없으면 훑은 순서의 상자 안 첫 칸에 겹친 채 세운다(남은 겹침은 물리가 푼다).
 */
export function seatInZone(input: ZoneSeatInput): ZoneSeat {
  const { obstacles } = input;
  const bounds = validBounds(input.bounds);
  const diameter = finitePositive(input.diameter) ? input.diameter : 0;
  // 칸 지름이 깨져 들어오면 격자를 짤 수 없다 — 그 버블의 지름으로 대신한다(반경이 NaN 이면 탐색이 끝나지 않는다).
  const slot = finitePositive(input.grid.slot) ? input.grid.slot : Math.max(1, diameter);
  const firstGap = Number.isFinite(input.grid.firstGap) && input.grid.firstGap > 0 ? input.grid.firstGap : 0;
  const nonNegative = (v: number | undefined): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
  const neighborGap = nonNegative(input.grid.neighborGap);
  const rowGap = nonNegative(input.grid.rowGap);
  const grid: ZoneGrid = {
    slot,
    firstGap,
    ...(neighborGap !== undefined ? { neighborGap } : {}),
    ...(rowGap !== undefined ? { rowGap } : {}),
    ...(input.grid.firstRingSlots !== undefined ? { firstRingSlots: input.grid.firstRingSlots } : {}),
    ...(input.grid.fitFirstRing === true ? { fitFirstRing: true } : {}),
  };
  const anchor: ZoneAnchor = {
    id: input.anchor.id,
    cx: Number.isFinite(input.anchor.cx) ? input.anchor.cx : (bounds?.cx ?? 0),
    cy: Number.isFinite(input.anchor.cy) ? input.anchor.cy : (bounds?.cy ?? 0),
    r: Number.isFinite(input.anchor.r) && input.anchor.r > 0 ? input.anchor.r : 0,
  };
  const r = diameter / 2;

  const slotCenter = (ring: number, i: number, count: number): { cx: number; cy: number } => {
    const radius = zoneSeatRadius(anchor.r, grid, diameter, ring);
    const theta = SPAWN_ZONE.START_ANGLE + (i * TWO_PI) / count;
    return { cx: anchor.cx + Math.cos(theta) * radius, cy: anchor.cy + Math.sin(theta) * radius };
  };

  // 상자 안 칸이 있을 수 있는 마지막 고리.
  let maxRing: number = SPAWN_ZONE.MAX_RINGS;
  if (bounds) {
    const reach = farthestCorner(anchor, bounds) + slot;
    maxRing = Math.max(0, Math.floor((reach - zoneGridRadius(anchor.r, grid, 0)) / ringStep(grid)));
  }

  const rings: number[] = [];
  let level = 0;
  if (typeof input.onlyRing === 'number' && Number.isFinite(input.onlyRing) && input.onlyRing >= 0) {
    level = Math.floor(input.onlyRing);
    rings.push(level);
  } else {
    level = zoneLevel(anchor, grid, obstacles, maxRing);
    for (let k = level; k <= maxRing; k++) rings.push(k);
    for (let k = 0; k < Math.min(level, maxRing + 1); k++) rings.push(k);
  }

  // 고리 하나의 칸이 닿을 수 있는 것만 겹침을 잰다 — 주인에서의 거리와 고리 반경의 차가 (반경 + 간격 + 그것의
  //   크기) 를 넘으면 그 고리의 어느 칸과도 겹칠 수 없다. 첫 화면에 위성 수백이 한꺼번에 앉을 때 칸마다 화면
  //   전체를 훑지 않게 한다(결과는 전부 훑은 것과 같다).
  //   주인 자신은 제 원(`core`)으로 잰다 — 달을 거느린 위성(묶음)은 장부에 달 궤도까지가 몸으로 올라 있어, 그대로 재면 제 달이
  //   앉을 칸을 전부 자기가 막는다.
  const ranged = obstacles.map((raw) => {
    const o = anchor.id !== null && raw.id === anchor.id && typeof raw.core === 'number' && Number.isFinite(raw.core)
      ? { ...raw, r: raw.core }
      : raw;
    return {
      o,
      d: Math.hypot(o.cx - anchor.cx, o.cy - anchor.cy),
      extent: isRect(o) ? Math.hypot(o.hw, o.hh) : Math.max(0, o.r),
    };
  });
  const reachOf = (ring: number): ZoneObstacle[] => {
    const radius = zoneSeatRadius(anchor.r, grid, diameter, ring);
    const out: ZoneObstacle[] = [];
    for (const it of ranged) {
      if (!(Math.abs(it.d - radius) >= r + PHYSICS_MAGNET_GAP + it.extent)) out.push(it.o);
    }
    return out;
  };

  let firstInside: ZoneSeat | null = null;
  for (const ring of rings) {
    const count = zoneRingSlots(anchor.r, grid, ring);
    const near = reachOf(ring);
    for (let i = 0; i < count; i++) {
      const { cx, cy } = slotCenter(ring, i, count);
      if (bounds && !insideBounds(cx, cy, r, bounds)) continue;
      if (!overlapsAny(cx, cy, r, near)) return { cx, cy, free: true, ring, level };
      if (firstInside === null) firstInside = { cx, cy, free: false, ring, level };
    }
  }
  // 상자 안에 든 칸이 하나도 없으면(주인이 상자 밖이거나 상자가 버블보다 작다) 첫 고리 12시에 세우고 클램프에 넘긴다.
  const ring0 = rings[0] ?? 0;
  return firstInside ?? { ...slotCenter(ring0, 0, 1), free: false, ring: ring0, level };
}

/**
 * 이 버블의 주인 — 화면의 선으로 이어진 것 중 `hubs`(에이전트)에 든 것, 그중 활동이 가장 최근인 쪽이다
 * (동점은 id 순). §5.4 #33 (I-3) `lineage` 와 같은 규칙이다 — 한 버블은 한 자리에만 앉는다.
 * 이어진 에이전트가 없으면 `null`.
 */
export function spawnOwnerOf(
  id: string,
  edges: readonly ZoneEdgeRef[],
  hubs: ReadonlyMap<string, number>,
): string | null {
  let best: string | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const e of edges) {
    const other = e.source === id ? e.target : e.target === id ? e.source : null;
    if (other === null || other === id) continue;
    const at = hubs.get(other);
    if (at === undefined) continue;
    if (at > bestAt || (at === bestAt && best !== null && other < best)) {
      best = other;
      bestAt = at;
    }
  }
  return best;
}

/**
 * 한 화면의 등장 영역 장부 — 이미 자리가 있는 것 전부(버블·위성·사각 창). 앉힌 것은 뒤에 더해져
 * 다음 버블의 장애물이자 셀 거리가 된다(최상위를 앉힌 뒤 위성을 앉힐 때도 같은 장부를 이어 쓴다).
 */
export interface SpawnField {
  obstacles: ZoneObstacle[];
  byId: Map<string, ZoneObstacle>;
  bounds: ZoneBounds | null;
}

export function createSpawnField(obstacles: readonly ZoneObstacle[], bounds: ZoneBounds | null): SpawnField {
  const field: SpawnField = { obstacles: [], byId: new Map(), bounds };
  for (const o of obstacles) addToSpawnField(field, o);
  return field;
}

export function addToSpawnField(field: SpawnField, o: ZoneObstacle): void {
  const prev = field.byId.get(o.id);
  if (prev) {
    const at = field.obstacles.indexOf(prev);
    if (at >= 0) field.obstacles.splice(at, 1);
  }
  field.obstacles.push(o);
  field.byId.set(o.id, o);
}

/**
 * 장부의 한 칸을 주인으로 — 사각은 긴 변의 반이 반경이다(고리가 상자를 밟지 않게). 달을 거느린 위성(묶음)은 장부에 달
 * 궤도까지가 몸으로 올라 있지만 주인으로는 제 원(`core`)이다(§5.1 #2-2 (J)).
 */
export function anchorFromObstacle(o: ZoneObstacle): ZoneAnchor {
  const r = typeof o.core === 'number' && Number.isFinite(o.core) ? o.core : isRect(o) ? Math.max(o.hw, o.hh) : o.r;
  return { id: o.id, cx: o.cx, cy: o.cy, r };
}

/** 이번에 첫 자리를 받을 최상위 버블 하나. */
export interface PendingZoneBubble {
  id: string;
  diameter: number;
  lastActivity?: number;
}

export interface ZoneBatchInput {
  pending: readonly PendingZoneBubble[];
  /** 장부 — 앉힌 것은 여기 더해진다. */
  field: SpawnField;
  edges: readonly ZoneEdgeRef[];
  /** 주인이 될 수 있는 버블(에이전트) id → 마지막 활동. 장부에 자리가 있는 것만 주인이 된다. */
  hubs: ReadonlyMap<string, number>;
  grid: ZoneGrid;
  /** 이어진 에이전트가 화면에 없을 때 영역의 중심(캔버스 중심). */
  fallbackCenter: { x: number; y: number };
}

/**
 * 이번에 자리를 받을 최상위 버블들을 차례로 앉힌다 — **마지막 활동이 이른 것부터**라 도착 순서가 곧 시계
 * 순서다(동점은 id 순 — 같은 입력이 늘 같은 그림을 낸다). 먼저 앉은 것은 다음 것의 장애물이자 셀 거리다.
 * 돌려주는 것은 **중심** 좌표다.
 */
export function seatZoneBatch(input: ZoneBatchInput): Map<string, { cx: number; cy: number }> {
  const order = [...input.pending].sort((a, b) => {
    const byTime = (a.lastActivity ?? 0) - (b.lastActivity ?? 0);
    if (byTime !== 0) return byTime;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const hubs = new Map<string, number>();
  for (const [id, at] of input.hubs) if (input.field.byId.has(id)) hubs.set(id, at);
  const out = new Map<string, { cx: number; cy: number }>();
  for (const p of order) {
    const ownerId = spawnOwnerOf(p.id, input.edges, hubs);
    const owner = ownerId !== null ? input.field.byId.get(ownerId) : undefined;
    const anchor: ZoneAnchor = owner
      ? anchorFromObstacle(owner)
      : { id: null, cx: input.fallbackCenter.x, cy: input.fallbackCenter.y, r: 0 };
    const seat = seatInZone({
      anchor,
      diameter: p.diameter,
      grid: input.grid,
      obstacles: input.field.obstacles,
      bounds: input.field.bounds,
    });
    out.set(p.id, { cx: seat.cx, cy: seat.cy });
    addToSpawnField(input.field, { id: p.id, cx: seat.cx, cy: seat.cy, r: Math.max(0, p.diameter) / 2 });
  }
  return out;
}
