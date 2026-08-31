import type { ClaudeAuthStatus, ClaudeSetupState } from '@vibisual/shared';

/**
 * §4 (첫 실행 설치 온보딩) — 설치 게이트의 **판정만** 모아 둔 곳.
 *
 * 화면(`ClaudeSetupGate`)에서 떼어낸 이유는 하나다: 이 판정들이 컴포넌트 안 `useEffect` 의
 * 의존성 배열에 얽혀 있던 탓에 **완료 표시가 스스로를 취소하는** 버그가 났고(아래 참고),
 * 그런 종류의 회귀는 렌더링 없이 검사할 수 있어야 다시 잡을 수 있기 때문이다.
 *
 * ⚠ 그때의 버그: "준비 완료" 유지 타이머를 건 효과의 deps 에 `shouldOpen` 이 들어 있었다.
 *   타이머가 켠 `justCompleted` 가 곧바로 `shouldOpen` 을 뒤집어 같은 효과를 다시 태우고,
 *   그 정리(cleanup)가 방금 건 타이머를 지웠다 → 게이트가 "Claude Code is ready. Continuing…"
 *   에서 영원히 멈추고, 그 위 오버레이가 뒤의 로그인 창까지 눌러 앉아 아무것도 눌리지 않았다.
 *   그래서 지금은 **만료 타이머의 deps 를 `justCompleted` 하나로** 두고, 판정은 여기서 한다.
 */

/** 아직 사용자의 손이 필요한 단계인가 — 이 단계에서만 게이트가 저절로 뜬다. */
export function isSetupPending(setup: ClaudeSetupState | null): boolean {
  if (!setup) return false;
  return setup.phase === 'missing' || setup.phase === 'failed' || setup.phase === 'installing';
}

/**
 * 지금 게이트가 화면에 있어야 하는가.
 *  - `justCompleted` = 방금 설치가 끝나 확인을 보여 주는 짧은 구간(닫히는 중).
 *  - `forced` = 상단 배너를 눌러 사용자가 직접 연 경우(닫아 뒀어도 다시 연다).
 *  - 그 밖에는 "아직 준비 안 됨 && 사용자가 나중에로 닫지 않음" 일 때만.
 */
export function isSetupGateOpen(input: {
  setup: ClaudeSetupState | null;
  justCompleted: boolean;
  forced: boolean;
  dismissed: boolean;
}): boolean {
  const { setup, justCompleted, forced, dismissed } = input;
  if (!setup) return false;
  if (justCompleted) return true;
  if (forced) return true;
  return isSetupPending(setup) && !dismissed;
}

/**
 * 게이트가 닫히는 순간 **로그인 창을 불러야 하는가**.
 *
 * SSOT §4 는 "설치 성공 → 재판정 → 로그인 단계로 자동 연결" 을 못박는데, 그 연결을 `LoginWindow`
 * 의 자동 조건에만 맡기면 갓 설치한 사용자에게서 끊긴다 — 설치 전에 돌았던 `claude auth status`
 * 는 실행본이 없어 `error: 'cli-missing'` 으로 캐시되고, 로그인 창은 `error`(=판정 불가)면
 * **일부러 뜨지 않기** 때문이다(§4 v4.82). 그래서 설치를 막 끝낸 이 자리에서만은 "모름" 도
 * 부르는 쪽으로 판정한다: 방금 깐 실행본에 자격증명이 있을 리 없고, 로그인 창에는 [나중에] 가
 * 있어 잘못 떠도 사용자를 가두지 않는다.
 *
 * 유일한 예외는 **이미 로그인된 것이 확인된 경우**(CLI 만 다시 깐 사람 — 자격증명은 `~/.claude`
 * 에 남아 있다). 그때 창을 띄우면 다 끝난 사람에게 로그인을 다시 시키는 꼴이 된다.
 */
export function shouldSummonLogin(auth: ClaudeAuthStatus | null | undefined): boolean {
  return auth?.loggedIn !== true;
}
