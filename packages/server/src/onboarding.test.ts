import { describe, expect, it } from 'vitest';
import {
  NO_PROJECT_FOLDER_ERROR,
  isNoProjectFolderError,
  resolveOnboardingStep,
  type OnboardingInput,
} from '@vibisual/shared';

/**
 * §4 (첫 실행 온보딩) — ①설치 → ②로그인 → ③프로젝트 폴더 **순서**를 고정한다.
 *
 * 이 순서가 깨졌을 때 실제로 일어난 일이 회귀의 기준이다: ③ 이 없어서, 폴더를 한 번도 고르지
 * 않은 사용자가 캔버스에서 커스텀 에이전트를 만들면 서버가 `process.cwd()`(Finder 로 띄운 mac
 * 앱에서는 `/`)를 프로젝트로 임시 등록해 **이름이 빈 탭 + 파일시스템 루트에 매인 에이전트**가
 * 조용히 생겼다.
 */

const ready = (over: Partial<OnboardingInput> = {}): OnboardingInput => ({
  setupPhase: 'ready',
  auth: { loggedIn: true },
  hasProjectFolder: true,
  ...over,
});

describe('resolveOnboardingStep — 세 칸의 순서', () => {
  it('설치가 안 됐으면 뒤 칸을 건너뛰고 설치부터', () => {
    // 로그인도 안 됐고 폴더도 없지만, 앞칸이 먼저다.
    expect(resolveOnboardingStep({ setupPhase: 'missing', auth: null, hasProjectFolder: false })).toBe('install');
    expect(resolveOnboardingStep({ setupPhase: 'failed', auth: { loggedIn: false }, hasProjectFolder: false })).toBe('install');
    // 설치가 도는 동안에도 그 창이 주인이다(다른 게이트가 끼어들면 위에 겹쳐 뜬다).
    expect(resolveOnboardingStep({ setupPhase: 'installing', auth: null, hasProjectFolder: false })).toBe('install');
  });

  it('설치가 끝나면 로그인, 로그인까지 끝나면 폴더', () => {
    expect(resolveOnboardingStep(ready({ auth: { loggedIn: false }, hasProjectFolder: false }))).toBe('login');
    expect(resolveOnboardingStep(ready({ hasProjectFolder: false }))).toBe('project-folder');
    expect(resolveOnboardingStep(ready())).toBe('ready');
  });

  it('판정 전(null·unknown)에는 어떤 게이트도 스스로 뜨지 않는다', () => {
    // 부팅 직후 — 서버가 아직 아무것도 안 내려줬다.
    expect(resolveOnboardingStep({ setupPhase: null, auth: null, hasProjectFolder: false })).toBe('pending');
    expect(resolveOnboardingStep({ setupPhase: 'unknown', auth: null, hasProjectFolder: false })).toBe('pending');
    // 설치는 끝났는데 로그인 상태가 아직 안 왔다 — 폴더 게이트가 먼저 튀어나오면 안 된다.
    expect(resolveOnboardingStep(ready({ auth: null, hasProjectFolder: false }))).toBe('pending');
  });

  it('로그인 error 는 "로그아웃"이 아니라 "모름" — 모달로 앱을 막지 않는다(§4 v4.82)', () => {
    expect(resolveOnboardingStep(ready({ auth: { loggedIn: false, error: 'cli-missing' } }))).toBe('pending');
    expect(resolveOnboardingStep(ready({ auth: { loggedIn: false, error: 'timeout' }, hasProjectFolder: false }))).toBe('pending');
  });

  it('폴더가 있으면 로그인 판정이 "모름"이어도 끝난 것으로 보지 않는다', () => {
    // "모름"은 앞칸이 아직 안 끝났다는 뜻이지 통과가 아니다 — 그대로 pending 에 머문다.
    expect(resolveOnboardingStep(ready({ auth: { loggedIn: false, error: 'parse' } }))).toBe('pending');
  });
});

describe('isNoProjectFolderError — 서버 409 를 클라가 알아본다', () => {
  it('그 코드일 때만 참', () => {
    expect(isNoProjectFolderError({ error: NO_PROJECT_FOLDER_ERROR })).toBe(true);
    expect(isNoProjectFolderError({ error: 'Internal server error' })).toBe(false);
    expect(isNoProjectFolderError({})).toBe(false);
    expect(isNoProjectFolderError(null)).toBe(false);
    expect(isNoProjectFolderError('no-project-folder')).toBe(false);
  });
});
