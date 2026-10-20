import { describe, it, expect } from 'vitest';
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
  WEB_ORBIT,
  WEB_ORBIT_TYPES,
} from '@vibisual/shared';
import type { BubbleData } from '@vibisual/shared';
import { MAGNET_GAP, massOf } from '../../hooks/physicsGeometry.js';
import { REST_MOVE_PX } from '../../hooks/physicsStep.js';
import { calcBubbleSize } from '../../utils/sizeCalc.js';
import { radialItemsOf, radialLayout } from '../../utils/flowBuilder.js';
import {
  seatWebOrbitBatch,
  webOrbitReaderOf,
  webOrbitRingRadius,
  webOrbitSeat,
  type OrbitBounds,
  type OrbitCircle,
} from './webOrbit.js';
import { seatWebOrbitBubbles, webOrbitSlotDiameter } from './webOrbitSeating.js';

/**
 * §5.23 웹 궤도 — 새 도메인 버블의 첫 자리. 좌표·기하는 렌더링 없이 숫자로 고정한다(`tidyLayout` 선례).
 *
 * 고정하는 것: ① 12시에서 시작해 시계 방향, 안쪽 궤도부터 ② 100곳을 앉혀도 겹치지 않고 물리 상자 안
 * (종전 원은 상자를 넘어 벽에 눌렸다) ③ 물리가 다시 밀어내지 않는다 ④ 막힌 칸·상자 밖 칸은 건너뛴다
 * ⑤ 누구의 궤도인가는 화면의 선이 정한다 ⑥ 이미 자리가 있는 버블은 옮기지 않는다.
 */

const BOX: OrbitBounds = {
  cx: LAYOUT_CENTER_X,
  cy: LAYOUT_CENTER_Y,
  hw: LAYOUT_BOUNDS_DEFAULT.hw,
  hh: LAYOUT_BOUNDS_DEFAULT.hh,
};
const SLOT = webOrbitSlotDiameter();
const AGENT: OrbitCircle = { cx: LAYOUT_CENTER_X, cy: LAYOUT_CENTER_Y, r: 65 };
const CENTER = { x: LAYOUT_CENTER_X, y: LAYOUT_CENTER_Y };

/** 앵커 기준 각도 — 12시를 0 으로, 시계 방향으로 커진다. */
function clockAngle(anchor: OrbitCircle, p: { cx: number; cy: number }): number {
  const theta = Math.atan2(p.cy - anchor.cy, p.cx - anchor.cx);
  const a = (theta - WEB_ORBIT.START_ANGLE) % (Math.PI * 2);
  return a < 0 ? a + Math.PI * 2 : a;
}

/** 이 자리가 몇 번째 궤도인가(반경이 궤도 반경과 맞는 것). 안 맞으면 -1. */
function ringOf(anchor: OrbitCircle, p: { cx: number; cy: number }): number {
  const d = Math.hypot(p.cx - anchor.cx, p.cy - anchor.cy);
  for (let ring = 0; ring < 64; ring++) {
    if (Math.abs(d - webOrbitRingRadius(anchor.r, SLOT, ring)) < 0.01) return ring;
  }
  return -1;
}

/** 에이전트 하나가 `count` 곳을 차례로 읽은 상황 — 모두 그 에이전트로 이어진 읽기 화살표를 가진다. */
function readBy(anchorId: string, anchor: OrbitCircle, count: number, extra: OrbitCircle[] = []) {
  const pending = Array.from({ length: count }, (_, i) => ({
    id: `d${String(i).padStart(3, '0')}`,
    diameter: SLOT,
    lastActivity: 1000 + i,
  }));
  const placed = new Map<string, OrbitCircle>([[anchorId, anchor]]);
  extra.forEach((c, i) => placed.set(`x${i}`, c));
  const seats = seatWebOrbitBatch({
    pending,
    placed,
    edges: pending.map((p) => ({ source: p.id, target: anchorId })),
    readers: new Map([[anchorId, 1]]),
    slotDiameter: SLOT,
    bounds: BOX,
    fallbackCenter: CENTER,
  });
  return pending.map((p) => ({ id: p.id, ...seats.get(p.id)! }));
}

