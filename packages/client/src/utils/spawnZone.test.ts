import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import {
  AGENT_CARD,
  LAYOUT_BOUNDS_DEFAULT,
  LAYOUT_CENTER_X,
  LAYOUT_CENTER_Y,
  ORBIT_BASE_RADIUS,
  ORBIT_RADIUS_PER_ITEM,
  PHYSICS_DAMPING,
  PHYSICS_REPULSION_RANGE,
  PHYSICS_REPULSION_STRENGTH,
  SATELLITE_ORBIT_GAP,
  SPAWN_ZONE,
  TIDY_LAYOUT,
  WEB_ORBIT_TYPES,
} from '@vibisual/shared';
import type { BubbleData } from '@vibisual/shared';
import { MAGNET_GAP, massOf } from '../hooks/physicsGeometry.js';
import { REST_MOVE_PX } from '../hooks/physicsStep.js';
import { FOLDER_NAV_IDS } from '../hooks/useBubbleLayout.js';
import { calcBubbleSize } from './sizeCalc.js';
import { radialItemsOf, radialLayout } from './flowBuilder.js';
import { collectSatellites, placeSatellitePositions, satelliteZoneGrid } from './satellite.js';
import {
  createSpawnField,
  seatInZone,
  seatZoneBatch,
  spawnOwnerOf,
  zoneCellArea,
  zoneDiscRadius,
  zoneGridRadius,
  zoneLevel,
  zoneOccupancy,
  zoneRingSlots,
  zoneSeatRadius,
  zoneSlotCount,
  type ZoneAnchor,
  type ZoneBounds,
  type ZoneGrid,
  type ZoneObstacle,
} from './spawnZone.js';
import {
  buildSpawnField,
  isSpawnZoneSeated,
  seatSpawnZoneBubbles,
  spawnTopGrid,
} from '../components/BubbleMap/spawnZoneSeating.js';

/**
 * §5.1 #2-2 등장 영역 — 새 버블의 첫 자리. 좌표·기하는 렌더링 없이 숫자로 고정한다(`tidyLayout` 선례).
 *
 * 고정하는 것: ① 12시에서 시작해 시계 방향, 안쪽 고리부터 ② 원판 안의 것을 **주인 불문** 세어 칸 수 이상이면
 * 고리를 넓히고 그 바깥 고리에 앉는다(붐빈 안쪽 틈에 끼워 넣지 않는다) ③ 사각 창은 든 넓이만큼 센다
 * ④ 100곳을 앉혀도 겹치지 않고 물리 상자 안 · 물리가 다시 밀어내지 않는다 ⑤ 주인은 화면의 선이 정한다
 * ⑥ 이미 자리가 있는 버블은 옮기지 않는다 ⑦ 위성도 같은 규칙(별자리 달은 궤도 하나).
 * §5.23 웹 궤도의 고정 시험(`webOrbit.test.ts`)은 이 규칙의 도메인 사례로 여기에 옮겼다.
 */

const BOX: ZoneBounds = {
  cx: LAYOUT_CENTER_X,
  cy: LAYOUT_CENTER_Y,
  hw: LAYOUT_BOUNDS_DEFAULT.hw,
  hh: LAYOUT_BOUNDS_DEFAULT.hh,
};
const GRID: ZoneGrid = spawnTopGrid();
const SLOT = GRID.slot;
const AGENT: ZoneObstacle = { id: 'agent', cx: LAYOUT_CENTER_X, cy: LAYOUT_CENTER_Y, r: 65 };
const ANCHOR: ZoneAnchor = { id: AGENT.id, cx: AGENT.cx, cy: AGENT.cy, r: AGENT.r };
const CENTER = { x: LAYOUT_CENTER_X, y: LAYOUT_CENTER_Y };
/** 첫 고리의 칸 수 — 첫 원판의 수용량. */
const CAP0 = zoneSlotCount(zoneGridRadius(AGENT.r, GRID, 0), SLOT);

/** 주인 기준 각도 — 12시를 0 으로, 시계 방향으로 커진다. */
function clockAngle(anchor: { cx: number; cy: number }, p: { cx: number; cy: number }): number {
  const theta = Math.atan2(p.cy - anchor.cy, p.cx - anchor.cx);
  const a = (theta - SPAWN_ZONE.START_ANGLE) % (Math.PI * 2);
  return a < 0 ? a + Math.PI * 2 : a;
}

/** 이 자리가 몇 번째 고리인가(반경이 앉는 반경과 맞는 것). 안 맞으면 -1. */
function ringOf(anchor: ZoneAnchor, p: { cx: number; cy: number }, diameter = SLOT): number {
  const d = Math.hypot(p.cx - anchor.cx, p.cy - anchor.cy);
  for (let ring = 0; ring < 64; ring++) {
    if (Math.abs(d - zoneSeatRadius(anchor.r, GRID, diameter, ring)) < 0.01) return ring;
  }
  return -1;
}

