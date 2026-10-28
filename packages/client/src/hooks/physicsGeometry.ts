import { PHYSICS_MAGNET_GAP, SPAWN_ZONE } from '@vibisual/shared';

import { satelliteSeatDistance } from '../utils/satellite.js';

/**
 * 캔버스 물리의 순수 기하 — 겹침 판정과 밀어내기 벡터.
 * 사각 요소(메모 박스·캡처 버블·앱 iframe·플레이 버블)를 외접원으로 근사하면 실제보다 훨씬 넓게 밀어내므로 원·사각을 그대로 다룬다.
 * 좌표·기하는 UI 없이 검증한다(`floatingWindowGeom` 선례).
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

/**
 * 원형 버블끼리 띄워 두는 간격. 사각 요소가 낀 쌍은 0 — 붙여 놓은 변이 다시 벌어지면 안 된다.
 * 값은 shared 한 곳이다 — §5.1 #2-2 등장 영역이 새 버블의 빈칸을 같은 간격으로 고른다(두 벌이면 앉힌
 * 자리를 물리가 다시 민다).
 */
export const MAGNET_GAP = PHYSICS_MAGNET_GAP;

/**
 * 겹침을 풀 때 얹는 되튐 세기 — 침투 깊이에 정확히 비례한다. 바닥값을 두면 안 된다:
 * `max(깊이, 1) × 0.3` 처럼 바닥을 두면 깊이가 0 에 수렴한 쉬는 접촉에도 매 걸음 속도가 들어가 닿은 쌍이 영구 추진기가 된다 — 위성 스프링이 접촉을 다시 만들어
 * 무리 전체가 한 방향으로 흘러 레이아웃 상자 끝에 박힌다. 비례하면 접촉이 풀리는 순간 되튐도 0 이라 계가 스스로 멎는다.
 */
export const SEPARATION_BOUNCE = 0.3;

/**
 * 두 바디가 완전히 겹쳐 밀어낼 방향을 정할 수 없을 때 쓰는 축(px 미만 차이).
 * 중심이 같으면 방향 벡터가 `0/0` 이라 `nx=ny=0` 이면 아무리 겹쳐도 안 밀린다. 무작위 흔들림(jitter)으로 덮으면 캔버스 전체가 상시로 떨고 정지 판정이 막힌다
 * (`usePhysicsLayout`) — 정해진 축 하나로 대칭을 깬다(재현 가능, 시험으로 고정).
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
 * 겹침 해소의 응답 — 그 깊이를 둘이 어떻게 나누는가(`separation` 은 어디로 얼마나). 셋 다 한 걸음 안에서 겹침이 완전히 풀린다는 전제다.
 * 1. 한쪽만 움직일 수 있으면 그쪽이 깊이 전부를 물러난다 — 절반이면 남은 절반이 다음 걸음으로 넘어가 파고든 채 붙어 미끄러진다.
 * 2. 위성은 부모가 아닌 바디에게 깊이 전부를 양보한다 — 위성 자리는 매 걸음 스프링이 다시 만들어, 나눠 받은 상대의 변위만 영구히 쌓여 위성 하나가 지도 전체를 한 방향으로 민다.
 * 3. 물러나지 않는 쪽은 되튐도 받지 않는다 — 변위 0 에 속도만 주면 같은 밀림이 속도를 타고 돌아온다(2번 우회).
 * 위성끼리는 반씩 나눈다 — 둘 다 스프링이 되돌려 변위가 쌓이지 않는다.
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

/**
 * §5.1 #2-1 (B) — 부모가 바뀐 위성의 새 궤도 자리(부모 중심 기준 오프셋). 별자리가 서면 파일 위성의 부모가 폴더에서 별자리 중심(파일 위성·앱 노드)으로 바뀌고, 옛 오프셋이면 스프링이 엉뚱한 자리로 끈다.
 * 방향은 지금 자리에서 새 부모를 본 쪽(가로질러 날아가지 않게), 거리는 부모 반경 + 위성 반경 + 간격 — 드래그 놓기(`onSatelliteDragStop`)·정리(§5.4 #33)와 같은 평형점이라 궤도가 스스로 풀리지 않는다.
 * 두 중심이 겹치면 id 로 정한 각도(재현 가능 — 무작위 ❌, `DEGENERATE_EPSILON` 과 같은 규율).
 */
export function orbitSeatOffset(
  parent: { readonly x: number; readonly y: number; readonly radius: number },
  body: { readonly id: string; readonly x: number; readonly y: number; readonly radius: number; readonly reach?: number | undefined },
  gap: number,
): { x: number; y: number } {
  let dx = body.x - parent.x;
  let dy = body.y - parent.y;
  let dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < DEGENERATE_EPSILON) {
    const angle = degenerateAngle(body.id);
    dx = Math.cos(angle);
    dy = Math.sin(angle);
    dist = 1;
  }
  const orbit = parent.radius + orbitExtentOf(body) + gap;
  return { x: (dx / dist) * orbit, y: (dy / dist) * orbit };
}

