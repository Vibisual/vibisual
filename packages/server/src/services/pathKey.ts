/**
 * 서버용 경로 케이스 헬퍼 — shared 의 정책(`pathCase.ts`)에 `process.platform` 을 물려 감싼다.
 *
 * 서버 코드는 경로를 Map 키·비교 키로 쓸 때 **직접 `.toLowerCase()` 하지 말고 여기를 쓴다.**
 * 무조건 소문자로 접으면 Linux 에서 케이스만 다른 두 경로가 한 키로 뭉개져
 * 프로젝트 그래프·탭 목록·두뇌/플러그인 설정이 조용히 섞인다.
 */
import type { PlatformName } from '@vibisual/shared';
import {
  isCaseInsensitiveFs,
  isPathWithin as sharedIsPathWithin,
  legacyLowerPathKey,
  normalizePathShape,
  pathKey as sharedPathKey,
} from '@vibisual/shared';

/** 이 서버가 도는 파일시스템이 대소문자를 가리지 않는가. */
export const CASE_INSENSITIVE_FS = isCaseInsensitiveFs(process.platform);

/**
 * 이 서버가 도는 플랫폼 — shared 순수 함수에 **인자로 넘기는** 값.
 *
 * `process.platform` 을 함수 안에서 직접 읽으면 그 분기는 개발기 한 대에서 영영 검증되지 않는다.
 * 읽는 자리를 여기 하나로 모아 두고, 판정 함수에는 항상 인자로 실어 보낸다.
 */
export const HOST_PLATFORM: PlatformName = process.platform;

/** 경로 비교·Map 키. 대소문자는 그 플랫폼이 실제로 무시할 때만 접는다. */
export function pathKey(p: string): string {
  return sharedPathKey(p, process.platform);
}

/** 케이스를 건드리지 않는 모양 정규화(표시·저장 포맷용). */
export { normalizePathShape };

/**
 * 예전 방식(무조건 소문자) 키 — **읽기 폴백 전용**.
 * 이미 디스크에 저장된 mac/linux 사용자의 맵은 소문자 키로 적혀 있다.
 */
export { legacyLowerPathKey };

/**
 * 영속 맵을 읽을 때 쓰는 조회 — 새 키로 먼저 찾고, 없으면 예전 소문자 키로 한 번 더.
 * 업그레이드한 mac/linux 사용자가 열린 탭·두뇌 설정을 잃지 않게 한다.
 */
export function readByPath<T>(store: Record<string, T> | Map<string, T>, p: string): T | undefined {
  const read = (k: string): T | undefined =>
    store instanceof Map ? store.get(k) : store[k];
  const hit = read(pathKey(p));
  if (hit !== undefined) return hit;
  if (CASE_INSENSITIVE_FS) return undefined; // win/mac 은 새 키가 곧 예전 키라 폴백이 무의미
  return read(legacyLowerPathKey(p));
}

/** 두 경로가 같은 대상을 가리키는가. */
export function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

/**
 * 경로 탈출 방어 — `child` 가 `root` 안(또는 root 자신)인가.
 *
 * REST 경로 검증·워크스페이스 탐색기·내장 편집창이 각자 `win32 ? toLowerCase : 그대로` 를 적고
 * 있던 것을 이 한 곳으로 모았다. mac 은 대소문자를 무시하는 파일시스템이라 접지 않으면 정상 요청이
 * 사유 없이 거부되고, linux 는 접으면 케이스만 다른 남의 폴더가 통과한다 — 판정은 `pathKey` 규칙 하나로.
 *
 * 세 OS 판정 자체의 단위 테스트는 shared 의 순수 함수(`isPathWithin`)에 붙는다.
 */
export function isWithinRoot(child: string, root: string): boolean {
  return sharedIsPathWithin(child, root, process.platform);
}