/** 주인 둘레 `distance` 거리, 6시 언저리에 몰아 둔 남의 작은 버블 `count` 개 — 12시 쪽 칸은 비어 있다. */
function othersNearSix(anchor: ZoneObstacle, count: number, distance: number, r = 15): ZoneObstacle[] {
  return Array.from({ length: count }, (_, i) => {
    const t = Math.PI / 2 + (i - (count - 1) / 2) * 0.18;
    return { id: `other-${i}`, cx: anchor.cx + Math.cos(t) * distance, cy: anchor.cy + Math.sin(t) * distance, r };
  });
}

/** 에이전트 하나가 `count` 곳을 차례로 만진 상황 — 모두 그 에이전트로 이어진 선을 가진다. */
function seatAround(anchor: ZoneObstacle, count: number, extra: ZoneObstacle[] = [], bounds: ZoneBounds | null = BOX) {
  const pending = Array.from({ length: count }, (_, i) => ({
    id: `d${String(i).padStart(3, '0')}`,
    diameter: SLOT,
    lastActivity: 1000 + i,
  }));
  const field = createSpawnField([anchor, ...extra], bounds);
  const seats = seatZoneBatch({
    pending,
    field,
    edges: pending.map((p) => ({ source: p.id, target: anchor.id })),
    hubs: new Map([[anchor.id, 1]]),
    grid: GRID,
    fallbackCenter: CENTER,
  });
  return pending.map((p) => ({ id: p.id, ...seats.get(p.id)! }));
}

describe('§5.1 #2-2 등장 영역 — 자리 순서', () => {
  it('첫 칸은 12시 — 안쪽 고리, 주인 테두리에서 RING_GAP 밖', () => {
    const seat = seatInZone({ anchor: ANCHOR, diameter: SLOT, grid: GRID, obstacles: [AGENT], bounds: BOX });
    expect(seat.free).toBe(true);
    expect(seat.ring).toBe(0);
    expect(seat.cx).toBeCloseTo(AGENT.cx, 6);
    expect(seat.cy).toBeCloseTo(AGENT.cy - (AGENT.r + TIDY_LAYOUT.RING_GAP + SLOT / 2), 6);
  });

  it('안쪽 고리부터 차고, 같은 고리 안에서는 12시에서 시계 방향으로 간다', () => {
    const seats = seatAround(AGENT, 40);
    let prevRing = 0;
    let prevAngle = -1;
    for (const s of seats) {
      const ring = ringOf(ANCHOR, s);
      expect(ring).toBeGreaterThanOrEqual(prevRing);
      if (ring === prevRing) expect(clockAngle(ANCHOR, s)).toBeGreaterThan(prevAngle);
      else expect(clockAngle(ANCHOR, s)).toBeCloseTo(0, 6); // 다음 고리도 12시에서 시작한다
      prevAngle = clockAngle(ANCHOR, s);
      prevRing = ring;
    }
    // 첫 고리가 다 차기 전에는 바깥으로 가지 않는다.
    expect(seats.slice(0, CAP0).every((s) => ringOf(ANCHOR, s) === 0)).toBe(true);
    expect(ringOf(ANCHOR, seats[CAP0]!)).toBe(1);
  });

  it('같은 스냅샷에 여럿이 오면 마지막 활동이 이른 것이 먼저 앉는다(12시)', () => {
    const field = createSpawnField([AGENT], BOX);
    const seats = seatZoneBatch({
      pending: [
        { id: 'late', diameter: SLOT, lastActivity: 20 },
        { id: 'early', diameter: SLOT, lastActivity: 10 },
      ],
      field,
      edges: [{ source: 'late', target: 'agent' }, { source: 'early', target: 'agent' }],
      hubs: new Map([['agent', 1]]),
      grid: GRID,
      fallbackCenter: CENTER,
    });
    expect(clockAngle(ANCHOR, seats.get('early')!)).toBeCloseTo(0, 6);
    expect(clockAngle(ANCHOR, seats.get('late')!)).toBeGreaterThan(0);
  });

  it('제 크기와 상관없이 주인 테두리와의 틈이 같다 — 큰 버블은 지름 차의 반만큼 바깥', () => {
    const big = 150;
    const seat = seatInZone({ anchor: ANCHOR, diameter: big, grid: GRID, obstacles: [AGENT], bounds: BOX });
    expect(seat.cy).toBeCloseTo(AGENT.cy - (AGENT.r + TIDY_LAYOUT.RING_GAP + big / 2), 6);
  });
});

