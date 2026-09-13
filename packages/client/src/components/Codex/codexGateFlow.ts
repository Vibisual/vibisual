import type { CodexAuthStatus, CodexSetupState, EngineChoice } from '@vibisual/shared';
import { codexGatesMayAutoOpen } from '../Engine/engineChoiceFlow.js';

/**
 * §5.25 (D)(E) — **코덱스 게이트의 판정만** 모아 둔 곳.
 *
 * `setupGateFlow.ts` 의 코덱스 판이다. 화면에서 떼어 낸 이유도 같다: 이 판정들이 `useEffect`
 * 의존성에 얽히면 "준비 완료" 표시가 스스로를 취소하는 종류의 버그가 나는데, 그런 회귀는
 * 렌더 없이 검사할 수 있어야 다시 잡을 수 있다.
 *
 * **클로드 판정과 다른 축이 하나 있다**: 코덱스는 사용자가 고른 적이 있을 때만 저절로 뜬다.
 * 클로드는 이 앱의 출발점이라 "고른 기록 없음"도 클로드로 읽지만(§5.25 (C) `engineForGating`),
 * 코덱스에 같은 규칙을 쓰면 코덱스를 모르는 사람에게 설치 창이 하나 더 생긴다.
 */

/** 아직 사용자의 손이 필요한 단계인가 — 이 단계에서만 게이트가 저절로 뜬다. */
export function isCodexSetupPending(setup: CodexSetupState | null): boolean {
  if (!setup) return false;
  return setup.phase === 'missing' || setup.phase === 'failed' || setup.phase === 'installing';
}

/** 지금 코덱스 설치 게이트가 화면에 있어야 하는가. */
export function isCodexSetupGateOpen(input: {
  setup: CodexSetupState | null;
  justCompleted: boolean;
  forced: boolean;
  dismissed: boolean;
  engineChoice: EngineChoice | undefined;
}): boolean {
  const { setup, justCompleted, forced, dismissed, engineChoice } = input;
  if (!setup) return false;
  if (justCompleted) return true;
  // 직접 열었으면 엔진 선택과 무관하게 연다 — 코덱스를 "지금부터 준비해 보려는" 사람의 입구다.
  if (forced) return true;
  if (!codexGatesMayAutoOpen(engineChoice)) return false;
  return isCodexSetupPending(setup) && !dismissed;
}

/**
 * 설치 게이트가 닫히는 순간 **로그인 창을 불러야 하는가**.
 *
 * 클로드 쪽과 같은 판단이다: 방금 깐 실행본에 자격증명이 있을 리 없으니 "모름"도 부르는 쪽으로
 * 읽되, **이미 로그인된 것이 확인된 경우**만 예외로 둔다(CLI 만 다시 깐 사람 — 자격증명은
 * 코덱스 홈에 남아 있다). 로그인 창에는 [나중에] 가 있어 잘못 떠도 사용자를 가두지 않는다.
 */
export function shouldSummonCodexLogin(auth: CodexAuthStatus | null | undefined): boolean {
  return auth?.loggedIn !== true;
}

/**
 * 지금 코덱스 로그인 창이 화면에 있어야 하는가.
 *
 * `error` 는 로그아웃이 아니라 **모름**이라 자동으로 뜨지 않는다 — CLI 를 못 찾거나 응답이
 * 없을 때 로그인 창을 세우면 멀쩡히 일하던 사용자를 모달로 막는다. 그 예외는 설치 게이트의
 * 인계 하나뿐이고, 그때는 `forced` 로 들어온다.
 */
export function isCodexLoginGateOpen(input: {
  auth: CodexAuthStatus | null;
  forced: boolean;
  dismissed: boolean;
  engineChoice: EngineChoice | undefined;
}): boolean {
  const { auth, forced, dismissed, engineChoice } = input;
  if (forced) return true;
  if (!codexGatesMayAutoOpen(engineChoice)) return false;
  return auth !== null && !auth.loggedIn && !auth.error && !dismissed;
}
