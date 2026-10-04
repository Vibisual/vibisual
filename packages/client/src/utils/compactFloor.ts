/**
 * §4 (CLI 사양 추종) (5) 창 하한 — 화면이 **턴 경계 판정과 같은 근거로** 명령 사이 압축의 창을 적기 위한
 * 시작 문맥 고르기.
 *
 * 보고 있는 세션의 값이 먼저다 — 서버 턴 경계 판정(index.ts `readTurnEndContext`)이 보는 그 세션의 첫 응답
 * 문맥이고, 화면은 스냅샷이 실어 준 `SubAgent.contextFloor`(projectGraph 가 같은 `readContextInfo` 로 싣는 값)로
 * 읽는다. 그 세션에 아직 응답이 없으면 같은 에이전트의 가장 최근 세션 `COMPACT_FLOOR_SIBLING_SCAN` 개 중 처음
 * 값을 빌려 **미리** 적는다 — 판정은 턴이 끝난 뒤라 언제나 그 세션 자신의 값을 보므로, 빌린 값은 예고다.
 *
 * 고르는 규칙만 여기 한 곳에 두고, 창 계산 자체는 shared `applyAutoCompactFloor` 를 그대로 부른다.
 * 2026-10-05 부터 이 창은 스폰에 실리지 않는다 — 작업 도중에는 CLI 가 모델 창 끝에서만 접는다.
 */

import { COMPACT_FLOOR_SIBLING_SCAN, type SubAgent } from '@vibisual/shared';

export interface CompactFloorSource {
  /** 시작 문맥(첫 응답의 문맥 크기, 토큰). */
  floor: number;
  /** 그 세션 모델의 창 크기. 모르면 `null` — 하한이 모델 창을 넘겨 올리지 않게 하는 상한이다. */
  contextMax: number | null;
}

type FloorFields = Pick<SubAgent, 'id' | 'lastActivityAt' | 'contextFloor' | 'contextMax'>;

function sourceOf(sub: FloorFields | undefined): CompactFloorSource | null {
  if (!sub || typeof sub.contextFloor !== 'number' || !(sub.contextFloor > 0)) return null;
  const max = typeof sub.contextMax === 'number' && sub.contextMax > 0 ? sub.contextMax : null;
  return { floor: sub.contextFloor, contextMax: max };
}

/**
 * 이 에이전트의 압축 창 하한을 정할 시작 문맥. `subId` 를 주면 그 세션이 먼저다.
 * 근거가 없으면 `null` — 그때 화면은 고른 값을 그대로 적는다(서버 판정도 근거가 없으면 하한을 걸지 않는다).
 */
export function pickCompactFloorSource(
  subs: readonly FloorFields[] | undefined,
  subId?: string | null,
): CompactFloorSource | null {
  if (!subs || subs.length === 0) return null;
  if (subId) {
    const own = sourceOf(subs.find((s) => s.id === subId));
    if (own) return own;
  }
  const siblings = subs
    .filter((s) => s.id !== subId)
    .slice()
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    .slice(0, COMPACT_FLOOR_SIBLING_SCAN);
  for (const s of siblings) {
    const src = sourceOf(s);
    if (src) return src;
  }
  return null;
}