describe('§5.1 #2-2 등장 영역 — 남의 버블도 센다, 붐비면 넓힌다', () => {
  it('원판 안의 것은 주인이 누구든 센다 — 주인 자신만 빼고, 원판 밖은 세지 않는다', () => {
    const inside = othersNearSix(AGENT, 3, 185);
    const far: ZoneObstacle = { id: 'far', cx: AGENT.cx + 1000, cy: AGENT.cy, r: 30 };
    expect(185).toBeLessThan(zoneDiscRadius(AGENT.r, GRID, 0));
    expect(zoneOccupancy(ANCHOR, GRID, [AGENT, ...inside, far], 0)).toBe(3);
  });

  it('남의 버블로 첫 원판이 차면 — 12시 칸이 비어 있어도 바깥 고리로 넓혀 앉는다', () => {
    const others = othersNearSix(AGENT, CAP0, 185);
    // 하나 모자라면 첫 고리 12시가 빈칸이다(틈이 있다는 것을 먼저 고정).
    const before = seatInZone({ anchor: ANCHOR, diameter: SLOT, grid: GRID, obstacles: [AGENT, ...others.slice(1)], bounds: BOX });
    expect(before.ring).toBe(0);
    expect(before.free).toBe(true);
    expect(clockAngle(ANCHOR, before)).toBeCloseTo(0, 6);
    // 원판 안의 수가 칸 수에 닿으면 그 틈에 끼워 넣지 않고 넓힌 고리의 12시에 선다 — 자기 버블은 하나도 없다.
    const after = seatInZone({ anchor: ANCHOR, diameter: SLOT, grid: GRID, obstacles: [AGENT, ...others], bounds: BOX });
    expect(zoneLevel(ANCHOR, GRID, [AGENT, ...others], 8)).toBe(1);
    expect(after.level).toBe(1);
    expect(after.ring).toBe(1);
    expect(after.free).toBe(true);
    expect(ringOf(ANCHOR, after)).toBe(1);
    expect(clockAngle(ANCHOR, after)).toBeCloseTo(0, 6);
  });

  it('사라진 자리는 다음 버블이 채운다 — 원판의 수가 줄면 안쪽 고리가 다시 영역이다', () => {
    const seats = seatAround(AGENT, CAP0 + 1);
    const gone = seats[2]!;
    const remaining = seats.filter((s) => s !== gone).map((s) => ({ id: s.id, cx: s.cx, cy: s.cy, r: SLOT / 2 }));
    const seat = seatInZone({ anchor: ANCHOR, diameter: SLOT, grid: GRID, obstacles: [AGENT, ...remaining], bounds: BOX });
    expect(seat.ring).toBe(0);
    expect(seat.cx).toBeCloseTo(gone.cx, 6);
    expect(seat.cy).toBeCloseTo(gone.cy, 6);
  });

  it('사각 창은 원판 안에 든 넓이만큼 센다 — 다 들면 넓이 ÷ 칸 넓이, 걸치면 최소 하나, 밖이면 0', () => {
    const panel: ZoneObstacle = { id: 'panel', cx: AGENT.cx + 200, cy: AGENT.cy, r: 100, hw: 100, hh: 60 };
    // 둘째 원판이 창을 통째로 품는다(가장 먼 모서리까지).
    expect(Math.hypot(300, 60)).toBeLessThan(zoneDiscRadius(AGENT.r, GRID, 1));
    expect(zoneOccupancy(ANCHOR, GRID, [AGENT, panel], 1)).toBe(Math.round((200 * 120) / zoneCellArea(GRID)));
    expect(zoneOccupancy(ANCHOR, GRID, [AGENT, panel], 1)).toBeGreaterThan(1);
    // 첫 원판에는 반쯤 걸친다 — 하나로 센다.
    expect(zoneOccupancy(ANCHOR, GRID, [AGENT, panel], 0)).toBe(1);
    const away: ZoneObstacle = { ...panel, id: 'away', cx: AGENT.cx + 1200 };
    expect(zoneOccupancy(ANCHOR, GRID, [AGENT, away], 1)).toBe(0);
  });

  it('사각 창이 막은 칸은 건너뛴다 — 창 테두리에서 잰다', () => {
    const panel: ZoneObstacle = { id: 'panel', cx: AGENT.cx, cy: AGENT.cy - 170, r: 60, hw: 60, hh: 30 };
    const seat = seatInZone({ anchor: ANCHOR, diameter: SLOT, grid: GRID, obstacles: [AGENT, panel], bounds: BOX });
    expect(seat.free).toBe(true);
    expect(seat.ring).toBe(0);
    expect(clockAngle(ANCHOR, seat)).toBeGreaterThan(0);
    const nx = Math.max(panel.cx - panel.hw!, Math.min(seat.cx, panel.cx + panel.hw!));
    const ny = Math.max(panel.cy - panel.hh!, Math.min(seat.cy, panel.cy + panel.hh!));
    expect(Math.hypot(seat.cx - nx, seat.cy - ny)).toBeGreaterThanOrEqual(SLOT / 2 + MAGNET_GAP - 1e-6);
  });

  it('바깥 고리가 상자를 넘으면 그때만 안쪽 틈을 쓴다', () => {
    // 상자가 첫 고리까지만 품는다 — 넓힌 고리에는 상자 안 칸이 없다.
    const anchor: ZoneObstacle = { id: 'a', cx: 0, cy: 0, r: 65 };
    const g0 = zoneGridRadius(anchor.r, GRID, 0);
    const box: ZoneBounds = { cx: 0, cy: 0, hw: g0 + SLOT / 2 + 1, hh: g0 + SLOT / 2 + 1 };
    const others = othersNearSix(anchor, CAP0, 185);
    const seat = seatInZone({
      anchor: { id: 'a', cx: 0, cy: 0, r: 65 }, diameter: SLOT, grid: GRID, obstacles: [anchor, ...others], bounds: box,
    });
    expect(seat.level).toBeGreaterThanOrEqual(1);
    expect(seat.ring).toBe(0);
    expect(seat.free).toBe(true);
    expect(seat.cx).toBeCloseTo(0, 6);
    expect(seat.cy).toBeCloseTo(-g0, 6);
  });
});

