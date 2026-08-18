/**
 * 캔버스 물리의 **순수 기하** — 겹침 판정과 밀어내기 벡터.
 *
 * `usePhysicsLayout` 에서 떼어 낸 이유는 두 가지다.
 * 1) 원형 버블만 있던 시절의 원↔원 계산으로는, 캔버스에 함께 떠 있는 사각 요소(메모 박스·캡처
 *    버블·앱 iframe·플레이 버블)를 외접원으로 근사해야 해서 실제보다 훨씬 넓게 밀어냈다.
 * 2) 좌표·기하는 UI 없이 검증하는 편이 정확하다(`floatingWindowGeom` 선례).
 */

/**
 * 충돌 그룹 — 무엇이 무엇과 부딪히는지 결정한다.
 * - `bubble`  : 에이전트/폴더/파일 위성 등 원형 버블.
 * - `panel`   : 캡처·앱(iframe)·플레이 버블처럼 화면을 차지하는 사각 창.
 * - `commentBox`: 버블을 **담는** 그룹 상자. 담긴 버블을 밀어내면 그룹이 깨지므로
 *   버블·패널과는 부딪히지 않고 **코멘트 박스끼리만** 밀어낸다(밀릴 때 멤버를 데리고 간다).
 */
export type PhysicsGroup = 'bubble' | 'panel' | 'commentBox';

/** 충돌 계산에 필요한 최소 형상 — 중심 좌표 + 반경/반치수 + 그룹. */
export interface PhysicsShape {
  /** 중심 좌표(좌상단 ❌). */
  x: number;
  y: number;
  /** 원형 바디의 반경. 사각 바디에서는 쓰지 않는다. */
  radius: number;
  halfW: number;
  halfH: number;
  shape: 'circle' | 'rect';
  group: PhysicsGroup;
  parentId: string | null;
}

/** 원형 버블끼리 띄워 두는 간격. 사각 요소가 낀 쌍은 0 — 붙여 놓은 변이 다시 벌어지면 안 된다. */
export const MAGNET_GAP = 12;

/** 이 쌍에 적용할 간격. */
export function gapBetween(a: PhysicsShape, b: PhysicsShape): number {
  return a.shape === 'circle' && b.shape === 'circle' ? MAGNET_GAP : 0;
}

/** 질량 — 클수록 덜 밀린다. 위성은 가볍고, 화면을 크게 차지하는 사각 창은 묵직하다. */
export function massOf(body: PhysicsShape): number {
  if (body.parentId) return 1;
  if (body.group === 'commentBox') return 8;
  if (body.group === 'panel') return 6;
  return 3;
}

/** 휴리스틱·공간 그리드에서 쓰는 대표 크기. */
export function extentOf(body: PhysicsShape): number {
  return body.shape === 'circle' ? body.radius : Math.max(body.halfW, body.halfH);
}

/** 두 바디가 서로 부딪히는 관계인지. 코멘트 박스는 자기들끼리만. */
export function collidable(a: PhysicsShape, b: PhysicsShape): boolean {
  if (a.group === 'commentBox' || b.group === 'commentBox') return a.group === b.group;
  return true;
}

export interface Separation {
  /** a 가 밀려나야 할 방향(단위 벡터). b 는 반대 방향. */
  nx: number;
  ny: number;
  /** 침투 깊이 — 이만큼을 두 바디가 나눠 물러난다. */
  depth: number;
}

/**
 * 겹침 해소 벡터. 안 겹치면 null.
 * 원↔원, 사각↔사각(AABB — 침투가 얕은 축으로), 원↔사각(사각 위 최근접점) 세 조합을 모두 다룬다.
 */
export function separation(a: PhysicsShape, b: PhysicsShape, gap: number): Separation | null {
  if (a.shape === 'circle' && b.shape === 'circle') {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
    const minDist = a.radius + b.radius + gap;
    if (dist >= minDist) return null;
    return { nx: dx / dist, ny: dy / dist, depth: minDist - dist };
  }

  if (a.shape === 'rect' && b.shape === 'rect') {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const overlapX = a.halfW + b.halfW + gap - Math.abs(dx);
    const overlapY = a.halfH + b.halfH + gap - Math.abs(dy);
    if (overlapX <= 0 || overlapY <= 0) return null;
    // 침투가 얕은 축으로만 밀어낸다 — 사각끼리는 옆으로 미끄러지듯 정리된다.
    if (overlapX < overlapY) return { nx: dx < 0 ? -1 : 1, ny: 0, depth: overlapX };
    return { nx: 0, ny: dy < 0 ? -1 : 1, depth: overlapY };
  }

  const circle = a.shape === 'circle' ? a : b;
  const rect = a.shape === 'circle' ? b : a;
  // 법선은 항상 a 기준 — 원이 b 쪽이면 뒤집는다.
  const sign = a.shape === 'circle' ? 1 : -1;

  const nearestX = Math.max(rect.x - rect.halfW, Math.min(circle.x, rect.x + rect.halfW));
  const nearestY = Math.max(rect.y - rect.halfH, Math.min(circle.y, rect.y + rect.halfH));
  const dx = circle.x - nearestX;
  const dy = circle.y - nearestY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > 0.0001) {
    const depth = circle.radius + gap - dist;
    if (depth <= 0) return null;
    return { nx: (dx / dist) * sign, ny: (dy / dist) * sign, depth };
  }

  // 원 중심이 사각 안 — 가장 가까운 변 밖으로 밀어낸다.
  const toLeft = circle.x - (rect.x - rect.halfW);
  const toRight = rect.x + rect.halfW - circle.x;
  const toTop = circle.y - (rect.y - rect.halfH);
  const toBottom = rect.y + rect.halfH - circle.y;
  const nearest = Math.min(toLeft, toRight, toTop, toBottom);
  let ux = 0;
  let uy = 0;
  if (nearest === toLeft) ux = -1;
  else if (nearest === toRight) ux = 1;
  else if (nearest === toTop) uy = -1;
  else uy = 1;
  return { nx: ux * sign, ny: uy * sign, depth: circle.radius + gap + nearest };
}