/** 두 중심이 겹쳐 방향이 없을 때의 각도 — id 로 정한다(재현 가능 — 무작위 ❌, `DEGENERATE_EPSILON` 과 같은 규율). */
function degenerateAngle(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 360) * Math.PI) / 180;
}

/**
 * §5.1 #2-2 (J) — 궤도를 재는 반경. 달을 거느린 위성(묶음)은 가장 큰 달의 바깥 테두리까지가 몸이라(노드 데이터 `_orbitReach`)
 * 그 몸집으로 재야 제 달이 부모를 파고들지 않는다. 몸집이 없거나 원보다 작으면 그려지는 원이다.
 */
export function orbitExtentOf(body: { readonly radius: number; readonly reach?: number | undefined }): number {
  const reach = body.reach;
  return typeof reach === 'number' && Number.isFinite(reach) && reach > body.radius ? reach : body.radius;
}

/** 궤도 밀어내기를 건너뛰는 오차(px) — 측정 반올림으로 매번 깨우지 않게. */
const ORBIT_MIN_TOLERANCE = 0.5;

/**
 * §5.1 #2-2 (J) — 궤도 안쪽으로 들어온 위성을 궤도로 민다(부모 중심 기준 오프셋 · 방향 유지).
 * 폴더는 쓸수록 커져(활동량 · 작업 중 1.15배) 처음 앉은 거리면 테두리를 파고들고, 스프링(옛 거리)과 겹침 풀기가 다퉈 위성이 테두리에서 떤다.
 * 평형점(부모 반경 + 몸집 + 간격)보다 가까울 때만 그 거리로 늘린다 — 바깥 고리 위성은 당겨 들이지 않는다. 바꿀 것이 없으면 `null`.
 */
export function orbitMinOffset(
  parent: { readonly radius: number },
  body: { readonly id: string; readonly radius: number; readonly reach?: number | undefined; readonly offsetX: number; readonly offsetY: number },
  gap: number,
): { x: number; y: number } | null {
  const need = parent.radius + orbitExtentOf(body) + gap;
  const len = Math.hypot(body.offsetX, body.offsetY);
  if (!(Number.isFinite(need) && Number.isFinite(len))) return null;
  if (len >= need - ORBIT_MIN_TOLERANCE) return null;
  if (len < DEGENERATE_EPSILON) {
    const angle = degenerateAngle(body.id);
    return { x: Math.cos(angle) * need, y: Math.sin(angle) * need };
  }
  return { x: (body.offsetX / len) * need, y: (body.offsetY / len) * need };
}

/** 다시 걸 위성 — 지금 자리(중심) · 그려지는 반경 · 몸집. */
export interface OrbitBody {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly reach?: number | undefined;
}

/** 같은 부모를 이미 도는 위성 — 스프링 목표(부모 중심 기준 오프셋)와 반경. */
export interface OrbitSibling {
  readonly radius: number;
  readonly reach?: number | undefined;
  readonly offsetX: number;
  readonly offsetY: number;
}

const TWO_PI = Math.PI * 2;

/** 두 각도 사이의 가장 짧은 거리(0..π). */
function angularDistance(a: number, b: number): number {
  const d = Math.abs(((a - b) % TWO_PI + TWO_PI) % TWO_PI);
  return d > Math.PI ? TWO_PI - d : d;
}

/**
 * §5.1 #2-1 (B) · §5.1 #2-2 (J) — 부모가 바뀐 위성들을 새 부모 둘레 궤도에 건다(id → 부모 중심 기준 오프셋).
 * 묶음이 서는 순간 구성들이 한꺼번에 새 부모로 옮겨 온다 — 하나씩 "지금 방향"으로 걸면 같은 방향에 포개지고 겹침 풀기가 그 뭉치를 폴더 쪽으로 밀어 붙인다.
 *  - 그 부모의 위성이 전부 새로 걸리면(묶음이 막 섰다) 궤도를 그 수로 고르게 나눠, 각도 순서를 지킨 채 가장 덜 도는 회전에 건다(정리 §5.4 #33 `placeRing` 과 같은 규율).
 *  - 이미 도는 형제가 있으면 그 수로 나눈 칸(12시부터 — 등장 영역과 같은 시작) 중 형제와 겹치지 않고 지금 방향에 가장 가까운 칸. 빈칸이 없으면 지금 방향(남은 겹침은 물리가 푼다).
 * 거리는 등장 영역 고리 0 과 같다 — 위성 수를 다 담도록 넓힌 고리(`satelliteSeatDistance`, 몸집이 있으면 몸집으로).
 */
