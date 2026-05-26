import type { Node } from '@xyflow/react';

/**
 * Task Edge 분산 오프셋 — 실제 엣지 렌더와 popup preview 가 동일한 식으로 휘도록
 * 공유하는 순수 유틸.
 *
 * 레이아웃 규칙 (Multi-Edge Fan-Out):
 *   - 같은 쌍에서 출발하는 모든 엣지는 각 노드의 "상대 방향" 한 점에서 시작 (source 고정).
 *   - target endpoint 는 slot 번호에 비례해 상대 버블 둘레의 위/아래로 벌어진다.
 *   - N == 1: 중앙 직선. N >= 2: 중앙 비우고 위/아래 쌍으로 부풀린다.
 *   - 방향(A→B / B→A)은 slot 배치에 영향을 주지 않는다 (canonical 프레임 공유).
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
 * 타겟 엔드포인트 각도 분산 (edgeId → radians).
 *
 * `slot × 레벨당 각도` 만 사용 — cluster 보정 없음. 이유:
 *   - 2-에이전트 쌍 케이스에서 cluster 정렬이 양방향 엣지를 alphabetic tiebreak 로
 *     섞어 target_group 위치를 한쪽으로 쏠리게 만들어 대칭 fan-out 이 깨지는 버그를
 *     일으켰다. 스펙("direction 은 slot 에 영향 없음 + 위/아래 대칭")을 지키려면
 *     순수 slot-기반 분산이 정답.
 *   - 3+ 에이전트(여러 소스에서 한 타겟) 케이스는 "소스들이 지리적으로 서로 다른 각도
 *     에 배치" 된다는 가정으로 자연 분산된다. 예외 케이스(소스들이 한 방향에 몰림)는
 *     추후 별도 재배치 로직으로 다룬다.
 *
 * 부호 규약:
 *   path 의 perp 벡터 규약상 slot(+) 은 control point 를 perp(+) 로, endpoint 각도는
 *   `baseAngle + angOff` 로 적용한다. 두 방향이 같은 쪽이 되도록 `angular = -slot × K`.
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
 * 같은 두 노드 사이 N 개 엣지에 **슬롯 번호**를 할당 (방향 A→B / B→A 무관).
 *
 * 슬롯 번호 공식 (i = 생성 순서 기반 인덱스, 0-based):
 *   N == 1: slot = 0          // 중앙 직선 (유일한 직선 허용)
 *   N >= 2: level(i) = floor(i/2) + 1
 *           side(i)  = +1 (짝수) / -1 (홀수)
 *           slot(i)  = side × level
 *
 * 결과: 0→+1, 1→-1, 2→+2, 3→-2, 4→+3, 5→-3, ... (중앙 비움, 위/아래 쌍으로 바깥 확장)
 *
 * 역방향 엣지(B→A, A<B)는 path 계산 시 자기 방향 기준 perp 벡터가 canonical 과 뒤집혀 있어
 * 그대로 렌더하면 side 가 거꾸로 된다. 이를 보정하기 위해 저장 시점에 slot 부호 반전 →
 * 렌더 단계에서 동일한 canonical 위/아래 슬롯을 유지.
 *
 * 곡률은 path 단계에서 |slot| × CURVATURE_STEP 으로 계산 → 바깥 슬롯일수록 더 휘고,
 * 엣지가 추가돼도 기존 엣지의 곡률은 변하지 않는다 (새 엣지만 더 바깥 슬롯으로 추가).
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
