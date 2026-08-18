import { describe, it, expect } from 'vitest';
import {
  MAGNET_GAP,
  collidable,
  extentOf,
  gapBetween,
  massOf,
  separation,
  type PhysicsGroup,
  type PhysicsShape,
} from './physicsGeometry.js';

function circle(x: number, y: number, radius: number, group: PhysicsGroup = 'bubble', parentId: string | null = null): PhysicsShape {
  return { x, y, radius, halfW: radius, halfH: radius, shape: 'circle', group, parentId };
}

function rect(x: number, y: number, width: number, height: number, group: PhysicsGroup = 'panel'): PhysicsShape {
  return { x, y, radius: Math.max(width, height) / 2, halfW: width / 2, halfH: height / 2, shape: 'rect', group, parentId: null };
}

describe('collidable — 무엇이 무엇과 부딪히나', () => {
  it('버블과 사각 창은 서로 부딪힌다', () => {
    expect(collidable(circle(0, 0, 40), rect(0, 0, 300, 200))).toBe(true);
  });

  it('코멘트 박스는 버블·패널을 밀어내지 않는다 (담고 있는 버블이 튕겨 나가면 그룹이 깨진다)', () => {
    const box = rect(0, 0, 400, 300, 'commentBox');
    expect(collidable(box, circle(0, 0, 40))).toBe(false);
    expect(collidable(box, rect(0, 0, 300, 200, 'panel'))).toBe(false);
    expect(collidable(circle(0, 0, 40), box)).toBe(false);
  });

  it('코멘트 박스끼리는 부딪힌다', () => {
    expect(collidable(rect(0, 0, 400, 300, 'commentBox'), rect(10, 10, 400, 300, 'commentBox'))).toBe(true);
  });
});

describe('gapBetween — 붙여 놓은 사각 요소는 다시 벌어지지 않는다', () => {
  it('원형 버블끼리는 MAGNET_GAP 만큼 띄운다', () => {
    expect(gapBetween(circle(0, 0, 40), circle(10, 0, 40))).toBe(MAGNET_GAP);
  });

  it('사각이 하나라도 끼면 간격 0', () => {
    expect(gapBetween(rect(0, 0, 200, 100), rect(10, 0, 200, 100))).toBe(0);
    expect(gapBetween(circle(0, 0, 40), rect(10, 0, 200, 100))).toBe(0);
  });

  it('변끼리 딱 맞닿은 캡처 버블 두 장은 겹침으로 잡히지 않는다 (§5.9 이어 붙이기 유지)', () => {
    const left = rect(0, 0, 200, 100);
    const right = rect(200, 0, 200, 100); // 왼쪽의 오른 변 == 오른쪽의 왼 변
    expect(separation(left, right, gapBetween(left, right))).toBeNull();
  });
});

describe('separation — 원 ↔ 원', () => {
  it('간격만큼 떨어져 있으면 밀지 않는다', () => {
    expect(separation(circle(0, 0, 40), circle(80 + MAGNET_GAP, 0, 40), MAGNET_GAP)).toBeNull();
  });

  it('겹치면 a 가 b 반대쪽으로 밀린다', () => {
    const sep = separation(circle(0, 0, 40), circle(50, 0, 40), MAGNET_GAP);
    expect(sep).not.toBeNull();
    expect(sep!.nx).toBeCloseTo(-1, 5);
    expect(sep!.ny).toBeCloseTo(0, 5);
    // 최소거리(40+40+12=92) - 실제거리(50) = 42
    expect(sep!.depth).toBeCloseTo(42, 5);
  });
});