describe('§5.1 #2-2 등장 영역 — 100곳을 만져도 규칙적으로', () => {
  it('겹치지 않고 전부 물리 상자 안 — 종전 원(180 + N×20)은 상자를 넘어 벽에 눌렸다', () => {
    // 원인 고정: 종전 첫 자리 원의 반지름은 상자의 반높이를 넘는다 → 물리 클램프가 벽에 눌러 세웠다.
    expect(ORBIT_BASE_RADIUS + 100 * ORBIT_RADIUS_PER_ITEM).toBeGreaterThan(LAYOUT_BOUNDS_DEFAULT.hh);

    const seats = seatAround(AGENT, 100);
    const all = [{ ...AGENT }, ...seats.map((s) => ({ cx: s.cx, cy: s.cy, r: SLOT / 2 }))];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const d = Math.hypot(all[i]!.cx - all[j]!.cx, all[i]!.cy - all[j]!.cy);
        expect(d).toBeGreaterThanOrEqual(all[i]!.r + all[j]!.r + MAGNET_GAP - 1e-6);
      }
    }
    for (const s of seats) {
      expect(Math.abs(s.cx - BOX.cx)).toBeLessThanOrEqual(BOX.hw - SLOT / 2);
      expect(Math.abs(s.cy - BOX.cy)).toBeLessThanOrEqual(BOX.hh - SLOT / 2);
    }
    // 주인 곁에 모인다 — 상자 벽까지 가지 않는다.
    const farthest = Math.max(...seats.map((s) => Math.hypot(s.cx - AGENT.cx, s.cy - AGENT.cy)));
    expect(farthest).toBeLessThan(BOX.hh - SLOT / 2);
  });

  it('물리가 다시 밀어내지 않는다 — 남는 반발이 내는 걸음이 정지 문턱 아래', () => {
    // `usePhysicsLayout` 의 걸음: v ← (v + ΣF) × 감쇠 / 질량. 머무는 속도는 ΣF·k/(1−k), k = 감쇠/질량.
    // 반발 값은 shared 물리 상수(같은 값을 물리 훅이 쓴다)로 잰다.
    const seats = seatAround(AGENT, 100);
    const bodies = [{ ...AGENT }, ...seats.map((s) => ({ cx: s.cx, cy: s.cy, r: SLOT / 2 }))];
    const k = PHYSICS_DAMPING / massOf({ x: 0, y: 0, radius: SLOT / 2, halfW: SLOT / 2, halfH: SLOT / 2, shape: 'circle', group: 'bubble', parentId: null });
    let worstStep = 0;
    for (const a of bodies) {
      let fx = 0;
      let fy = 0;
      for (const b of bodies) {
        if (a === b) continue;
        const dx = a.cx - b.cx;
        const dy = a.cy - b.cy;
        const d = Math.hypot(dx, dy);
        if (d >= PHYSICS_REPULSION_RANGE) continue;
        const f = (PHYSICS_REPULSION_STRENGTH / (d * d)) * (1 - d / PHYSICS_REPULSION_RANGE);
        fx += (dx / d) * f;
        fy += (dy / d) * f;
      }
      worstStep = Math.max(worstStep, (Math.hypot(fx, fy) * k) / (1 - k));
    }
    expect(worstStep).toBeLessThan(REST_MOVE_PX);
  });
});