describe('§5.23 웹 궤도 — 자리 순서', () => {
  it('첫 칸은 12시 — 안쪽 궤도, 에이전트 테두리에서 RING_GAP 밖', () => {
    const seat = webOrbitSeat({ anchor: AGENT, diameter: SLOT, slotDiameter: SLOT, occupied: [AGENT], bounds: BOX });
    expect(seat.free).toBe(true);
    expect(seat.cx).toBeCloseTo(AGENT.cx, 6);
    expect(seat.cy).toBeCloseTo(AGENT.cy - webOrbitRingRadius(AGENT.r, SLOT, 0), 6);
  });

  it('안쪽 궤도부터 차고, 같은 궤도 안에서는 12시에서 시계 방향으로 간다', () => {
    const seats = readBy('agent', AGENT, 40);
    let prevRing = 0;
    let prevAngle = -1;
    for (const s of seats) {
      const ring = ringOf(AGENT, s);
      expect(ring).toBeGreaterThanOrEqual(prevRing);
      if (ring === prevRing) expect(clockAngle(AGENT, s)).toBeGreaterThan(prevAngle);
      else expect(clockAngle(AGENT, s)).toBeCloseTo(0, 6); // 다음 궤도도 12시에서 시작한다
      prevAngle = clockAngle(AGENT, s);
      prevRing = ring;
    }
  });

  it('같은 스냅샷에 여럿이 오면 마지막 활동이 이른 것이 먼저 앉는다(12시)', () => {
    const seats = seatWebOrbitBatch({
      pending: [
        { id: 'late', diameter: SLOT, lastActivity: 20 },
        { id: 'early', diameter: SLOT, lastActivity: 10 },
      ],
      placed: new Map([['agent', AGENT]]),
      edges: [{ source: 'late', target: 'agent' }, { source: 'early', target: 'agent' }],
      readers: new Map([['agent', 1]]),
      slotDiameter: SLOT,
      bounds: BOX,
      fallbackCenter: CENTER,
    });
    expect(clockAngle(AGENT, seats.get('early')!)).toBeCloseTo(0, 6);
    expect(clockAngle(AGENT, seats.get('late')!)).toBeGreaterThan(0);
  });
});

