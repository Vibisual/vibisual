import { isNotableTurnStop } from '@vibisual/shared';
import type { TurnStopReason } from '@vibisual/shared';

/** §5.5 #17-12 ③-6 — 턴이 끝난 이유 → 낱말 **키**(`t()` 는 부르지 않는다). 하단 상태바와 스트림 멈춤 한 줄이 이 함수 하나로 같은 낱말을 쓴다. */

/**
 * `end_turn` 을 뺀 이유들 → 낱말 키. **Partial 이다** — 사유는 서버가 늘려 가는 값이라 전수 `Record` 면 클라 타입체크가 깨진다.
 * 모르는 사유는 "끊김"으로 물러선다(초록 "끝남"으로 세탁하지 않는다).
 */
const TURN_STOP_LABEL_KEYS: Partial<Record<TurnStopReason, string>> = {
  cancelled: 'ide.turnStop.cancelled',
  usage_limit: 'ide.turnStop.usageLimit',
  max_turns: 'ide.turnStop.maxTurns',
  refusal: 'ide.turnStop.refusal',
  max_tokens: 'ide.turnStop.maxTokens',
  // §2.4 — 끝 신호가 오지 않아 서버가 마감한 턴(초록 "끝남"이면 제대로 끝난 줄 안다).
  disconnected: 'ide.turnStop.disconnected',
};

/** 아직 낱말을 못 붙인 **새 사유**가 왔을 때의 자리 — 말없이 "끝남"으로 내려앉지 않게 한다. */
const TURN_STOP_FALLBACK_KEY = 'ide.turnStop.interrupted';

/** 따로 말할 끝 이유의 낱말 키. 평범한 끝·값 없음 · **실패한 턴**(오류 사유가 이미 말한다) · 아직 돌거나 대기 중인 턴이면 `null`. */
export function turnStopLabelKey(reason: TurnStopReason | undefined, status: string): string | null {
  if (status !== 'completed') return null;
  if (!isNotableTurnStop(reason)) return null;
  return TURN_STOP_LABEL_KEYS[reason] ?? TURN_STOP_FALLBACK_KEY;
}
