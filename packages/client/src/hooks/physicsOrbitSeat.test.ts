/**
 * §5.1 #2-1 (B) — 부모가 바뀐 위성의 새 궤도 자리(`orbitSeatOffset`) 고정 시험.
 *
 * 고정하는 것: ① 방향은 지금 자리에서 새 부모를 본 쪽 ② 거리는 부모 반경 + 위성 반경 + 간격(드래그 놓기·정리와 같은 평형점)
 * ③ 두 중심이 겹치면 id 로 정한 각도 — 같은 id 는 언제나 같은 자리(무작위 ❌).
 */
import { describe, it, expect } from 'vitest';
import { SATELLITE_ORBIT_GAP } from '@vibisual/shared';
import { orbitSeatOffset } from './physicsGeometry.js';

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
