import { resolveOnboardingStep } from '@vibisual/shared';
import type { ClaudeAuthStatus, ClaudeSetupState } from '@vibisual/shared';

/**
 * §4 (첫 실행 온보딩) ③ — **프로젝트 폴더 게이트의 판정만** 모아 둔 곳.
 *
 * `setupGateFlow.ts` 와 같은 이유로 화면에서 떼어 냈다: 게이트의 발화 조건은 `useEffect` 의
 * 의존성에 얽히기 쉬운데, 그렇게 얽힌 판정은 렌더 없이 검사할 수 없어 회귀를 두 번 잡게 된다.
 * 순서(①설치 → ②로그인 → ③폴더) 자체는 shared 의 `resolveOnboardingStep` 한 곳이 들고 있고,
 * 여기서는 그 답을 이 화면의 사정(사용자가 닫았는가 · 직접 열었는가)과 합칠 뿐이다.
 */

/** 클라 스토어에서 "폴더를 골랐는가" 를 읽는 데 필요한 칸만. */
export interface ProjectPresenceInput {
  /** 스냅샷이 실어 준 프로젝트(서버가 이미 숨김·워크트리를 걸러 낸 목록). */
  projects: Record<string, unknown>;
  /** §9 유휴 해제로 내려간 프로젝트 — 탭은 그대로 있으므로 **있는 것으로 센다**. */
  stubProjects: Record<string, unknown>;
}

/**
 * 사용자가 연 프로젝트 폴더가 하나라도 있는가.
 *
 * stub 을 함께 세는 이유: 오래 안 본 프로젝트는 내려가지만 탭은 남아 있다. 그걸 "없음"으로
 * 세면 앱을 오래 켜 둔 사람에게 폴더 선택 모달이 난데없이 떠서, 이미 고른 폴더를 다시 고르라는
 * 화면이 된다.
 */
export function hasProjectFolder(state: ProjectPresenceInput): boolean {
  return Object.keys(state.projects).length > 0 || Object.keys(state.stubProjects).length > 0;
}

/** 지금 폴더 게이트가 화면에 있어야 하는가. */
export function isProjectFolderGateOpen(input: {
  setup: ClaudeSetupState | null;
  auth: ClaudeAuthStatus | null;
  hasFolder: boolean;
  /** 사용자가 직접 열었다(배너 클릭 · 생성 시도가 막혔다) — 닫아 뒀어도 다시 연다. */
  forced: boolean;
  /** [나중에] 로 닫았다 — 자동으로는 다시 뜨지 않는다(배너는 남는다). */
  dismissed: boolean;
}): boolean {
  const { setup, auth, hasFolder, forced, dismissed } = input;
  // 폴더가 생긴 순간은 어떤 경로로 열렸든 닫힌다 — 목적을 이룬 모달이 남아 있으면 안 된다.
  if (hasFolder) return false;
  if (forced) return true;
  if (dismissed) return false;
  return resolveOnboardingStep({
    setupPhase: setup?.phase ?? null,
    auth: auth ? { loggedIn: auth.loggedIn, error: auth.error } : null,
    hasProjectFolder: hasFolder,
  }) === 'project-folder';
}

/**
 * 상단 배너가 남아야 하는가 — 권장형 게이트의 나머지 절반.
 *
 * 모달을 [나중에] 로 닫아도 "아직 폴더를 안 골랐다"는 사실은 계속 보여야 한다. 앱을 둘러보는
 * 것은 막지 않되, 에이전트를 만들려는 순간 왜 막히는지 그 자리에서 읽히게 하기 위함이다.
 */
export function isProjectFolderBannerOpen(input: {
  setup: ClaudeSetupState | null;
  auth: ClaudeAuthStatus | null;
  hasFolder: boolean;
  forced: boolean;
  dismissed: boolean;
}): boolean {
  const { setup, auth, hasFolder, forced, dismissed } = input;
  if (hasFolder || forced || !dismissed) return false;
  return resolveOnboardingStep({
    setupPhase: setup?.phase ?? null,
    auth: auth ? { loggedIn: auth.loggedIn, error: auth.error } : null,
    hasProjectFolder: hasFolder,
  }) === 'project-folder';
}

/**
 * 로그인 창이 닫히는 순간 **폴더 선택 창을 불러야 하는가**.
 *
 * `shouldSummonLogin`(설치 → 로그인 인계)의 뒷짝이다. 자동 판정에만 맡기면 이 인계가 끊기는
 * 자리가 있다: 로그인을 마친 직후의 `claudeSetup` 은 아직 옛 스냅샷일 수 있어 순서 판정이
 * `'pending'` 으로 떨어지고, 그러면 온보딩이 로그인에서 끝난 것처럼 보인다. 마지막 칸을
 * 넘기는 이 자리에서만은 앞칸의 판정을 다시 묻지 않고 **폴더 유무 하나로** 정한다 —
 * 폴더 선택 창에도 [나중에] 가 있어 잘못 떠도 사용자를 가두지 않는다.
 */
export function shouldSummonProjectFolder(input: { hasFolder: boolean }): boolean {
  return !input.hasFolder;
}
