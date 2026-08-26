/**
 * §5.10 v2 (D) — **넛지 빈도 관리.**
 *
 * 넛지 자체는 프롬프트 몇 줄이라 값이 싸지만, **매 턴 붙으면 그게 곧 잡음**이다. 그래서
 * 세션당 간격과 총량 두 축으로 묶는다. 상한은 전부 `constants.ts`(§3.3) 상수다.
 *
 * 상태는 메모리에만 둔다 — 세션이 끝나면 사라져도 되는 값이고(다음 세션은 다시 한 번 찔러도
 * 된다), 디스크에 남기면 영속 4지점을 또 늘리게 된다.
 */
import { BRAIN_NUDGE_MAX_PER_SESSION, BRAIN_NUDGE_MIN_INTERVAL_MS } from '@vibisual/shared';
import { brainAxisEnabledFor } from './brainActivation.js';

interface NudgeState { count: number; lastAt: number }

const bySession = new Map<string, NudgeState>();

/**
 * 이 턴에 넛지를 얹을 때인가. **판정과 기록을 함께 한다** — 물어만 보고 안 적으면
 * 같은 턴에 두 번 물었을 때 두 번 다 통과해 버린다.
 */
export function claimNudgeSlot(root: string | null | undefined, sessionKey: string, now = Date.now()): boolean {
  if (!sessionKey) return false;
  if (!brainAxisEnabledFor(root, 'nudge')) return false;
  const cur = bySession.get(sessionKey);
  if (cur) {
    if (cur.count >= BRAIN_NUDGE_MAX_PER_SESSION) return false;
    if (now - cur.lastAt < BRAIN_NUDGE_MIN_INTERVAL_MS) return false;
    bySession.set(sessionKey, { count: cur.count + 1, lastAt: now });
    return true;
  }
  bySession.set(sessionKey, { count: 1, lastAt: now });
  return true;
}

/** 세션이 사라질 때 정리 — 키 개수가 무한히 늘지 않게(용량 폭증은 값이 아니라 키에서 온다). */
export function forgetNudgeSession(sessionKey: string): void {
  bySession.delete(sessionKey);
}

/** 테스트용 — 전역 상태 초기화. */
export function __resetNudgeStateForTest(): void {
  bySession.clear();
}
