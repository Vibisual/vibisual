/**
 * §5.1 #2-1 (B) — 부모가 바뀐 위성의 새 궤도 자리(`orbitSeatOffset`) 고정 시험.
 *
 * 고정하는 것: ① 방향은 지금 자리에서 새 부모를 본 쪽 ② 거리는 부모 반경 + 위성 반경 + 간격(드래그 놓기·정리와 같은 평형점)
 * ③ 두 중심이 겹치면 id 로 정한 각도 — 같은 id 는 언제나 같은 자리(무작위 ❌).
 */
import { describe, it, expect } from 'vitest';
import { PHYSICS_MAGNET_GAP, SATELLITE_ORBIT_GAP, SPAWN_ZONE } from '@vibisual/shared';
import { orbitMinOffset, orbitReseatGroup, orbitSeatOffset, type OrbitBody, type OrbitSibling } from './physicsGeometry.js';
import { satelliteSeatDistance } from '../utils/satellite.js';

const TWO_PI = Math.PI * 2;
const DEG = Math.PI / 180;
/** 12시에서 시계 방향으로 잰 각도(0..2π). */
function clockAngle(x: number, y: number): number {
  const a = Math.atan2(y, x) - SPAWN_ZONE.START_ANGLE;
  return ((a % TWO_PI) + TWO_PI) % TWO_PI;
}
/** 두 각도 사이의 가장 짧은 거리. */
function arc(a: number, b: number): number {
  const d = Math.abs(((a - b) % TWO_PI + TWO_PI) % TWO_PI);
  return d > Math.PI ? TWO_PI - d : d;
}

describe('orbitSeatOffset — 새 부모 둘레 궤도', () => {
  it('방향을 지키고 거리는 평형점이다', () => {
    const seat = orbitSeatOffset({ x: 0, y: 0, radius: 40 }, { id: 'sat-a', x: 300, y: 0, radius: 20 }, SATELLITE_ORBIT_GAP);
    expect(seat.x).toBeCloseTo(40 + 20 + SATELLITE_ORBIT_GAP);
    expect(seat.y).toBeCloseTo(0);
  });

  it('사각 부모(앱 노드)는 반경으로 받은 값 그대로 쓴다', () => {
    const seat = orbitSeatOffset({ x: 100, y: 100, radius: 104 }, { id: 'sat-b', x: 100, y: 400, radius: 25 }, SATELLITE_ORBIT_GAP);
    expect(seat.x).toBeCloseTo(0);
    expect(seat.y).toBeCloseTo(104 + 25 + SATELLITE_ORBIT_GAP);
  });

  it('두 중심이 겹치면 id 로 정한 각도 — 같은 id 는 같은 자리', () => {
    const parent = { x: 10, y: 10, radius: 30 };
    const a1 = orbitSeatOffset(parent, { id: 'sat-same', x: 10, y: 10, radius: 20 }, SATELLITE_ORBIT_GAP);
    const a2 = orbitSeatOffset(parent, { id: 'sat-same', x: 10, y: 10, radius: 20 }, SATELLITE_ORBIT_GAP);
    expect(a1).toEqual(a2);
    expect(Math.hypot(a1.x, a1.y)).toBeCloseTo(30 + 20 + SATELLITE_ORBIT_GAP);
  });
});

/**
 * §5.1 #2-2 (J) — 위성 궤도에 숨 쉴 틈(2026-10-22 사용자 지시 「폴더에 붙는 위성들이 너무 짧아져서 다닥다닥」).
 * 고정하는 것: ① 달을 거느린 위성(묶음)은 몸집으로 궤도를 잰다 ② 부모가 커져 궤도 안쪽으로 들어온 위성은 그 방향 그대로 궤도로
 * 민다 — 바깥 고리는 당겨 들이지 않는다 ③ 부모가 바뀐 무리(묶음이 막 섰다)는 새 부모 둘레에 고르게, 가장 덜 돌게 건다
 * ④ 이미 도는 형제가 있으면 형제와 겹치지 않는 칸에 건다.
 */