describe('§5.1 #2-2 등장 영역 — 빈칸 고르기', () => {
  it('막힌 칸은 건너뛴다 — 12시에 무엇이 있으면 시계 방향 다음 칸', () => {
    const top: ZoneObstacle = { id: 'top', cx: AGENT.cx, cy: AGENT.cy - zoneGridRadius(AGENT.r, GRID, 0), r: SLOT / 2 };
    const seat = seatInZone({ anchor: ANCHOR, diameter: SLOT, grid: GRID, obstacles: [AGENT, top], bounds: BOX });
    expect(seat.free).toBe(true);
    expect(ringOf(ANCHOR, seat)).toBe(0);
    expect(clockAngle(ANCHOR, seat)).toBeGreaterThan(0);
  });

  it('상자 벽 옆의 주인 — 상자 밖 칸은 고르지 않는다', () => {
    const nearWall: ZoneObstacle = { id: 'agent', cx: BOX.cx + BOX.hw - 120, cy: BOX.cy, r: 65 };
    const seats = seatAround(nearWall, 60);
    for (const s of seats) {
      expect(Math.abs(s.cx - BOX.cx)).toBeLessThanOrEqual(BOX.hw - SLOT / 2);
      expect(Math.abs(s.cy - BOX.cy)).toBeLessThanOrEqual(BOX.hh - SLOT / 2);
    }
  });

  it('상자 안에 빈칸이 없으면 상자 안 첫 칸에 겹친 채 세운다(free=false)', () => {
    // 상자가 작아 첫 고리만 상자 안에 든다 — 그 칸을 전부 막는다.
    const anchor: ZoneObstacle = { id: 'a', cx: 0, cy: 0, r: 60 };
    const r0 = zoneGridRadius(anchor.r, GRID, 0);
    const box: ZoneBounds = { cx: 0, cy: 0, hw: r0 + SLOT / 2 + 1, hh: r0 + SLOT / 2 + 1 };
    const blockers: ZoneObstacle[] = [];
    for (let i = 0; i < 64; i++) {
      const t = SPAWN_ZONE.START_ANGLE + (i * Math.PI * 2) / 64;
      blockers.push({ id: `b${i}`, cx: Math.cos(t) * r0, cy: Math.sin(t) * r0, r: SLOT / 2 });
    }
    const seat = seatInZone({
      anchor: { id: 'a', cx: 0, cy: 0, r: 60 }, diameter: SLOT, grid: GRID, obstacles: [anchor, ...blockers], bounds: box,
    });
    expect(seat.free).toBe(false);
    expect(seat.cx).toBeCloseTo(0, 6);
    expect(seat.cy).toBeCloseTo(-r0, 6);
  });

  it('깨진 값이 와도 끝난다 — 칸 지름이 NaN 이면 버블 지름으로 격자를 짠다', () => {
    const seat = seatInZone({
      anchor: ANCHOR, diameter: SLOT, grid: { slot: Number.NaN, firstGap: TIDY_LAYOUT.RING_GAP }, obstacles: [AGENT], bounds: BOX,
    });
    expect(Number.isFinite(seat.cx) && Number.isFinite(seat.cy)).toBe(true);
    expect(seat.free).toBe(true);
  });
});

describe('§5.1 #2-2 등장 영역 — 누구의 영역인가', () => {
  const hubs = new Map([['a1', 100], ['a2', 200]]);

  it('이어진 에이전트 중 활동이 가장 최근인 쪽 — 에이전트가 아닌 끝은 후보가 아니다', () => {
    expect(spawnOwnerOf('d', [
      { source: 'd', target: 'a1' },
      { source: 'd', target: 'a2' },
      { source: 'd', target: 'folder' },
    ], hubs)).toBe('a2');
  });

  it('선의 방향은 묻지 않는다 · 동점은 id 순 · 이어진 에이전트가 없으면 null', () => {
    expect(spawnOwnerOf('d', [{ source: 'a1', target: 'd' }], hubs)).toBe('a1');
    expect(spawnOwnerOf('d', [
      { source: 'd', target: 'b' },
      { source: 'd', target: 'a' },
    ], new Map([['a', 5], ['b', 5]]))).toBe('a');
    expect(spawnOwnerOf('d', [{ source: 'x', target: 'y' }], hubs)).toBeNull();
  });

  it('이어진 에이전트가 화면에 없으면 캔버스 중심을 돈다', () => {
    const seats = seatZoneBatch({
      pending: [{ id: 'orphan', diameter: SLOT, lastActivity: 1 }],
      field: createSpawnField([], BOX),
      edges: [],
      hubs: new Map(),
      grid: GRID,
      fallbackCenter: CENTER,
    });
    const seat = seats.get('orphan')!;
    expect(seat.cx).toBeCloseTo(CENTER.x, 6);
    expect(seat.cy).toBeCloseTo(CENTER.y - zoneGridRadius(0, GRID, 0), 6);
  });
});

