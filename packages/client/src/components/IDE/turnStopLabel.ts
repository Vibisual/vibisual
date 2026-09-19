import { isNotableTurnStop } from '@vibisual/shared';
import type { TurnStopReason } from '@vibisual/shared';

/**
 * §5.5 #17-12 ③-6 — 턴이 끝난 이유를 화면 낱말로 바꾸는 순수 모듈.
 *
 * `commandError.ts` 와 같은 규약으로 `t()` 를 부르지 않고 **키만** 돌려준다. 하단 상태바
 * (`StreamStatusBar`)와 명령 말풍선(`CommandBlock`)이 이 함수 하나를 읽어야 두 자리가 같은 낱말을 쓴다.
 */

/** 평범한 끝(`end_turn`)을 뺀 다섯 이유 → 낱말 키. */
const TURN_STOP_LABEL_KEYS: Record<Exclude<TurnStopReason, 'end_turn'>, string> = {
  cancelled: 'ide.turnStop.cancelled',
  usage_limit: 'ide.turnStop.usageLimit',
  max_turns: 'ide.turnStop.maxTurns',
  refusal: 'ide.turnStop.refusal',
  max_tokens: 'ide.turnStop.maxTokens',
};

/**
 * 이 턴이 따로 말할 끝 이유의 낱말 키. 말할 것이 없으면 `null`.
 *
 * - 평범한 끝·값 없음(옛 명령) → `null` — 종전 화면 그대로.
 * - **실패한 턴 → `null`** — 오류 사유(③-1)가 이미 말하므로 한 사건을 두 번 말하지 않는다.
 * - 아직 도는 턴·대기 중인 턴 → `null` — 끝나지 않은 턴에 끝 이유는 없다.
 */
export function turnStopLabelKey(reason: TurnStopReason | undefined, status: string): string | null {
  if (status !== 'completed') return null;
  return isNotableTurnStop(reason) ? TURN_STOP_LABEL_KEYS[reason] : null;
}
