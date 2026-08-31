/**
 * §4 (첫 실행 온보딩) — **앱을 처음 켠 사람이 지나야 하는 세 칸의 순서**를 정하는 단 한 곳.
 *
 * 순서는 뒤바뀔 수 없다. 앞칸이 안 끝나면 뒷칸은 애초에 할 수 없는 일이기 때문이다:
 *
 *   ① 설치 — `claude` CLI 가 없으면 로그인할 실행본 자체가 없다.
 *   ② 로그인 — 로그인하지 않은 CLI 로는 에이전트를 한 번도 못 돌린다.
 *   ③ 프로젝트 폴더 — 폴더를 고르지 않으면 에이전트가 **어디서** 일할지가 없다.
 *
 * ③ 이 없던 동안 무슨 일이 벌어졌는지가 이 파일이 생긴 이유다: 폴더를 한 번도 고르지 않은
 * 상태에서 캔버스 우클릭 → "커스텀 에이전트" 를 누르면 서버가 `process.cwd()` 를 **임시로**
 * 프로젝트로 등록해 버렸다. Finder 로 띄운 mac 앱의 `process.cwd()` 는 `/` 라, 이름이 빈
 * 프로젝트 탭 하나와 **파일시스템 루트에 매인 에이전트**가 조용히 생겼다. 사용자에게는
 * "폴더를 고른 적도 없는데 빈 것이 생성됐다" 로 보인다.
 *
 * 그래서 판정을 화면 컴포넌트 밖으로 뺐다 — 이 순서는 **클라이언트 게이트 세 개와 서버의
 * 생성 REST 가 모두 같은 답을 봐야** 하는 종류의 사실이다. 한쪽만 알면 화면은 막았는데
 * 서버는 만들어 주는(또는 그 반대) 어긋남이 생긴다.
 */

import type { ClaudeSetupPhase } from './types.js';

/**
 * 지금 사용자를 세워야 할 칸.
 *
 * - `'pending'` = **아직 판정 전**(설치/로그인 상태를 서버가 안 내려줬거나 `unknown`).
 *   어떤 게이트도 스스로 뜨지 않는다 — 모르는 것을 근거로 모달을 띄우면 부팅 때마다
 *   깜빡인다. (사용자가 직접 연 경우(`forced`)는 이 판정과 무관하게 열린다.)
 * - `'install'` · `'login'` · `'project-folder'` = 그 칸의 게이트가 뜰 차례.
 * - `'ready'` = 세 칸 모두 통과 — 온보딩이 끝났다.
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
 * 세 칸 중 지금 어느 칸인가 — **자동으로 뜨는 게이트**의 순서 판정.
 *
 * ⚠ 로그인만 규칙이 하나 더 붙는다: `auth.error` 는 "로그아웃" 이 아니라 **"모름"** 이다
 *   (CLI 미발견 · 타임아웃 · 출력 파싱 실패). §4 v4.82 가 판정 불가로 앱을 막지 않기로
 *   정해 둔 자리라, 여기서도 `'login'` 대신 `'pending'` 으로 떨어뜨린다. 설치를 갓 마친
 *   자리에서만 예외로 로그인을 불러 세우는데, 그 예외는 인계 판정(`shouldSummonLogin`)이
 *   따로 들고 있다 — 순서 판정에 섞으면 두 규칙이 서로를 덮는다.
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
 * 생성 REST 가 "고른 프로젝트 폴더가 없다" 로 거절할 때 쓰는 코드(HTTP 409 본문의 `error`).
 *
 * **화면에서만 막으면 절반만 사실이 된다** — 캔버스 우클릭 말고도 그 REST 를 부르는 길은
 * 있고(모바일 웹·원격조작·바깥 도구), 그 길로 들어오면 종전처럼 `process.cwd()` 에 매인
 * 유령 프로젝트가 다시 생긴다. 서버도 같은 답을 내야 한다.
 */
export const NO_PROJECT_FOLDER_ERROR = 'no-project-folder';

/** 서버가 409 로 돌려준 본문이 "폴더부터 고르라"는 뜻인가 — 클라 생성 손잡이가 공통으로 쓴다. */
export function isNoProjectFolderError(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  return (body as { error?: unknown }).error === NO_PROJECT_FOLDER_ERROR;
}
