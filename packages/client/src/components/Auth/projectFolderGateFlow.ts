import { resolveOnboardingStep } from '@vibisual/shared';
import type { ClaudeAuthStatus, ClaudeSetupState, CodexAuthStatus, CodexSetupState, EngineChoice, OnboardingStep } from '@vibisual/shared';

/**
 * §4 (첫 실행 온보딩) ③ — 프로젝트 폴더 게이트의 판정만(렌더 없이 시험하려고 화면에서 뗐다).
 * 순서(설치 → 로그인 → 폴더)는 shared `resolveOnboardingStep` 이 갖고, 여기는 닫았는가·직접 열었는가만 합친다.
 */

/** 클라 스토어에서 "폴더를 골랐는가" 를 읽는 데 필요한 칸만. */
export interface ProjectPresenceInput {
  /** 스냅샷이 실어 준 프로젝트(서버가 이미 숨김·워크트리를 걸러 낸 목록). */
  projects: Record<string, unknown>;
  /** §9 유휴 해제로 내려간 프로젝트 — 탭은 그대로 있으므로 **있는 것으로 센다**. */
  stubProjects: Record<string, unknown>;
}

/** 연 프로젝트 폴더가 있는가. stub 도 센다 — 오래 안 본 프로젝트는 내려가도 탭은 남아, 빼면 고른 폴더를 다시 고르라는 모달이 뜬다. */
export function hasProjectFolder(state: ProjectPresenceInput): boolean {
  return Object.keys(state.projects).length > 0 || Object.keys(state.stubProjects).length > 0;
}

interface ProjectFolderGateInput {
  setup: ClaudeSetupState | null;
  auth: ClaudeAuthStatus | null;
  engineChoice?: EngineChoice;
  codexSetup?: CodexSetupState | null;
  codexAuth?: CodexAuthStatus | null;
  hasFolder: boolean;
  /** 사용자가 직접 열었다(배너 클릭 · 생성 시도가 막혔다) — 닫아 뒀어도 다시 연다. */
  forced: boolean;
  /** [나중에] 로 닫았다 — 자동으로는 다시 뜨지 않는다(배너는 남는다). */
  dismissed: boolean;
}

/** 복귀한 사용자도 고른 엔진의 마지막 단계로 이어진다. Claude 설치는 Codex의 선행 조건이 아니다. */
function projectOnboardingStep(input: ProjectFolderGateInput): OnboardingStep {
  const engine = input.engineChoice?.kind ?? 'claude';
  if (engine === 'local') return input.hasFolder ? 'ready' : 'project-folder';
  const setup = engine === 'codex' ? input.codexSetup : input.setup;
  const auth = engine === 'codex' ? input.codexAuth : input.auth;
  return resolveOnboardingStep({
    setupPhase: setup?.phase ?? null,
    auth: auth ? { loggedIn: auth.loggedIn, error: auth.error } : null,
    hasProjectFolder: input.hasFolder,
  });
}

/** 지금 폴더 게이트가 화면에 있어야 하는가. */
export function isProjectFolderGateOpen(input: ProjectFolderGateInput): boolean {
  const { hasFolder, forced, dismissed } = input;
  // 폴더가 생긴 순간은 어떤 경로로 열렸든 닫힌다 — 목적을 이룬 모달이 남아 있으면 안 된다.
  if (hasFolder) return false;
  if (forced) return true;
  if (dismissed) return false;
  return projectOnboardingStep(input) === 'project-folder';
}

/** 상단 배너가 남아야 하는가 — 모달을 [나중에] 로 닫아도 폴더 미선택은 계속 보인다(에이전트를 만들 때 왜 막히는지 읽히게). */
export function isProjectFolderBannerOpen(input: ProjectFolderGateInput): boolean {
  const { hasFolder, forced, dismissed } = input;
  if (hasFolder || forced || !dismissed) return false;
  return projectOnboardingStep(input) === 'project-folder';
}

/**
 * 로그인 창이 닫힐 때 폴더 선택 창을 부르나(`shouldSummonLogin` 의 뒷짝). 로그인 직후 `claudeSetup` 은 옛 스냅샷일 수 있어
 * 순서 판정이 `'pending'` 으로 떨어진다 — 여기선 폴더 유무 하나로 정한다([나중에] 가 있어 잘못 떠도 가두지 않는다).
 */
export function shouldSummonProjectFolder(input: { hasFolder: boolean }): boolean {
  return !input.hasFolder;
}
