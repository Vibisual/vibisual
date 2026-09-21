import { isNotableTurnStop } from '@vibisual/shared';
import type { TurnStopReason } from '@vibisual/shared';

/**
 * §5.5 #17-12 ③-6 — 턴이 끝난 이유를 화면 낱말로 바꾸는 순수 모듈.
 *
 * `commandError.ts` 와 같은 규약으로 `t()` 를 부르지 않고 **키만** 돌려준다. 하단 상태바
 * (`StreamStatusBar`)와 명령 말풍선(`CommandBlock`)이 이 함수 하나를 읽어야 두 자리가 같은 낱말을 쓴다.
 */

/**
 * 평범한 끝(`end_turn`)을 뺀 이유들 → 낱말 키.
 *
 * **Partial 인 이유.** 종전에는 `Record<Exclude<TurnStopReason,'end_turn'>, string>` 이라
 * 서버가 사유 한 칸을 늘리는 순간 **클라 타입체크가 깨졌다.** 사유는 서버가 발행하는 값이라
 * 앞으로도 늘어난다 — 화면은 모르는 사유를 만나도 부러지지 말고 "끊김"이라는 일반 낱말로
 * 물러설 수 있어야 한다(모르는 것을 초록 "끝남"으로 세탁하는 것이 이 버그의 뿌리였다).
 */
const TURN_STOP_LABEL_KEYS: Partial<Record<TurnStopReason, string>> = {
  cancelled: 'ide.turnStop.cancelled',
  usage_limit: 'ide.turnStop.usageLimit',
  max_turns: 'ide.turnStop.maxTurns',
  refusal: 'ide.turnStop.refusal',
  max_tokens: 'ide.turnStop.maxTokens',
  // §2.4 — 끝 신호가 끝내 오지 않아 서버가 마감한 턴. 초록 "끝남"으로 그리면 사용자는 그 턴이
  //   제대로 끝난 줄 안다(사용자 보고의 핵심 증상).
  disconnected: 'ide.turnStop.disconnected',
};

/** 아직 낱말을 못 붙인 **새 사유**가 왔을 때의 자리 — 말없이 "끝남"으로 내려앉지 않게 한다. */
const TURN_STOP_FALLBACK_KEY = 'ide.turnStop.interrupted';

/**
 * 이 턴이 따로 말할 끝 이유의 낱말 키. 말할 것이 없으면 `null`.
 *
 * - 평범한 끝·값 없음(옛 명령) → `null` — 종전 화면 그대로.
 * - **실패한 턴 → `null`** — 오류 사유(③-1)가 이미 말하므로 한 사건을 두 번 말하지 않는다.
 * - 아직 도는 턴·대기 중인 턴 → `null` — 끝나지 않은 턴에 끝 이유는 없다.
 */
export function turnStopLabelKey(reason: TurnStopReason | undefined, status: string): string | null {
  if (status !== 'completed') return null;
  if (!isNotableTurnStop(reason)) return null;
  return TURN_STOP_LABEL_KEYS[reason] ?? TURN_STOP_FALLBACK_KEY;
}