export function orbitReseatGroup(
  parent: { readonly x: number; readonly y: number; readonly radius: number },
  group: readonly OrbitBody[],
  siblings: readonly OrbitSibling[],
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (group.length === 0) return out;
  const n = group.length + siblings.length;
  const step = TWO_PI / n;
  const distOf = (b: OrbitBody): number => satelliteSeatDistance(parent.radius, n, orbitExtentOf(b) * 2);
  const angleOf = (b: OrbitBody): number => {
    const dx = b.x - parent.x;
    const dy = b.y - parent.y;
    return Math.hypot(dx, dy) < DEGENERATE_EPSILON ? degenerateAngle(b.id) : Math.atan2(dy, dx);
  };
  const ordered = group
    .map((b) => ({ b, theta: angleOf(b) }))
    .sort((p, q) => (p.theta - q.theta) || (p.b.id < q.b.id ? -1 : p.b.id > q.b.id ? 1 : 0));
  const put = (b: OrbitBody, angle: number): { x: number; y: number } => {
    const d = distOf(b);
    const seat = { x: Math.cos(angle) * d, y: Math.sin(angle) * d };
    out.set(b.id, seat);
    return seat;
  };

  if (siblings.length === 0) {
    if (ordered.length === 1) {
      put(ordered[0]!.b, ordered[0]!.theta);
      return out;
    }
    // 고르게 — 지금 각도 순서의 어느 자리에서 한 바퀴를 시작할지(순환 이동)와 통째 회전을 함께 골라 가장 덜 돌게 한다.
    //   회전 하나만 고르면 ±π 이음매에 걸친 무리가 반 바퀴씩 돌아 서로 가로지른다.
    let best: { shift: number; rot: number; cost: number } | null = null;
    for (let shift = 0; shift < ordered.length; shift += 1) {
      let s = 0;
      let c = 0;
      for (let i = 0; i < ordered.length; i += 1) {
        const theta = ordered[(i + shift) % ordered.length]!.theta;
        s += Math.sin(theta - i * step);
        c += Math.cos(theta - i * step);
      }
      const rot = Math.hypot(s, c) < 1e-12 ? SPAWN_ZONE.START_ANGLE : Math.atan2(s, c);
      let cost = 0;
      for (let i = 0; i < ordered.length; i += 1) {
        const d = angularDistance(ordered[(i + shift) % ordered.length]!.theta, rot + i * step);
        cost += d * d;
      }
      if (best === null || cost < best.cost - 1e-9) best = { shift, rot, cost };
    }
    for (let i = 0; i < ordered.length; i += 1) {
      put(ordered[(i + best!.shift) % ordered.length]!.b, best!.rot + i * step);
    }
    return out;
  }

  // 이미 도는 형제가 있다 — 그 수로 나눈 칸 가운데 형제·먼저 건 것과 겹치지 않는 칸에서 지금 방향에 가장 가까운 칸.
  const placed = siblings.map((s) => ({ x: s.offsetX, y: s.offsetY, r: orbitExtentOf(s) }));
  const taken = new Set<number>();
  for (const { b, theta } of ordered) {
    const r = orbitExtentOf(b);
    const d = distOf(b);
    let pick = -1;
    let pickDiff = Number.POSITIVE_INFINITY;
    for (let k = 0; k < n; k += 1) {
      if (taken.has(k)) continue;
      const angle = SPAWN_ZONE.START_ANGLE + k * step;
      const x = Math.cos(angle) * d;
      const y = Math.sin(angle) * d;
      if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + r + MAGNET_GAP)) continue;
      const diff = angularDistance(angle, theta);
      if (diff < pickDiff - 1e-9) {
        pick = k;
        pickDiff = diff;
      }
    }
    if (pick >= 0) taken.add(pick);
    const seat = put(b, pick >= 0 ? SPAWN_ZONE.START_ANGLE + pick * step : theta);
    placed.push({ x: seat.x, y: seat.y, r });
  }
  return out;
}

/**
 * §5.1 #2-1 (F) ⑤ — 정해진 **각도**의 궤도 자리(부모 중심 기준 오프셋). 앱 작업 위성은 역할 순서가 곧 자리라 지금 방향이 아니라
 * 이 각도에 건다. 사각 부모(앱 노드)는 타원이다 — 가로·세로 반폭에 위성 반경 + 간격을 더한 두 반지름(화면의 흐린 타원 궤도와
 * 같은 모양). 원 부모는 `orbitSeatOffset` 과 같은 평형점이다.
 */
export function orbitSeatAtAngle(
  parent: { readonly radius: number; readonly halfW?: number; readonly halfH?: number; readonly shape?: 'circle' | 'rect' },
  body: { readonly radius: number },
  gap: number,
  angle: number,
): { x: number; y: number } {
  const rect = parent.shape === 'rect' && typeof parent.halfW === 'number' && typeof parent.halfH === 'number';
  const rx = (rect ? parent.halfW! : parent.radius) + body.radius + gap;
  const ry = (rect ? parent.halfH! : parent.radius) + body.radius + gap;
  return { x: Math.cos(angle) * rx, y: Math.sin(angle) * ry };
}
