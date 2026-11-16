/**
 * §5.1 #3-5 — 최근 사용 링의 판정. 서버(순위 싣기)·설정 창(칸 범위)·캔버스(링 크기)가 같은 답을 내야 해 한 곳에 둔다.
 */
import type { BubbleData, RecentUseMark } from './types.js';
import { RECENT_USE_RING } from './constants.js';

/** 링 개수 — 숫자가 아니면 기본값, 범위 밖은 접는다. 0 은 끔이라 유효하다. */
export function normalizeRecentUseRingCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return RECENT_USE_RING.defaultCount;
  return Math.min(RECENT_USE_RING.countMax, Math.max(RECENT_USE_RING.countMin, Math.floor(value)));
}

/** 링을 두르는 버블 — 에이전트가 쓰는 대상(파일·폴더·도메인·명령 앱). 에이전트·워크트리 등은 종전 작업 파동 그대로다. */
export function isRecentUseBubble(node: Pick<BubbleData, 'bubbleType' | 'commandApp'>): boolean {
  return node.bubbleType === 'file'
    || node.bubbleType === 'internal_folder'
    || node.bubbleType === 'external_folder'
    || node.bubbleType === 'domain'
    || (node.bubbleType === 'bash' && !!node.commandApp);
}

/** 순위의 세기(0~1]. 가장 최근이 1, 개수의 맨 끝이 `1/limit`. 범위 밖이면 0. */
export function recentUseStrength(rank: number, limit: number): number {
  if (!Number.isFinite(rank) || !Number.isFinite(limit) || limit <= 0 || rank < 0 || rank >= limit) return 0;
  return (limit - rank) / limit;
}

/**
 * 고른 에이전트 기준 — `null` 이면 고른 에이전트가 없다(일하는 모든 에이전트 중 가장 가까운 순위),
 * `RECENT_USE_OTHER_AGENT` 면 다른 에이전트를 골랐는데 그 목록에 이 버블이 없다.
 */
export const RECENT_USE_OTHER_AGENT = '\u0000other';

/**
 * 이 버블의 링 세기. 여러 에이전트가 함께 쓴 버블은 링을 겹쳐 그리지 않고 하나만 — 가장 가까운 순위가 크기를 정한다.
 * 에이전트를 고르면 그 에이전트의 순위만 본다(그 목록에 없으면 0).
 */
export function recentUseRingStrength(marks: readonly RecentUseMark[] | undefined, focus: string | null): number {
  if (!marks || marks.length === 0 || focus === RECENT_USE_OTHER_AGENT) return 0;
  let best = 0;
  for (const mark of marks) {
    if (focus !== null && mark.agentId !== focus) continue;
    best = Math.max(best, recentUseStrength(mark.rank, mark.limit));
  }
  return best;
}

/** 세기 → 원 밖으로 번지는 거리(px)와 파동 시작 불투명도. 세기 0 은 링 없음. */
export function recentUseRingLook(strength: number): { reachPx: number; alpha: number } {
  if (!(strength > 0)) return { reachPx: 0, alpha: 0 };
  const s = Math.min(1, strength);
  const R = RECENT_USE_RING;
  return {
    reachPx: R.reachMinPx + (R.reachMaxPx - R.reachMinPx) * Math.pow(s, R.reachCurve),
    alpha: R.alphaMin + (R.alphaMax - R.alphaMin) * s,
  };
}

/**
 * 고른 것(`selectedId`)에 대한 이 버블의 기준. 이 버블을 쓴 에이전트를 골랐으면 그 에이전트, 다른 에이전트를 골랐으면 OTHER,
 * 에이전트가 아닌 것을 골랐거나 아무것도 안 골랐으면 `null`. `isAgentId` 는 그 목록에 이 버블이 없을 때만 묻는다.
 */
export function recentUseFocus(
  selectedId: string | null | undefined,
  marks: readonly RecentUseMark[] | undefined,
  isAgentId: (id: string) => boolean,
): string | null {
  if (!selectedId || !marks || marks.length === 0) return null;
  if (marks.some((m) => m.agentId === selectedId)) return selectedId;
  return isAgentId(selectedId) ? RECENT_USE_OTHER_AGENT : null;
}
