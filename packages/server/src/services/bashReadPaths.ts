/**
 * §2.1 #3 · §5.1 #1-1 — 셸로 읽은 파일도 버블로 뜨게 하기 위한 경로 추출기의 **서버 입구**.
 *
 * 판정의 정본은 shared `bashReadPaths.ts` 다 — IDE 세션 버블 지도(§5.5 #17-50)가 캔버스와 **같은 판정**으로
 * "셸로 읽은 파일"을 그려야 해서 옮겼다(두 벌이 되면 한쪽만 고쳐진다 — §2.1 #3).
 * 이 파일은 실행 호스트의 플랫폼(`HOST_PLATFORM`)을 실어 그 함수를 부를 뿐이라, 서버 호출부·시험은 종전 이름 그대로다.
 * **판정을 고칠 때는 shared 쪽을 고친다** — 여기에 규칙을 다시 적으면 그 순간 두 벌이 된다.
 */
import {
  BASH_READ_PATH_LIMIT,
  extractBashReadTargets as extractSharedBashReadTargets,
  type BashReadTarget,
  type ShellDialect,
} from '@vibisual/shared';
// 플랫폼을 읽는 자리는 한 곳이다 — 판정 함수에는 인자로 실어 보낸다(멀티플랫폼 규약).
import { HOST_PLATFORM } from './pathKey.js';

export { BASH_READ_PATH_LIMIT };
export type { BashReadTarget };

/**
 * 셸 명령 문자열에서 **읽은 파일/폴더 대상**을 뽑는다(§2.1 #3 · §5.1 #1-1) — 실행 호스트의 플랫폼으로.
 *
 * @param opts.windowsDrivePaths git bash 의 `/c/...` 를 `c:/...` 로 바꾼다. 생략하면 실행 호스트가 win32 일 때만.
 * @param opts.dialect 명령 글의 말씨 — PowerShell 도구면 `'powershell'`.
 */
export function extractBashReadTargets(
  command: string,
  limit: number = BASH_READ_PATH_LIMIT,
  opts?: { windowsDrivePaths?: boolean; dialect?: ShellDialect },
): BashReadTarget[] {
  return extractSharedBashReadTargets(command, limit, { platform: HOST_PLATFORM, ...opts });
}

/**
 * 셸 명령 문자열에서 **읽은 파일/폴더 경로**를 뽑는다 — `extractBashReadTargets` 의 경로만.
 *
 * @returns 중복 제거된 경로 목록. `cd` 로 base 가 잡혔으면 상대 경로에 그 base 를 붙여 돌려준다.
 */
export function extractBashReadPaths(
  command: string,
  limit: number = BASH_READ_PATH_LIMIT,
  opts?: { windowsDrivePaths?: boolean; dialect?: ShellDialect },
): string[] {
  return extractBashReadTargets(command, limit, opts).map((t) => t.path);
}