describe('§5.1 #2-2 (J) 궤도 — 몸집 · 밀어내기 · 무리로 다시 걸기', () => {
  it('달을 거느린 위성(묶음)은 몸집으로 궤도를 잰다 — 제 달이 부모를 파고들지 않게', () => {
    const seat = orbitSeatOffset({ x: 0, y: 0, radius: 90 }, { id: 'sat-bundle', x: 400, y: 0, radius: 32, reach: 160 }, SATELLITE_ORBIT_GAP);
    expect(seat.x).toBeCloseTo(90 + 160 + SATELLITE_ORBIT_GAP);
    // 몸집이 원보다 작거나 없으면 그려지는 원이다.
    const plain = orbitSeatOffset({ x: 0, y: 0, radius: 90 }, { id: 'sat-a', x: 400, y: 0, radius: 32, reach: 10 }, SATELLITE_ORBIT_GAP);
    expect(plain.x).toBeCloseTo(90 + 32 + SATELLITE_ORBIT_GAP);
  });

  it('부모가 커져 테두리를 파고든 위성은 그 방향 그대로 궤도로 민다', () => {
    // 70px 폴더 둘레 첫 고리에 앉았던 위성 — 폴더가 쓸수록 커져 180px 가 됐다.
    const offset = { x: 0, y: -(35 + 30 + SATELLITE_ORBIT_GAP) };
    const pushed = orbitMinOffset({ radius: 90 }, { id: 'sat-a', radius: 30, offsetX: offset.x, offsetY: offset.y }, SATELLITE_ORBIT_GAP);
    expect(pushed).not.toBeNull();
    expect(pushed!.x).toBeCloseTo(0);
    expect(pushed!.y).toBeCloseTo(-(90 + 30 + SATELLITE_ORBIT_GAP));
  });

  it('궤도보다 멀리 앉은 위성(바깥 고리)은 당겨 들이지 않는다 · 몸집도 본다', () => {
    expect(orbitMinOffset({ radius: 90 }, { id: 'sat-far', radius: 30, offsetX: 400, offsetY: 0 }, SATELLITE_ORBIT_GAP)).toBeNull();
    // 반올림 오차 안이면 깨우지 않는다.
    expect(orbitMinOffset({ radius: 90 }, { id: 'sat-on', radius: 30, offsetX: 90 + 30 + SATELLITE_ORBIT_GAP - 0.2, offsetY: 0 }, SATELLITE_ORBIT_GAP)).toBeNull();
    const hub = orbitMinOffset({ radius: 90 }, { id: 'sat-bundle', radius: 32, reach: 150, offsetX: 200, offsetY: 0 }, SATELLITE_ORBIT_GAP);
    expect(hub!.x).toBeCloseTo(90 + 150 + SATELLITE_ORBIT_GAP);
  });

  it('부모가 바뀐 무리가 한쪽에 몰려 와도 새 부모 둘레에 고르게 — 지금 각도 순서는 지킨다', () => {
    // 묶음이 막 섰다 — 구성 다섯이 모두 폴더 쪽(묶음의 위쪽)에서 옮겨 온다.
    const parent = { x: 1000, y: 1000, radius: 32 };
    const group: OrbitBody[] = [-130, -110, -90, -70, -50].map((deg, i) => ({
      id: `sat-m${i}`,
      x: parent.x + Math.cos(deg * DEG) * 140,
      y: parent.y + Math.sin(deg * DEG) * 140,
      radius: 30,
    }));
    const seats = orbitReseatGroup(parent, group, []);
    const angles = group.map((b) => clockAngle(seats.get(b.id)!.x, seats.get(b.id)!.y));
    // 이웃 사이가 모두 72° — 고르게.
    const sorted = [...angles].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i += 1) {
      expect(arc(sorted[i]!, sorted[(i + 1) % sorted.length]!)).toBeCloseTo(72 * DEG, 6);
    }
    // 순서 — 처음 시계 방향 순서 그대로 돈다(서로 가로지르지 않는다).
    for (let i = 0; i < angles.length - 1; i += 1) {
      const step = ((angles[i + 1]! - angles[i]!) % TWO_PI + TWO_PI) % TWO_PI;
      expect(step).toBeCloseTo(72 * DEG, 6);
    }
    // 가장 덜 돈다 — 가운데(12시에 있던 것)는 제자리 근처에 남는다.
    expect(arc(angles[2]!, 0)).toBeLessThan(1e-6);
    // 거리는 등장 영역 고리 0 과 같다.
    for (const b of group) {
      const s = seats.get(b.id)!;
      expect(Math.hypot(s.x, s.y)).toBeCloseTo(satelliteSeatDistance(parent.radius, group.length, 60), 6);
    }
  });

  it('±180° 이음매에 걸친 무리도 반 바퀴씩 돌지 않는다', () => {
    const parent = { x: 0, y: 0, radius: 32 };
    const group: OrbitBody[] = [170, 178, -176, -168].map((deg, i) => ({
      id: `sat-w${i}`, x: Math.cos(deg * DEG) * 120, y: Math.sin(deg * DEG) * 120, radius: 28,
    }));
    const seats = orbitReseatGroup(parent, group, []);
    for (const b of group) {
      const s = seats.get(b.id)!;
      const before = Math.atan2(b.y, b.x);
      const after = Math.atan2(s.y, s.x);
      // 넷을 90° 씩 벌리면 각자 많아야 135° 남짓 움직인다 — 반 바퀴(180°)를 넘게 돌면 서로 가로지른 것이다.
      expect(arc(before, after)).toBeLessThan(140 * DEG);
    }
  });

  it('이미 도는 형제가 있으면 형제와 겹치지 않는 칸에 건다', () => {
    const parent = { x: 0, y: 0, radius: 40 };
    const n = 4;
    const d = satelliteSeatDistance(parent.radius, n, 60);
    // 형제 셋이 12시·3시·6시 칸에 있다 — 남은 칸은 9시 하나.
    const siblings: OrbitSibling[] = [0, 90, 180].map((deg) => {
      const a = SPAWN_ZONE.START_ANGLE + deg * DEG;
      return { radius: 30, offsetX: Math.cos(a) * d, offsetY: Math.sin(a) * d };
    });
    // 새로 걸 것은 지금 12시 쪽에 있다 — 지금 방향 그대로 걸면 12시 형제에 포개진다.
    const body: OrbitBody = { id: 'sat-new', x: 5, y: -150, radius: 30 };
    const seat = orbitReseatGroup(parent, [body], siblings).get(body.id)!;
    expect(clockAngle(seat.x, seat.y)).toBeCloseTo(270 * DEG, 6);
    for (const s of siblings) {
      expect(Math.hypot(seat.x - s.offsetX, seat.y - s.offsetY)).toBeGreaterThanOrEqual(30 + 30 + PHYSICS_MAGNET_GAP);
    }
  });

  it('빈칸이 없으면 종전대로 지금 방향이다', () => {
    const parent = { x: 0, y: 0, radius: 40 };
    const d = satelliteSeatDistance(parent.radius, 2, 60);
    // 형제 하나가 두 칸(12시·6시)을 다 덮을 만큼 크다.
    const siblings: OrbitSibling[] = [{ radius: 30, reach: d + 40, offsetX: 0, offsetY: 0 }];
    const body: OrbitBody = { id: 'sat-x', x: 150, y: 0, radius: 30 };
    const seat = orbitReseatGroup(parent, [body], siblings).get(body.id)!;
    expect(seat.y).toBeCloseTo(0, 6);
    expect(seat.x).toBeGreaterThan(0);
  });
});
