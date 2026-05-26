// Task Edge 공통 geometry — 실제 엣지와 드래그 프리뷰가 동일한 원리 공유.
// 이 모듈을 거치지 않고 path 를 직접 계산하면 프리뷰와 확정 엣지가 어긋난다.

export const TASK_EDGE_DEFAULT_RADIUS = 45;

export interface TaskEdgePathArgs {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourceRadius: number;
  targetRadius: number;
  /**
   * 평행 엣지 슬롯 번호 (정수, 0 / ±1 / ±2 / ±3 / ...).
   *   0  → 직선 (N=1 유일)
   *   +k → 중심선 수직 방향으로 k·CURVATURE_STEP 만큼 변위 (위/아래 중 한쪽)
   *   -k → 반대쪽으로 k·CURVATURE_STEP 만큼 변위
   * 같은 쌍 여러 엣지가 생성 순서대로 0→+1→-1→+2→-2→+3→... 슬롯에 할당되어
   * 바깥 슬롯일수록 더 휘고 기존 엣지 곡률은 새 엣지 추가에 영향받지 않는다.
   */
  offset?: number;
  /**
   * 타겟 원둘레 상에서 화살촉 endpoint 를 회전시키는 각도(라디안).
   * 같은 타겟에 여러 엣지가 모일 때 화살촉이 겹치지 않도록 원둘레를 따라 이동시킨다.
   * 소스 endpoint 는 항상 자연 각도 고정. 경로 커브는 `offset` 만 결정 — 이 값은 endpoint 만 회전.
   */
  targetAngularOffset?: number;
}

export interface TaskEdgePathResult {
  path: string;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  labelX: number;
  labelY: number;
}

export function computeTaskEdgePath(args: TaskEdgePathArgs): TaskEdgePathResult {
  const dx = args.targetX - args.sourceX;
  const dy = args.targetY - args.sourceY;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / dist;
  const ny = dy / dist;

  // 소스 endpoint — 항상 자연 각도(타겟 방향점) 고정
  const sx = args.sourceX + nx * args.sourceRadius;
  const sy = args.sourceY + ny * args.sourceRadius;

  // 타겟 endpoint — 원둘레 위 "소스 방향" 점에서 targetAngularOffset 만큼 회전.
  // 기본 방향 벡터 (target→source) = (-nx, -ny).
  const angOff = args.targetAngularOffset ?? 0;
  let tx: number;
  let ty: number;
  if (angOff === 0) {
    tx = args.targetX - nx * args.targetRadius;
    ty = args.targetY - ny * args.targetRadius;
  } else {
    const baseAngle = Math.atan2(-ny, -nx);
    const rotated = baseAngle + angOff;
    tx = args.targetX + Math.cos(rotated) * args.targetRadius;
    ty = args.targetY + Math.sin(rotated) * args.targetRadius;
  }

  const slot = args.offset ?? 0;
  if (slot === 0) {
    const path = `M ${sx},${sy} L ${tx},${ty}`;
    return { path, sx, sy, tx, ty, labelX: (sx + tx) / 2, labelY: (sy + ty) / 2 };
  }

  // 중심선 수직 단위벡터(CCW 90°) — slot 부호에 따라 양/음 방향으로 분산.
  // 기준선은 "회전된 타겟 endpoint" 까지의 선분으로 잡아 endpoint 분산과 곡선이 자연스레 맞물린다.
  const bdx = tx - sx;
  const bdy = ty - sy;
  const segDist = Math.sqrt(bdx * bdx + bdy * bdy) || 1;
  const px = -bdy / segDist;
  const py = bdx / segDist;

  // 슬롯당 변위(레벨당 step) — 선 길이에 비례하되 상한 제한. |slot|=k 면 k·step 만큼 휨.
  const stepPx = Math.min(segDist * 0.2, 50);
  const magnitude = slot * stepPx;

  const mx = (sx + tx) / 2;
  const my = (sy + ty) / 2;
  const cx = mx + px * magnitude;
  const cy = my + py * magnitude;
  const path = `M ${sx},${sy} Q ${cx},${cy} ${tx},${ty}`;
  // 2차 베지어 t=0.5 지점: 0.25*P0 + 0.5*P1 + 0.25*P2
  const labelX = 0.25 * sx + 0.5 * cx + 0.25 * tx;
  const labelY = 0.25 * sy + 0.5 * cy + 0.25 * ty;
  return { path, sx, sy, tx, ty, labelX, labelY };
}

export function readRadiusFromData(data: unknown, key: 'sourceRadius' | 'targetRadius'): number {
  const rec = data as Record<string, unknown> | undefined;
  const v = rec?.[key];
  return typeof v === 'number' ? v : TASK_EDGE_DEFAULT_RADIUS;
}
