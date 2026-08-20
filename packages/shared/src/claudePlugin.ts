/**
 * claudePlugin.ts — §5.5 #17-33: "이 플러그인이 지금 이 세션에 오는가" 를 정하는 순수 함수들.
 *
 * `claude plugin list --json` 은 **이 컴퓨터에 깔린 전부**를 돌려준다 — 다른 프로젝트에 매인 것까지
 * 섞여 있다(실측 7개 중 5개가 남의 프로젝트 것이었다). 그래서 목록을 그대로 그리면 "왜 안 먹지"
 * 가 되고, 걸러 버리면 "깔았는데 왜 없지" 가 된다. 그 판정을 한 곳에 두고 테스트로 고정한다.
 *
 * 서버와 화면이 같은 규칙을 써야 배지 수와 목록이 어긋나지 않으므로 shared 에 산다.
 */
import type { ClaudePluginPlacement, ClaudePluginScope } from './types.js';

/**
 * 경로 비교용 정규화 — 대소문자·구분자·끝 구분자를 지운다.
 *
 * 실측상 같은 폴더가 `c:\Users\…`(소문자 드라이브)와 `C:\Users\…` 로 함께 들어 있다.
 * 한쪽만 보면 이 프로젝트 것이 남의 것으로 밀려나 화면에서 사라진다.
 */
export function normalizePluginPath(p: string): string {
  return p.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** `<이름>@<마켓플레이스>` 를 가른다. `@` 가 없으면 마켓은 빈 문자열(이름만 있는 것도 유효하다). */
export function splitPluginId(id: string): { name: string; marketplace: string } {
  const at = id.lastIndexOf('@');
  if (at <= 0) return { name: id, marketplace: '' };
  return { name: id.slice(0, at), marketplace: id.slice(at + 1) };
}

/**
 * 이 플러그인이 어느 묶음에 서는가 — 사용자가 물은 "글로벌 / 우리 프로젝트 전용" 이 이 판정이다.
 *
 * @param scope       CLI 가 돌려준 설치 범위
 * @param entryPath   그 플러그인이 매여 있는 프로젝트 경로(`user` 범위면 없다)
 * @param projectPath 지금 이 세션이 열린 프로젝트 경로
 */
export function resolvePluginPlacement(
  scope: ClaudePluginScope,
  entryPath: string | undefined,
  projectPath: string,
): ClaudePluginPlacement {
  if (scope === 'user') return 'global';
  // 프로젝트 범위인데 경로가 안 적혀 있으면, CLI 를 이 프로젝트에서 물었으므로 이곳 것으로 본다.
  if (!entryPath) return 'this-project';
  return normalizePluginPath(entryPath) === normalizePluginPath(projectPath)
    ? 'this-project'
    : 'other-project';
}

/** 이 세션에 실제로 실리는 자리인가(= 배지가 세는 대상). */
export function placementAppliesHere(placement: ClaudePluginPlacement): boolean {
  return placement !== 'other-project';
}
