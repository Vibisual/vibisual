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

/**
 * 겹침을 풀 때 얹는 되튐 세기 — **침투 깊이에 정확히 비례**한다. 바닥값을 두면 안 된다.
 *
 * 종전은 `max(깊이, 1) × 0.3` 이었다. 깊이가 0 에 수렴한 **쉬는 접촉**(서로 닿아 멎은 두 버블)에도
 * 매 걸음 0.3 의 속도를 넣는다는 뜻이라, 닿아 있는 쌍이 영구 추진기가 됐다. 위성 스프링이 매 걸음
 * 접촉을 다시 만들어 주므로 그 추진이 끊기지 않고, 무리 전체가 한 방향으로 **영원히 흘러** 결국
 * 레이아웃 상자 끝에 가서 박혔다(같은 자리에서 태어난 버블들이 "저 멀리 가버리던" 원인).
 * 깊이에 비례하면 접촉이 풀리는 순간 되튐도 0 이 되어 계가 스스로 멎는다.
 */
export const SEPARATION_BOUNCE = 0.3;

/**
 * 두 바디가 **완전히 겹쳐** 밀어낼 방향을 정할 수 없을 때 쓰는 축(px 미만 차이).
 *
 * 중심이 같으면 방향 벡터가 `0/0` 이라 종전에는 `nx=ny=0` 이 나가 **아무리 겹쳐도 영영 안 밀렸다**.
 * 물리 쪽은 그것을 매 프레임 무작위 흔들림(jitter)으로 덮고 있었는데, 그 흔들림이 캔버스 전체를
 * 상시로 떨게 만들고 정지 판정까지 막았다(`usePhysicsLayout` 참조). 대칭은 **정해진 축 하나**로
 * 깨는 것으로 충분하다 — 결과가 재현 가능하고 테스트로 고정된다.
 */
export const DEGENERATE_EPSILON = 0.001;

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
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minDist = a.radius + b.radius + gap;
    if (dist >= minDist) return null;
    // 중심이 겹쳐 방향을 못 정하는 경우 — 정해진 축으로 가른다(위 DEGENERATE_EPSILON 주석).
    if (dist < DEGENERATE_EPSILON) return { nx: 1, ny: 0, depth: minDist };
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

/** 겹친 쌍이 이번 걸음에 각자 물러날 거리와 받을 되튐. 부호는 `Separation` 의 법선 기준이다. */
export interface SeparationResponse {
  /** a 가 법선(+) 방향으로 물러날 거리. */
  aPush: number;
  /** b 가 법선(−) 방향으로 물러날 거리. `aPush + bPush === depth` — 한 걸음에 겹침이 완전히 풀린다. */
  bPush: number;
  /** a 가 법선(+) 방향으로 받을 되튐 속도. 물러나지 않는 쪽은 0 이다. */
  aBounce: number;
  bBounce: number;
}

/**
 * 겹침 해소의 **응답** — 누가 얼마나 물러나고 얼마나 되튀는가.
 *
 * `separation` 이 "어디로 얼마나"(공간)를 말한다면 이쪽은 "그 깊이를 둘이 어떻게 나누는가"다.
 * 규칙은 셋이고, 셋 다 **한 걸음 안에서 겹침이 완전히 풀린다**는 것을 전제로 한다.
 *
 * 1. **한쪽만 움직일 수 있으면 그쪽이 깊이 전부**를 물러난다. 절반만 물러나면 남은 절반이 다음
 *    걸음으로 넘어가 두 버블이 파고든 채 한동안 붙어 미끄러진다.
 * 2. **위성은 부모가 아닌 바디에게 깊이 전부를 양보한다.** 위성의 자리는 매 걸음 스프링이 다시
 *    만든다 — 위성을 밀어 봐야 그 변위는 곧 지워지고, 절반을 나눠 받은 **상대의 변위만 영구히
 *    남는다.** 그 절반이 매 걸음 새로 쌓이면 위성 하나가 무한 동력이 되어 이웃을, 이웃의 무리를,
 *    끝내 지도 전체를 한 방향으로 밀어낸다. 위성이 전부 양보하면 상대는 제자리에 있고 위성이
 *    이웃 옆에 비켜 앉는다 — 파일 점이 폴더 버블을 캔버스 끝까지 밀고 가는 일이 없어진다.
 * 3. **물러나지 않는 쪽은 되튐도 받지 않는다.** 변위를 0 으로 두고 속도만 주면 같은 밀림이
 *    속도를 타고 그대로 돌아온다(2번이 막은 자리를 우회한다).
 *
 * 위성끼리는 반씩 나눈다 — 둘 다 스프링이 되돌리므로 어느 쪽에도 변위가 쌓이지 않는다.
 */
export function separationResponse(
  a: PhysicsShape,
  b: PhysicsShape,
  sep: Separation,
  aMovable: boolean,
  bMovable: boolean,
): SeparationResponse {
  const bounce = sep.depth * SEPARATION_BOUNCE;
  const give = (aShare: number): SeparationResponse => ({
    aPush: sep.depth * aShare,
    bPush: sep.depth * (1 - aShare),
    aBounce: aShare > 0 ? bounce : 0,
    bBounce: aShare < 1 ? bounce : 0,
  });

  if (!aMovable) return give(0);
  if (!bMovable) return give(1);

  const aIsSatellite = a.parentId != null;
  const bIsSatellite = b.parentId != null;
  if (aIsSatellite !== bIsSatellite) return give(aIsSatellite ? 1 : 0);

  return give(0.5);
}
