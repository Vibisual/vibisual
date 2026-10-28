import type { Node } from '@xyflow/react';

/**
 * Task Edge 분산 오프셋 — 실제 엣지 렌더와 popup preview 가 같은 식으로 휘도록 공유한다.
 * N == 1 은 중앙 직선, N >= 2 는 중앙을 비우고 위/아래 쌍으로. 방향(A→B / B→A)은 slot 에 영향 없다(canonical 프레임).
 */

export interface OffsetEdgeInput {
  id: string;
  sourceAgentId: string;
  targetAgentId: string;
}

// 같은 쌍 내 slot 레벨당 target endpoint 회전각 (rad).
// r=45 기준 asin(perp/r) 근사 → 0.32 rad 는 약 14px 수직 변위.
// 곡선이 부풀린 방향과 화살촉 도달 지점이 시각적으로 같은 쪽에 오도록 충분히 벌린다.
const ANGULAR_STEP_PER_LEVEL = 0.32;
// |slot| 이 커져도 endpoint 가 π/2 를 넘어 버블 뒤로 감겨 화살표가 뒤집히지 않게 상한.
const MAX_WITHIN_PAIR_ANGLE = 1.1;

/**
 * 타겟 끝 각도(edgeId → radians)는 `slot × 레벨당 각도` 만 — cluster 보정을 넣으면 2-에이전트 쌍에서 alphabetic tiebreak 로 대칭 fan-out 이 깨진다.
 * 부호: slot(+) 은 control point 를 perp(+) 로, 끝 각도는 `baseAngle + angOff` — 같은 쪽이 되도록 `angular = -slot × K`.
 */
export function computeAngularOffsets(
  edges: OffsetEdgeInput[],
  _flowNodes: Node[],
  parallelByEdgeId: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const te of edges) {
    const slot = parallelByEdgeId.get(te.id) ?? 0;
    const raw = -ANGULAR_STEP_PER_LEVEL * slot;
    const clamped = Math.max(-MAX_WITHIN_PAIR_ANGLE, Math.min(MAX_WITHIN_PAIR_ANGLE, raw));
    out.set(te.id, clamped);
  }
  return out;
}

/**
 * 같은 쌍 N 개 엣지의 슬롯(방향 무관, i = 생성 순서): N == 1 은 0, 아니면 0→+1, 1→-1, 2→+2 … (중앙 비움).
 * 역방향 엣지(B→A, A<B)는 perp 가 canonical 과 뒤집혀 저장 때 부호를 반전한다. 엣지가 늘어도 기존 곡률(|slot| × CURVATURE_STEP)은 그대로.
 */
export function computeParallelOffsets(edges: OffsetEdgeInput[]): Map<string, number> {
  const out = new Map<string, number>();
  const pairGroups = new Map<string, OffsetEdgeInput[]>();
  for (const te of edges) {
    const a = te.sourceAgentId;
    const b = te.targetAgentId;
    const key = a < b ? `${a}__${b}` : `${b}__${a}`;
    const arr = pairGroups.get(key) ?? [];
    arr.push(te);
    pairGroups.set(key, arr);
  }
  for (const arr of pairGroups.values()) {
    // 생성 순서 — id 사전순 (timestamp / 증가 id 가정). 방향은 무시.
    arr.sort((teA, teB) => teA.id.localeCompare(teB.id));
    const n = arr.length;
    if (n === 1) {
      out.set(arr[0]!.id, 0);
      continue;
    }
    for (let i = 0; i < n; i++) {
      const level = Math.floor(i / 2) + 1;
      const side = i % 2 === 0 ? 1 : -1;
      const slot = side * level; // canonical frame slot
      const isReverse = arr[i]!.sourceAgentId > arr[i]!.targetAgentId;
      out.set(arr[i]!.id, isReverse ? -slot : slot);
    }
  }
  return out;
}
