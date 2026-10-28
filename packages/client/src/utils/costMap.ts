import type { CostAgentTotal, CostTone, ProjectCostMap } from '@vibisual/shared';
import { costTone } from '@vibisual/shared';

// SCENARIO.md §5.21 — 비용·토큰 지도 공용 헬퍼.
// 비용 줄(Panel/CostPill)과 비용 팝업(Panel/CostMapPopup)이 같은 함수로 색을 정한다 — 같은 금액이 두 화면에서 다른 색이면 신뢰를 잃는다.
// 컴포넌트끼리 import 하면 순환이 생겨 여기 한 곳에 둔다.
// `findAgentCost` / `costBadgeToneClass` 는 철회된 버블 배지(§7.19)만 쓰던 조회·색 통로지만 남긴다 — 지우면 되살릴 때 임계가 화면마다 갈린다.
// 금액을 다시 계산하지 않는다 — 합계·기간 접기는 서버 몫이고(§3.1) 여기는 접힌 값의 색만 정한다.

/** 지금 보고 있는 프로젝트의 지도. 없으면 undefined(빈 지도를 지어내지 않는다). */
export function findCostMap(maps: readonly ProjectCostMap[], projectName: string | null): ProjectCostMap | undefined {
  if (!projectName) return undefined;
  return maps.find((m) => m.projectName === projectName);
}

/** 그 에이전트의 누적. 측정된 적이 없으면 undefined — 0 이 아니다. (버블 배지 철회 후 현재 호출부 없음.) */
export function findAgentCost(
  maps: readonly ProjectCostMap[],
  projectName: string | null,
  agentId: string,
): CostAgentTotal | undefined {
  const map = findCostMap(maps, projectName);
  const found = map?.agents.find((a) => a.agentId === agentId);
  return found?.measured ? found : undefined;
}

/** 텍스트 색. `none`(미측정)은 회색 — 초록으로 그리면 "싸게 했다"는 거짓 신호가 된다. */
export function costTextToneClass(tone: CostTone): string {
  switch (tone) {
    case 'danger': return 'text-red-400';
    case 'warn': return 'text-amber-400';
    case 'normal': return 'text-emerald-400';
    default: return 'text-gray-500';
  }
}

/** 배지 테두리·바탕. 임계 판정은 shared `costTone` 단일 출처. (버블 배지 철회 후 현재 호출부 없음.) */
export function costBadgeToneClass(tone: CostTone): string {
  switch (tone) {
    case 'danger': return 'border-red-500/50 bg-red-500/15 text-red-300';
    case 'warn': return 'border-amber-500/50 bg-amber-500/15 text-amber-300';
    case 'normal': return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
    default: return 'border-gray-600/40 bg-gray-700/20 text-gray-400';
  }
}

/** 금액 → 색조(측정 여부까지 반영). 컴포넌트가 임계를 다시 적지 않게 하는 얇은 통로. */
export function toneOf(costUsd: number | undefined, measured = true): CostTone {
  return costTone(costUsd, measured);
}