describe('§5.1 #2-2 등장 영역 — 화면 값 접착(spawnZoneSeating)', () => {
  const agent: BubbleData = {
    id: 'agent-1', label: 'Agent', bubbleType: 'agent', path: '', status: 'active', activity: 10, lastActivity: 50,
  };
  const folder: BubbleData = {
    id: 'folder-1', label: 'src', bubbleType: 'internal_folder', path: 'src', status: 'idle', activity: 1,
  };
  const domain = (id: string, lastActivity: number): BubbleData => ({
    id, label: `${id}.com`, bubbleType: 'domain', path: `${id}.com`, status: 'active', activity: 1, lastActivity,
  });
  const nodeApp: BubbleData = {
    id: 'command-app-node', label: 'Node.js', bubbleType: 'bash', path: '__special__commandapp__x', status: 'active',
    activity: 1, lastActivity: 5,
  };

  /** 에이전트는 캔버스 중심에서 떨어져 있다 — 이어지지 않은 버블이 캔버스 중심을 도는지와 섞이지 않게. */
  const AGENT_AT = { x: 1000, y: 300 };

  function seatTop(pending: BubbleData[], linked: boolean) {
    const agentD = calcBubbleSize(agent);
    const bubbles = [agent, folder, ...pending];
    const positions = new Map([
      [agent.id, { x: AGENT_AT.x - agentD / 2, y: AGENT_AT.y - agentD / 2 }],
      [folder.id, { x: 2000, y: 2000 }],
    ]);
    const field = buildSpawnField({
      bubbles, nodes: [], positions, panels: [], heat: undefined, fileSizeRange: undefined, bounds: BOX, cardForm: false,
    });
    return seatSpawnZoneBubbles({
      pending,
      field,
      bubbles,
      edges: linked ? pending.map((p) => ({ source: p.id, target: agent.id })) : [],
      heat: undefined,
      fallbackCenter: CENTER,
    });
  }

  it('웹 버블은 읽은 에이전트의 12시에 좌상단 좌표로 돌아온다', () => {
    const d = domain('docs', 1);
    const pos = seatTop([d], true).get(d.id)!;
    const agentR = calcBubbleSize(agent) / 2;
    const dd = calcBubbleSize(d);
    expect(pos.x + dd / 2).toBeCloseTo(AGENT_AT.x, 6);
    expect(pos.y + dd / 2).toBeCloseTo(AGENT_AT.y - zoneSeatRadius(agentR, GRID, dd, 0), 6);
  });

  it('명령 앱 버블도 실행한 에이전트 둘레 12시에 선다 — 캔버스 중심의 큰 원이 아니다', () => {
    const pos = seatTop([nodeApp], true).get(nodeApp.id)!;
    const agentR = calcBubbleSize(agent) / 2;
    const d = calcBubbleSize(nodeApp);
    expect(pos.x + d / 2).toBeCloseTo(AGENT_AT.x, 6);
    expect(pos.y + d / 2).toBeCloseTo(AGENT_AT.y - zoneSeatRadius(agentR, GRID, d, 0), 6);
  });

  it('이어진 에이전트가 없으면 캔버스 중심 둘레에 선다', () => {
    const trash: BubbleData = { id: '__trash__', label: '휴지통', bubbleType: 'trash', path: '', status: 'idle', activity: 0 };
    const pos = seatTop([trash], false).get(trash.id)!;
    const d = calcBubbleSize(trash);
    expect(pos.x + d / 2).toBeCloseTo(CENTER.x, 6);
    expect(pos.y + d / 2).toBeCloseTo(CENTER.y - zoneSeatRadius(0, GRID, d, 0), 6);
  });

  it('이미 자리가 있는 버블은 돌려주지 않는다 — 정하는 것은 처음 설 자리뿐', () => {
    const out = seatTop([domain('a', 1), domain('b', 2)], true);
    expect([...out.keys()].sort()).toEqual(['a', 'b']);
  });

  it('말풍선 에이전트는 상자째 비켜 간다 — 고리가 긴 변 밖에서 시작한다', () => {
    const card: BubbleData = { ...agent, customCreated: true, agentForm: 'card' };
    const d = domain('docs', 1);
    const field = buildSpawnField({
      bubbles: [card, d], nodes: [], positions: new Map([[card.id, { x: 100, y: 100 }]]), panels: [],
      heat: undefined, fileSizeRange: undefined, bounds: BOX, cardForm: true,
    });
    const pos = seatSpawnZoneBubbles({
      pending: [d], field, bubbles: [card, d], edges: [{ source: d.id, target: card.id }], heat: undefined, fallbackCenter: CENTER,
    }).get(d.id)!;
    const dd = calcBubbleSize(d);
    const center = { x: 100 + AGENT_CARD.width / 2, y: 100 + AGENT_CARD.height / 2 };
    expect(pos.x + dd / 2).toBeCloseTo(center.x, 6);
    expect(pos.y + dd / 2).toBeCloseTo(center.y - zoneSeatRadius(AGENT_CARD.width / 2, GRID, dd, 0), 6);
  });

  it('장부는 렌더와 같은 자로 잰다 — 실측이 정사각이 아니면 사각, 말풍선·사각 창도 사각, 자리 없는 것은 빠진다', () => {
    const card: BubbleData = { ...agent, id: 'card', customCreated: true, agentForm: 'card' };
    const wide: BubbleData = { ...folder, id: 'wide' };
    const loose: BubbleData = { ...folder, id: 'loose' };
    const nodes = [{ id: 'wide', position: { x: 0, y: 0 }, data: {}, measured: { width: 120, height: 80 } }] as Node[];
    const field = buildSpawnField({
      bubbles: [card, wide, loose, folder],
      nodes,
      positions: new Map([['card', { x: 0, y: 0 }], ['wide', { x: 500, y: 0 }], ['folder-1', { x: 900, y: 0 }]]),
      panels: [{ id: 'app-1', x: 0, y: 600, width: 360, height: 220 }],
      heat: undefined, fileSizeRange: undefined, bounds: BOX, cardForm: true,
    });
    expect(field.byId.get('card')).toMatchObject({ hw: AGENT_CARD.width / 2, hh: AGENT_CARD.height / 2 });
    expect(field.byId.get('wide')).toMatchObject({ cx: 560, cy: 40, hw: 60, hh: 40 });
    expect(field.byId.get('folder-1')?.hw).toBeUndefined();
    expect(field.byId.get('app-1')).toMatchObject({ cx: 180, cy: 710, hw: 180, hh: 110 });
    expect(field.byId.has('loose')).toBe(false);
  });

  it('등장 영역에 앉는 것 — 에이전트·내비게이션·위성은 그 화면의 배치가 세운다', () => {
    const base = { label: 'x', path: 'x', status: 'idle' as const, activity: 1 };
    expect(isSpawnZoneSeated({ ...base, id: 'f', bubbleType: 'internal_folder' })).toBe(true);
    expect(isSpawnZoneSeated({ ...base, id: 'e', bubbleType: 'external_folder' })).toBe(true);
    expect(isSpawnZoneSeated(nodeApp)).toBe(true);
    expect(isSpawnZoneSeated({ ...base, id: 'root-1', bubbleType: 'root' })).toBe(true);
    expect(isSpawnZoneSeated({ ...base, id: '__trash__', bubbleType: 'trash' })).toBe(true);
    expect(isSpawnZoneSeated(domain('d', 1))).toBe(true);
    expect(isSpawnZoneSeated({ ...base, id: 'p', bubbleType: 'internal_folder', pinned: true })).toBe(true);
    expect(isSpawnZoneSeated(agent)).toBe(false);
    expect(isSpawnZoneSeated({ ...base, id: 'auto', bubbleType: 'auto' })).toBe(false);
    expect(isSpawnZoneSeated({ ...base, id: 'pipe', bubbleType: 'pipeline' })).toBe(false);
    expect(isSpawnZoneSeated({ ...base, id: 'back', bubbleType: 'back' })).toBe(false);
    for (const id of FOLDER_NAV_IDS) expect(isSpawnZoneSeated({ ...base, id, bubbleType: 'root' })).toBe(false);
    expect(isSpawnZoneSeated({ ...base, id: 'sat-file', bubbleType: 'file' })).toBe(false);
  });
});

