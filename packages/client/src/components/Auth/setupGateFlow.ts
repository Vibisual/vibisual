import type { ClaudeAuthStatus, ClaudeSetupState, EngineChoice } from '@vibisual/shared';
import { claudeGatesMayAutoOpen } from '../Engine/engineChoiceFlow.js';

/**
 * §4 (첫 실행 설치 온보딩) — 설치 게이트의 판정만(렌더 없이 시험하려고 `ClaudeSetupGate` 에서 뗐다).
 * ⚠ 만료 타이머 효과의 deps 는 `justCompleted` 하나다 — `shouldOpen` 을 넣으면 타이머가 켠 `justCompleted` 가 그걸 뒤집어 cleanup 이 타이머를 지우고,
 * 게이트가 "Continuing…" 에서 멈춘 채 뒤의 로그인 창까지 막는다.
 */

/** 아직 사용자의 손이 필요한 단계인가 — 이 단계에서만 게이트가 저절로 뜬다. */
export function isSetupPending(setup: ClaudeSetupState | null): boolean {
  if (!setup) return false;
  return setup.phase === 'missing' || setup.phase === 'failed' || setup.phase === 'installing';
}

/**
 * 지금 게이트가 떠야 하는가. `justCompleted` = 설치 직후 확인을 보이는 짧은 구간 · `forced` = 배너로 직접 연 경우(닫아 뒀어도 연다) ·
 * 그 밖엔 "준비 안 됨 && [나중에] 로 닫지 않음" 일 때만.
 */
export function isSetupGateOpen(input: {
  setup: ClaudeSetupState | null;
  justCompleted: boolean;
  forced: boolean;
  dismissed: boolean;
  /**
   * §5.25 (C) — 첫 진입에서 고른 엔진(없으면 클로드). 코덱스·로컬을 골랐으면 저절로 뜨지 않는다(방금 고른 것을 무시하게 된다).
   * 배너·옵션창으로 열면 `forced` 라 이 판정을 안 탄다.
   */
  engineChoice?: EngineChoice | undefined;
}): boolean {
  const { setup, justCompleted, forced, dismissed, engineChoice } = input;
  if (!setup) return false;
  if (justCompleted) return true;
  if (forced) return true;
  if (!claudeGatesMayAutoOpen(engineChoice)) return false;
  return isSetupPending(setup) && !dismissed;
}

/**
 * 게이트가 닫힐 때 로그인 창을 부르나(§4 설치 → 로그인 자동 연결). 설치 전 `claude auth status` 가 `error: 'cli-missing'` 으로 캐시되고
 * 로그인 창은 `error` 면 안 뜨므로, 여기선 "모름"도 부른다(방금 깐 실행본엔 자격증명이 없다 · [나중에] 가 있다).
 * 로그인이 확인됐으면 부르지 않는다(CLI 만 다시 깐 경우 — 자격증명은 `~/.claude` 에 남는다).
 */
export function shouldSummonLogin(auth: ClaudeAuthStatus | null | undefined): boolean {
  return auth?.loggedIn !== true;
}
