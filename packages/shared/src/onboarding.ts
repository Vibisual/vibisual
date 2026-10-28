/**
 * §4 첫 실행 온보딩 — 세 칸의 순서를 정하는 단 한 곳: ① 설치(`claude` CLI) ② 로그인 ③ 프로젝트 폴더(앞칸 없이 뒷칸은 불가).
 * 폴더 판정이 없으면 "커스텀 에이전트" 생성 때 서버가 `process.cwd()` 를 프로젝트로 등록한다 — Finder 로 띄운 mac 앱은 `/` 라
 * 이름 빈 탭과 루트에 매인 에이전트가 생긴다. 클라 게이트 셋과 서버 생성 REST 가 같은 답을 봐야 한다.
 */

import type { ClaudeSetupPhase } from './types.js';

/**
 * 지금 세울 칸. `pending` = 판정 전(상태 미수신·`unknown`) — 어떤 게이트도 스스로 뜨지 않는다(모르는 채 띄우면 부팅마다 깜빡인다).
 * 직접 연 경우(`forced`)는 무관하게 열린다. `install`·`login`·`project-folder` = 그 게이트 차례, `ready` = 통과.
 */
export type OnboardingStep = 'pending' | 'install' | 'login' | 'project-folder' | 'ready';

/** `resolveOnboardingStep` 이 보는 것 — 타입 전체가 아니라 **판정에 쓰는 칸만** 받는다. */
export interface OnboardingInput {
  /** `ClaudeSetupState` 의 phase. 서버가 아직 안 내려줬으면 `null`. */
  setupPhase: ClaudeSetupPhase | null | undefined;
  /** `ClaudeAuthStatus`. 서버가 아직 안 내려줬으면 `null`. */
  auth: { loggedIn: boolean; error?: string } | null | undefined;
  /** 사용자가 연 프로젝트 폴더가 **하나라도** 있는가(숨긴 탭·워크트리 제외). */
  hasProjectFolder: boolean;
}

/**
 * 자동으로 뜨는 게이트의 순서 판정. ⚠ `auth.error` 는 로그아웃이 아니라 "모름"(CLI 미발견·타임아웃·파싱 실패)이라 `pending`(§4 — 판정 불가로 막지 않는다).
 * 설치 직후의 로그인 예외는 `shouldSummonLogin` 이 든다 — 여기 섞으면 두 규칙이 서로를 덮는다.
 */
export function resolveOnboardingStep(input: OnboardingInput): OnboardingStep {
  const { setupPhase, auth, hasProjectFolder } = input;

  // ① 설치.
  if (!setupPhase) return 'pending';
  if (setupPhase === 'missing' || setupPhase === 'failed' || setupPhase === 'installing') return 'install';
  if (setupPhase !== 'ready') return 'pending'; // 'unknown' — 판정 전

  // ② 로그인.
  if (!auth) return 'pending';
  if (!auth.loggedIn) return auth.error ? 'pending' : 'login';

  // ③ 프로젝트 폴더.
  if (!hasProjectFolder) return 'project-folder';

  return 'ready';
}

/**
 * 생성 REST 가 "고른 폴더 없음"으로 거절하는 코드(409 본문 `error`). 화면만 막으면 모바일 웹·원격조작·바깥 도구로 들어온 생성이
 * `process.cwd()` 에 매인 유령 프로젝트를 만든다 — 서버도 같은 답을 낸다.
 */
export const NO_PROJECT_FOLDER_ERROR = 'no-project-folder';

/** 서버가 409 로 돌려준 본문이 "폴더부터 고르라"는 뜻인가 — 클라 생성 손잡이가 공통으로 쓴다. */
export function isNoProjectFolderError(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  return (body as { error?: unknown }).error === NO_PROJECT_FOLDER_ERROR;
}
