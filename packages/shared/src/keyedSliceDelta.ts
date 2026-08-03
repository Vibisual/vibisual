// §9 v3.89 — graph_snapshot 키맵 슬라이스 증분(diff/apply) — 서버·클라 공용 SSOT.
//
// 왜 있나: `graph_snapshot` 은 전체 그래프를 16~250ms 마다 통째로 실어 보낸다. 그 중
// `fileEdits`(편집마다 diff 원문)·`bashHistory`(명령 + 출력 원문)는 **작업할수록 계속 쌓이는 큰
// 텍스트**라, 실측 저장소에서 스냅샷 3.2MB 중 2.5MB(78%)를 차지했다. 안 바뀐 파일의 diff 원문이
// 초당 수 회 직렬화·클론·파싱되니 "쓸수록 느려진다".
//
// 무엇을 하나: 보내는 쪽이 **바뀐 키만** 추리고(`diffKeyedSlice`), 받는 쪽이 이전 전체 맵 위에
// 얹어(`applyKeyedSliceDelta`) 같은 전체 맵을 복원한다. 표시되는 데이터와 시점은 그대로다.
//
// 설계 규칙(둘 다 지켜야 정합성이 선다):
//  · 비교는 **참조 비교**. 내용이 같아도 참조가 다르면 한 번 더 보낼 뿐 — 값이 틀리는 방향의
//    오차는 생기지 않는다(보수적).
//  · 받는 쪽은 증분을 **도착할 때마다** 반영해야 한다. 증분은 누적이라 중간 메시지를 버리면
//    그 변경분이 영영 사라진다.
//  · 첫 연결에는 항상 전체 스냅샷을 먼저 보낸다(증분은 그 뒤부터).

import type { KeyedSliceDelta } from './types.js';

/**
 * 이전 전체 맵 대비 바뀐 키만 추린다.
 *
 * @returns 증분. 아래 두 경우는 `null`(= 전체를 그대로 보내라):
 *   · 기준점이 없다(첫 전송/리셋 직후).
 *   · 절반 넘게 바뀌었다 — 증분이 이득이 없고 기준점만 복잡해진다.
 */
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

/**
 * 이전 전체 맵 + 증분 → 새 전체 맵.
 * 변화가 없으면 **이전 참조를 그대로** 돌려준다(불필요한 구독자 깨우기 방지).
 */
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