describe('§5.1 #2-2 등장 영역 — 위성도 같은 규칙으로 부모 둘레에', () => {
  const parent: BubbleData = {
    id: 'folder', label: 'gen', path: '/p/gen', bubbleType: 'external_folder', status: 'idle', activity: 1,
  };
  const file = (id: string, name: string, lastActivity: number): BubbleData => ({
    id, label: name, path: `/p/gen/${name}`, absolutePath: `/p/gen/${name}`, bubbleType: 'file', status: 'idle', activity: 1, lastActivity,
  });
  // 배치와 같은 격자 — 폴더 위성은 그 폴더가 거느릴 수(위성 상한)로 첫 고리를 나눈다(§5.1 #2-2 (J)).
  const SAT_GRID: ZoneGrid = satelliteZoneGrid(collectSatellites([parent], { folder: [file('x', 'x.py', 1)] }, undefined)[0]!);

  it('일반 위성은 부모 둘레 첫 고리 12시부터 도착 순서대로 시계 방향 — 무작위 퍼짐 폐기', () => {
    const sats = collectSatellites([parent], { folder: [file('b', 'chk.mjs', 20), file('a', 'gen.py', 10)] }, undefined);
    const positions = new Map([[parent.id, { x: 500, y: 500 }]]);
    placeSatellitePositions(sats, positions);
    const parentAnchor: ZoneAnchor = { id: parent.id, cx: 500 + sats[0]!.parentSize / 2, cy: 500 + sats[0]!.parentSize / 2, r: sats[0]!.parentSize / 2 };
    const centerOf = (id: string) => {
      const sat = sats.find((s) => s.bubble.id === `sat-${id}`)!;
      const d = calcBubbleSize(sat.bubble, sat.localRange, sat.heat);
      const p = positions.get(sat.bubble.id)!;
      return { cx: p.x + d / 2, cy: p.y + d / 2, d };
    };
    const first = centerOf('a'); // 먼저 만진 gen.py 가 12시
    expect(first.cx).toBeCloseTo(parentAnchor.cx, 6);
    expect(Math.hypot(first.cx - parentAnchor.cx, first.cy - parentAnchor.cy))
      .toBeCloseTo(zoneSeatRadius(parentAnchor.r, SAT_GRID, first.d, 0), 6);
    expect(first.cy).toBeLessThan(parentAnchor.cy);
    const second = centerOf('b');
    expect(clockAngle(parentAnchor, second)).toBeGreaterThan(0);
    expect(Math.hypot(second.cx - parentAnchor.cx, second.cy - parentAnchor.cy))
      .toBeCloseTo(zoneSeatRadius(parentAnchor.r, SAT_GRID, second.d, 0), 6);
  });

  it('부모 둘레가 남의 버블로 붐비면 — 위성도 넓힌 바깥 고리에 앉는다', () => {
    const sats = collectSatellites([parent], { folder: [file('a', 'gen.py', 10)] }, undefined);
    const ps = sats[0]!.parentSize;
    const parentObstacle: ZoneObstacle = { id: parent.id, cx: 500 + ps / 2, cy: 500 + ps / 2, r: ps / 2 };
    const cap0 = zoneRingSlots(parentObstacle.r, SAT_GRID, 0);
    const near = zoneDiscRadius(parentObstacle.r, SAT_GRID, 0) - 4;
    const field = createSpawnField([parentObstacle, ...othersNearSix(parentObstacle, cap0, near, 8)], BOX);
    const positions = new Map([[parent.id, { x: 500, y: 500 }]]);
    placeSatellitePositions(sats, positions, undefined, field);
    const sat = sats[0]!;
    const d = calcBubbleSize(sat.bubble, sat.localRange, sat.heat);
    const p = positions.get(sat.bubble.id)!;
    const dist = Math.hypot(p.x + d / 2 - parentObstacle.cx, p.y + d / 2 - parentObstacle.cy);
    expect(dist).toBeCloseTo(zoneSeatRadius(parentObstacle.r, SAT_GRID, d, 1), 6);
    // 앉힌 위성은 장부에 더해져 다음 버블의 셀 거리가 된다.
    expect(field.byId.has(sat.bubble.id)).toBe(true);
  });
});