describe('separation — 사각 ↔ 사각', () => {
  it('침투가 얕은 축(가로)으로 밀어낸다', () => {
    // 가로 20 겹침, 세로 90 겹침 → 가로로 20 만큼 벌린다
    const a = rect(0, 0, 200, 100);
    const b = rect(180, 5, 200, 100);
    const sep = separation(a, b, 0);
    expect(sep).not.toBeNull();
    expect(sep!.nx).toBe(-1);
    expect(sep!.ny).toBe(0);
    expect(sep!.depth).toBeCloseTo(20, 5);
  });

  it('세로 침투가 얕으면 세로로 밀어낸다', () => {
    const a = rect(0, 0, 200, 100);
    const b = rect(10, 95, 200, 100);
    const sep = separation(a, b, 0);
    expect(sep).not.toBeNull();
    expect(sep!.nx).toBe(0);
    expect(sep!.ny).toBe(-1);
    expect(sep!.depth).toBeCloseTo(5, 5);
  });

  it('한 축이라도 떨어져 있으면 null', () => {
    expect(separation(rect(0, 0, 200, 100), rect(400, 0, 200, 100), 0)).toBeNull();
  });
});

describe('separation — 원 ↔ 사각 (외접원 근사 금지)', () => {
  it('큰 iframe 의 모서리 바깥 대각선에 있는 버블은 밀리지 않는다', () => {
    // 900×600 창의 외접원(반경 540)으로 근사하면 이 버블이 잘못 밀려난다.
    const panel = rect(0, 0, 900, 600);
    const bubble = circle(500, 350, 40);
    expect(separation(bubble, panel, 0)).toBeNull();
  });

  it('변에 파고든 버블은 그 변의 법선 방향으로 밀린다', () => {
    const panel = rect(0, 0, 200, 100);
    const bubble = circle(0, 60, 40); // 아래 변(y=50) 안쪽으로 30 파고듦
    const sep = separation(bubble, panel, 0);
    expect(sep).not.toBeNull();
    expect(sep!.nx).toBeCloseTo(0, 5);
    expect(sep!.ny).toBeCloseTo(1, 5);
    expect(sep!.depth).toBeCloseTo(30, 5);
  });

  it('법선은 언제나 첫 번째 인자가 밀려날 방향이다 (인자 순서를 바꾸면 뒤집힌다)', () => {
    const panel = rect(0, 0, 200, 100);
    const bubble = circle(0, 60, 40);
    const forward = separation(bubble, panel, 0)!;
    const reverse = separation(panel, bubble, 0)!;
    expect(reverse.nx).toBeCloseTo(-forward.nx, 5);
    expect(reverse.ny).toBeCloseTo(-forward.ny, 5);
    expect(reverse.depth).toBeCloseTo(forward.depth, 5);
  });

  it('원 중심이 사각 안이면 가장 가까운 변 밖으로 밀어낸다', () => {
    const panel = rect(0, 0, 200, 100);
    const bubble = circle(90, 0, 20); // 오른 변(x=100)이 가장 가깝다(10)
    const sep = separation(bubble, panel, 0);
    expect(sep).not.toBeNull();
    expect(sep!.nx).toBe(1);
    expect(sep!.ny).toBe(0);
    // 반경(20) + 남은 거리(10) 만큼 나가야 변 밖으로 완전히 빠진다
    expect(sep!.depth).toBeCloseTo(30, 5);
  });
});

describe('massOf / extentOf', () => {
  it('위성이 가장 가볍고 코멘트 박스가 가장 무겁다', () => {
    const satellite = circle(0, 0, 20, 'bubble', 'agent-1');
    const bubble = circle(0, 0, 40);
    const panel = rect(0, 0, 300, 200);
    const box = rect(0, 0, 400, 300, 'commentBox');
    expect(massOf(satellite)).toBeLessThan(massOf(bubble));
    expect(massOf(bubble)).toBeLessThan(massOf(panel));
    expect(massOf(panel)).toBeLessThan(massOf(box));
  });

  it('사각의 대표 크기는 긴 쪽의 절반 — 공간 그리드 셀이 상호작용 거리를 덮어야 한다', () => {
    expect(extentOf(rect(0, 0, 900, 600))).toBe(450);
    expect(extentOf(circle(0, 0, 40))).toBe(40);
  });
});
