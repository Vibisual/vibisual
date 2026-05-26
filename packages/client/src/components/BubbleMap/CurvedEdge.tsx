import { BaseEdge, useInternalNode, type EdgeProps, type InternalNode } from '@xyflow/react';

/** edge ID → 안정적인 -1.0~1.0 난수 */
function stableRandom(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return ((h % 200) - 100) / 100;
}

/**
 * 소스/타겟 중심점에서 원 둘레 교차점을 계산해서
 * 엣지가 버블 외곽선을 따라 360도 자유롭게 나가도록 하는 커스텀 엣지.
 *
 * 주의: React Flow 가 주는 sourceX/Y, targetX/Y 는 "핸들" 좌표다.
 * 핸들이 Position.Top 이라 RF 는 핸들 박스의 윗변 중점을 돌려주고,
 * 게다가 버블 크기 애니메이션 중엔 캐시된 핸들 bound 라 실제 원 중심과
 * 몇 px 어긋난다 → 끝점이 둘레를 빗나가 타원처럼 보임.
 * 그래서 핸들 대신 노드의 실측 지오메트리(measured + positionAbsolute)로
 * 진짜 원 중심·반지름을 잡는다. 실측이 없을 때만 props 로 폴백.
 */

/** 기본 반지름 추정 — 노드 크기 정보 없을 때 */
const DEFAULT_RADIUS = 45;

interface Circle { cx: number; cy: number; r: number }

/** 노드의 실측 지오메트리에서 원 중심·반지름. 실측 없으면 null → 폴백. */
function circleFromNode(node: InternalNode | undefined): Circle | null {
  if (!node) return null;
  const w = node.measured?.width;
  const h = node.measured?.height;
  if (typeof w !== 'number' || typeof h !== 'number' || w <= 0 || h <= 0) return null;
  const { x, y } = node.internals.positionAbsolute;
  // 버블 박스는 정사각형(width===height)이지만 안전하게 작은 변 기준 반지름.
  return { cx: x + w / 2, cy: y + h / 2, r: Math.min(w, h) / 2 };
}

/**
 * 타겟 끝점만 버블 외곽선에서 바깥으로 떼는 여백.
 * 버블 DOM 은 SVG 엣지 위에 그려지므로, 끝점이 외곽선에 딱 붙으면
 * 화살촉(ArrowClosed ~14px)이 버블 몸체에 가려 Read/Write 방향이 안 보인다.
 * 화살촉이 통째로 빠지는 정도면 충분 — 과하면 라인이 버블에서 동떨어져 보인다.
 * 소스 쪽은 여백 0: EdgeMask 가 자기 소스 버블은 안 가리므로 라인이 외곽선에서
 * 그대로 뻗어 나와 버블에 뿌리내린 것처럼 보인다.
 */
const ARROW_CLEARANCE = 13;
function targetEndpointGap(radius: number): number {
  return Math.min(Math.max(radius * 0.1, ARROW_CLEARANCE), 18);
}

export function CurvedEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
  markerStart,
  interactionWidth,
  data,
}: EdgeProps): React.JSX.Element {
  // 실측 지오메트리(있으면 진실). 없으면 핸들 좌표 + data 반지름으로 폴백.
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  const srcR = (data as Record<string, unknown> | undefined)?.['sourceRadius'];
  const tgtR = (data as Record<string, unknown> | undefined)?.['targetRadius'];
  const srcCircle = circleFromNode(sourceNode)
    ?? { cx: sourceX, cy: sourceY, r: typeof srcR === 'number' ? srcR : DEFAULT_RADIUS };
  const tgtCircle = circleFromNode(targetNode)
    ?? { cx: targetX, cy: targetY, r: typeof tgtR === 'number' ? tgtR : DEFAULT_RADIUS };

  const sourceCX = srcCircle.cx;
  const sourceCY = srcCircle.cy;
  const targetCX = tgtCircle.cx;
  const targetCY = tgtCircle.cy;
  const sourceRadius = srcCircle.r;
  const targetRadius = tgtCircle.r;

  // 중심 → 중심 방향 벡터 (실측 원 중심 기준)
  const dx = targetCX - sourceCX;
  const dy = targetCY - sourceCY;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / dist;
  const ny = dy / dist;

  // 타겟 여백 — 화살촉이 타겟 버블 밖에 온전히 보이게. 단 두 버블이 가까워
  // 빈 거리가 부족하면(겹침 포함) 본선이 사라지지 않게 비례 축소.
  const available = dist - sourceRadius - targetRadius;
  let targetGap = targetEndpointGap(targetRadius);
  const maxGap = Math.max(available * 0.6, 0);
  if (targetGap > maxGap) targetGap = maxGap;

  // 소스: 외곽선에서 그대로 시작 (EdgeMask 가 소스 버블은 안 가림 → 뿌리내린 듯)
  const sx = sourceCX + nx * sourceRadius;
  const sy = sourceCY + ny * sourceRadius;
  // 타겟: 외곽선에서 여백만큼 더 바깥 → 화살촉이 버블 앞 빈 공간에 떠 보임
  const tx = targetCX - nx * (targetRadius + targetGap);
  const ty = targetCY - ny * (targetRadius + targetGap);

  // 수선 벡터 (곡선용)
  const px = -ny;
  const py = nx;

  // 실제 엣지 거리
  const edgeDist = Math.sqrt((tx - sx) ** 2 + (ty - sy) ** 2) || 1;
  const curveStrength = Math.min(edgeDist * 0.15, 30);
  const offset = stableRandom(id) * curveStrength;

  // 제어점: 소스 근처에서만 곡선, 타겟 근처는 직선 (화살표 정확)
  const c1x = sx + nx * edgeDist * 0.3 + px * offset;
  const c1y = sy + ny * edgeDist * 0.3 + py * offset;
  const c2x = tx - nx * edgeDist * 0.08;
  const c2y = ty - ny * edgeDist * 0.08;

  const path = `M ${sx},${sy} C ${c1x},${c1y} ${c2x},${c2y} ${tx},${ty}`;

  return (
    <BaseEdge
      id={id}
      path={path}
      style={style}
      markerEnd={markerEnd}
      markerStart={markerStart}
      interactionWidth={interactionWidth}
    />
  );
}