describe('§5.23 웹 궤도 — 100곳을 읽어도 규칙적으로', () => {
  it('겹치지 않고 전부 물리 상자 안 — 종전 원(180 + N×20)은 상자를 넘어 벽에 눌렸다', () => {
    // 원인 고정: 종전 첫 자리 원의 반지름은 상자의 반높이를 넘는다 → 물리 클램프가 벽에 눌러 세웠다.
    expect(ORBIT_BASE_RADIUS + 100 * ORBIT_RADIUS_PER_ITEM).toBeGreaterThan(LAYOUT_BOUNDS_DEFAULT.hh);

    const seats = readBy('agent', AGENT, 100);
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
    // 에이전트 곁에 모인다 — 상자 벽까지 가지 않는다.
    const farthest = Math.max(...seats.map((s) => Math.hypot(s.cx - AGENT.cx, s.cy - AGENT.cy)));
    expect(farthest).toBeLessThan(BOX.hh - SLOT / 2);
  });

  it('물리가 다시 밀어내지 않는다 — 남는 반발이 내는 걸음이 정지 문턱 아래', () => {
    // `usePhysicsLayout` 의 걸음: v ← (v + ΣF) × 감쇠 / 질량. 머무는 속도는 ΣF·k/(1−k), k = 감쇠/질량.
    // 반발 값은 shared 물리 상수(같은 값을 물리 훅이 쓴다)로 잰다.
    const seats = readBy('agent', AGENT, 100);
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

describe('§5.23 웹 궤도 — 빈칸 고르기', () => {
  it('막힌 칸은 건너뛴다 — 12시에 무엇이 있으면 시계 방향 다음 칸', () => {
    const top = { cx: AGENT.cx, cy: AGENT.cy - webOrbitRingRadius(AGENT.r, SLOT, 0), r: SLOT / 2 };
    const seat = webOrbitSeat({ anchor: AGENT, diameter: SLOT, slotDiameter: SLOT, occupied: [AGENT, top], bounds: BOX });
    expect(seat.free).toBe(true);
    expect(ringOf(AGENT, seat)).toBe(0);
    expect(clockAngle(AGENT, seat)).toBeGreaterThan(0);
  });

  it('상자 벽 옆의 에이전트 — 상자 밖 칸은 고르지 않는다', () => {
    const nearWall: OrbitCircle = { cx: BOX.cx + BOX.hw - 120, cy: BOX.cy, r: 65 };
    const seats = readBy('agent', nearWall, 60);
    for (const s of seats) {
      expect(Math.abs(s.cx - BOX.cx)).toBeLessThanOrEqual(BOX.hw - SLOT / 2);
      expect(Math.abs(s.cy - BOX.cy)).toBeLessThanOrEqual(BOX.hh - SLOT / 2);
    }
  });

  it('상자 안에 빈칸이 없으면 상자 안 첫 칸에 겹친 채 세운다(free=false)', () => {
    // 상자가 작아 첫 궤도만 상자 안에 든다 — 그 칸을 전부 막는다.
    const anchor: OrbitCircle = { cx: 0, cy: 0, r: 60 };
    const r0 = webOrbitRingRadius(anchor.r, SLOT, 0);
    const box: OrbitBounds = { cx: 0, cy: 0, hw: r0 + SLOT / 2 + 1, hh: r0 + SLOT / 2 + 1 };
    const blockers: OrbitCircle[] = [];
    for (let i = 0; i < 64; i++) {
      const t = WEB_ORBIT.START_ANGLE + (i * Math.PI * 2) / 64;
      blockers.push({ cx: Math.cos(t) * r0, cy: Math.sin(t) * r0, r: SLOT / 2 });
    }
    const seat = webOrbitSeat({ anchor, diameter: SLOT, slotDiameter: SLOT, occupied: [anchor, ...blockers], bounds: box });
    expect(seat.free).toBe(false);
    expect(seat.cx).toBeCloseTo(0, 6);
    expect(seat.cy).toBeCloseTo(-r0, 6);
  });

  it('깨진 값이 와도 끝난다 — 칸 지름이 NaN 이면 버블 지름으로 격자를 짠다', () => {
    const seat = webOrbitSeat({ anchor: AGENT, diameter: SLOT, slotDiameter: Number.NaN, occupied: [AGENT], bounds: BOX });
    expect(Number.isFinite(seat.cx) && Number.isFinite(seat.cy)).toBe(true);
    expect(seat.free).toBe(true);
  });
});

describe('§5.23 웹 궤도 — 누구의 궤도인가', () => {
  const readers = new Map([['a1', 100], ['a2', 200]]);

  it('이어진 에이전트 중 활동이 가장 최근인 쪽 — 에이전트가 아닌 끝은 후보가 아니다', () => {
    expect(webOrbitReaderOf('d', [
      { source: 'd', target: 'a1' },
      { source: 'd', target: 'a2' },
      { source: 'd', target: 'folder' },
    ], readers)).toBe('a2');
  });

  it('선의 방향은 묻지 않는다 · 동점은 id 순 · 이어진 에이전트가 없으면 null', () => {
    expect(webOrbitReaderOf('d', [{ source: 'a1', target: 'd' }], readers)).toBe('a1');
    expect(webOrbitReaderOf('d', [
      { source: 'd', target: 'b' },
      { source: 'd', target: 'a' },
    ], new Map([['a', 5], ['b', 5]]))).toBe('a');
    expect(webOrbitReaderOf('d', [{ source: 'x', target: 'y' }], readers)).toBeNull();
  });

  it('읽은 에이전트가 화면에 없으면 캔버스 중심을 돈다', () => {
    const seats = seatWebOrbitBatch({
      pending: [{ id: 'orphan', diameter: SLOT, lastActivity: 1 }],
      placed: new Map(),
      edges: [],
      readers: new Map(),
      slotDiameter: SLOT,
      bounds: BOX,
      fallbackCenter: CENTER,
    });
    const seat = seats.get('orphan')!;
    expect(seat.cx).toBeCloseTo(CENTER.x, 6);
    expect(seat.cy).toBeCloseTo(CENTER.y - webOrbitRingRadius(0, SLOT, 0), 6);
  });
});

describe('§5.23 웹 궤도 — 화면 값 접착(webOrbitSeating)', () => {
  const agent: BubbleData = {
    id: 'agent-1', label: 'Agent', bubbleType: 'agent', path: '', status: 'active', activity: 10, lastActivity: 50,
  };
  const folder: BubbleData = {
    id: 'folder-1', label: 'src', bubbleType: 'internal_folder', path: 'src', status: 'idle', activity: 1,
  };
  const domain = (id: string, lastActivity: number): BubbleData => ({
    id, label: `${id}.com`, bubbleType: 'domain', path: `${id}.com`, status: 'active', activity: 1, lastActivity,
  });

  function seat(pending: BubbleData[], extra: Partial<Parameters<typeof seatWebOrbitBubbles>[0]> = {}) {
    const agentD = calcBubbleSize(agent);
    return seatWebOrbitBubbles({
      pending,
      bubbles: [agent, folder, ...pending],
      nodes: [],
      positions: new Map([
        [agent.id, { x: 400 - agentD / 2, y: 300 - agentD / 2 }],
        [folder.id, { x: 2000, y: 2000 }],
      ]),
      edges: pending.map((p) => ({ source: p.id, target: agent.id })),
      heat: undefined,
      fileSizeRange: undefined,
      bounds: BOX,
      cardForm: false,
      fallbackCenter: CENTER,
      ...extra,
    });
  }

  it('웹 버블은 읽은 에이전트의 12시에 좌상단 좌표로 돌아온다', () => {
    const d = domain('docs', 1);
    const out = seat([d]);
    const agentR = calcBubbleSize(agent) / 2;
    const dd = calcBubbleSize(d);
    const pos = out.get(d.id)!;
    expect(pos.x + dd / 2).toBeCloseTo(400, 6);
    expect(pos.y + dd / 2).toBeCloseTo(300 - webOrbitRingRadius(agentR, SLOT, 0), 6);
  });

  it('이미 자리가 있는 버블은 돌려주지 않는다 — 정하는 것은 처음 설 자리뿐', () => {
    const out = seat([domain('a', 1), domain('b', 2)]);
    expect([...out.keys()].sort()).toEqual(['a', 'b']);
  });

  it('말풍선 에이전트는 상자째 비켜 간다 — 궤도가 긴 변 밖에서 시작한다', () => {
    const card: BubbleData = { ...agent, customCreated: true, agentForm: 'card' };
    const d = domain('docs', 1);
    const out = seatWebOrbitBubbles({
      pending: [d],
      bubbles: [card, d],
      nodes: [],
      positions: new Map([[card.id, { x: 100, y: 100 }]]),
      edges: [{ source: d.id, target: card.id }],
      heat: undefined,
      fileSizeRange: undefined,
      bounds: BOX,
      cardForm: true,
      fallbackCenter: CENTER,
    });
    const dd = calcBubbleSize(d);
    const pos = out.get(d.id)!;
    const center = { x: 100 + AGENT_CARD.width / 2, y: 100 + AGENT_CARD.height / 2 };
    expect(pos.x + dd / 2).toBeCloseTo(center.x, 6);
    expect(pos.y + dd / 2).toBeCloseTo(center.y - webOrbitRingRadius(AGENT_CARD.width / 2, SLOT, 0), 6);
  });

  it('궤도에 앉는 타입은 도메인이다(§3.3 표 한 줄)', () => {
    expect(WEB_ORBIT_TYPES.has('domain')).toBe(true);
    expect(WEB_ORBIT_TYPES.has('internal_folder')).toBe(false);
  });
});

describe('§5.23 웹 궤도 — 큰 원(radialLayout)에서 빠진다', () => {
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