describe('§5.23 — 큰 원(radialLayout)에서 빠지는 웹 버블', () => {
  const agent: BubbleData = { id: 'agent-1', label: 'Agent', bubbleType: 'agent', path: '', status: 'active', activity: 10 };
  const folders: BubbleData[] = ['src', 'docs', 'packages'].map((name) => ({
    id: `folder-${name}`, label: name, bubbleType: 'internal_folder', path: name, status: 'idle', activity: 1,
  }));
  const domains: BubbleData[] = Array.from({ length: 100 }, (_, i) => ({
    id: `domain-${i}`, label: `site${i}.com`, bubbleType: 'domain', path: `site${i}.com`, status: 'active', activity: 1,
  }));
  /** 물리 클램프가 그 버블을 상자 벽에 누르는가(중심이 `반치수 − 반경` 밖). */
  const outsideBox = (b: BubbleData, p: { x: number; y: number }): boolean => {
    const d = calcBubbleSize(b);
    return Math.abs(p.x + d / 2 - BOX.cx) > BOX.hw - d / 2 || Math.abs(p.y + d / 2 - BOX.cy) > BOX.hh - d / 2;
  };

  it('표 한 줄 — 도메인은 빠지고 폴더는 남는다', () => {
    expect(WEB_ORBIT_TYPES.has('domain')).toBe(true);
    expect(WEB_ORBIT_TYPES.has('internal_folder')).toBe(false);
  });

  it('도메인 100곳이 들어와도 원에는 폴더만 선다 — 폴더 자리가 상자 안에 남는다', () => {
    const items = radialItemsOf([...folders, ...domains]);
    expect(items.map((b) => b.id)).toEqual(folders.map((f) => f.id));
    const layout = radialLayout([agent], items, LAYOUT_CENTER_X, LAYOUT_CENTER_Y, undefined);
    for (const f of folders) expect(outsideBox(f, layout.get(f.id)!)).toBe(false);
  });

  it('원인 고정 — 종전처럼 도메인까지 원에 세우면 상자를 넘는다(사각 테두리의 정체)', () => {
    const layout = radialLayout([agent], [...folders, ...domains], LAYOUT_CENTER_X, LAYOUT_CENTER_Y, undefined);
    const pushed = [...folders, ...domains].filter((b) => outsideBox(b, layout.get(b.id)!));
    expect(pushed.length).toBeGreaterThan(50);
  });
});
