// §9 — graph_snapshot 키맵 슬라이스 증분(서버·클라 공용). 스냅샷은 16~250ms 마다 통째로 가는데 `fileEdits`·`bashHistory` 원문이
// 쓸수록 쌓인다(실측 3.2MB 중 2.5MB). 보내는 쪽은 바뀐 키만(`diffKeyedSlice`), 받는 쪽은 이전 맵 위에 얹어(`applyKeyedSliceDelta`) 복원한다.
// 비교는 참조 비교(틀리지 않고 더 보낼 뿐). 받는 쪽은 증분을 하나도 버리면 안 된다(누적이다). 첫 연결은 전체 스냅샷부터.

import type { KeyedSliceDelta } from './types.js';

/** 이전 전체 맵 대비 바뀐 키만 추린다. `null` = 전체를 보내라(기준점 없음 · 절반 넘게 바뀜 — 증분이 이득이 없다). */
export function diffKeyedSlice<T>(
  prev: Record<string, T> | null,
  next: Record<string, T>,
): KeyedSliceDelta<T> | null {
  if (prev === null) return null;

  const changed: Record<string, T> = {};
  let changedCount = 0;
  for (const key of Object.keys(next)) {
    const value = next[key] as T;
    if (prev[key] !== value) {
      changed[key] = value;
      changedCount++;
    }
  }

  const removed: string[] = [];
  for (const key of Object.keys(prev)) {
    if (!(key in next)) removed.push(key);
  }

  const total = Object.keys(next).length;
  if (total > 0 && changedCount > total / 2) return null;

  return { changed, removed };
}

/** 이전 전체 맵 + 증분 → 새 전체 맵. 변화가 없으면 이전 참조를 그대로 돌려준다(구독자를 깨우지 않게). */
export function applyKeyedSliceDelta<T>(
  prev: Record<string, T>,
  delta: KeyedSliceDelta<T>,
): Record<string, T> {
  const changedKeys = Object.keys(delta.changed);
  if (changedKeys.length === 0 && delta.removed.length === 0) return prev;

  const next: Record<string, T> = { ...prev };
  for (const key of delta.removed) delete next[key];
  for (const key of changedKeys) next[key] = delta.changed[key] as T;
  return next;
}

/**
 * §9 — 델타로 보내는 키맵 슬라이스 목록. 서버(`broadcastBus`)·클라(`useWebSocket`)가 이 한 벌을 본다
 * (서버에만 늘리면 영영 안 오고, 클라에만 늘리면 전량 전송이 남는다).
 * ⚠ 참조를 유지하는 슬라이스만 넣어라 — 매번 새로 만들면 "전부 바뀜"이라 사본만 더 든다
 * (참조를 지키는 곳: `ProjectGraph.stableCopy`·`sessionGoalViewCache` — 실측 2026-09-02, 그 전엔 941KB 의 유지율 0%).
 */
export const DELTA_SLICE_KEYS = [
  'fileEdits',
  'bashHistory',
  'agentReports',
  'agentMemos',
  'agentQuestions',
  'agentReviews',
  'agentLists',
  'sessionGoals',
  // §5.5 #17-17 ⑪ — 시각 종류 카드. 카드 하나가 통째로 교체되는 자리(`visualKinds.set(k, next)`)라
  //   목표와 같은 모양이고, `memoSlice` 가 순회 결과의 참조를 지키므로 정지 상태에서는 통째로 빠진다.
  'visualKinds',
  'agentFeedbacks',
  'brainInjections',
  // 아래 둘은 `GraphSnapshot` 에서 **필수** 필드라 `GraphSnapshotWire` 가 따로 optional 로 연다.
  // `nodeProjects` 는 키가 노드 수만큼(실측 2,476개) 늘지만 값이 짧은 문자열이라 비교가 싸고,
  // 노드가 새로 뜨거나 사라질 때만 바뀌므로 정지 상태에서는 통째로 빠진다.
  'agentEvents',
  'nodeProjects',
  // §5.11 정독 게이트 — 세션 하나가 절 목록·열람 구간·게이트 이력을 들어 슬라이스 중 무거운 축이다.
  //   `getSpecReadingStates` 가 원장 판 번호로 메모해 **안 바뀐 세션은 같은 객체를 그대로** 돌려주므로
  //   정지 상태에서는 통째로 빠진다(참조를 못 지키면 여기 넣으면 안 된다 — 위 경고 참고).
  'specReading',
  // §5.3 #10-5 `configTrim` · #10-4 `orchestra` — 프로젝트당 설정 + 최근 기록·런이라 작지 않다. `getConfigTrimSummary`·`getOrchestraSummary`
  //   가 참조로 메모해 정지 상태에서는 통째로 빠진다. 설정·기록은 바뀔 때마다 새 객체로 갈아 끼운다(제자리 수정 ❌).
  'configTrim',
  //   정지 상태에서는 통째로 빠진다. 설정·런은 바뀔 때마다 새 객체로 갈아 끼워진다(제자리 수정 ❌).
  'orchestra',
] as const;

/** `DELTA_SLICE_KEYS` 의 한 항목. */
export type DeltaSliceKey = typeof DELTA_SLICE_KEYS[number];
