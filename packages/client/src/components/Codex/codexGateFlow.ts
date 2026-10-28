import type { CodexAuthStatus, CodexSetupState, EngineChoice } from '@vibisual/shared';
import { codexGatesMayAutoOpen } from '../Engine/engineChoiceFlow.js';

/**
 * §5.25 (D)(E) — 코덱스 게이트 판정만 모은 곳(`setupGateFlow.ts` 의 코덱스 판) — `useEffect` 에 얽히면 "준비 완료"가 스스로를 취소해 렌더 없이 검사한다.
 * 클로드와 달리 "고른 기록 없음"을 코덱스로 읽지 않는다(§5.25 (C)).
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

/** 갓 깐 실행본엔 자격증명이 없으니 "모름"도 부른다. 로그인이 확인된 경우만 예외(CLI 만 다시 깔면 자격증명이 남는다). */
export function shouldSummonCodexLogin(auth: CodexAuthStatus | null | undefined): boolean {
  return auth?.loggedIn !== true;
}

/** `error` 는 로그아웃이 아니라 **모름**이라 자동으로 뜨지 않는다 — 일하던 사용자를 모달로 막는다. 예외는 설치 게이트 인계(`forced`). */
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
