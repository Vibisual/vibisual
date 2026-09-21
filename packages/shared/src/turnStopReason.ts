/**
 * **턴이 왜 끝났는가를 한 칸으로** — §5.5 #17-12 ③-6.
 *
 * **왜 필요한가.** 명령 기록에는 `completed`/`error` 두 칸뿐이라, 사용자가 [중지]를 누른 턴도·
 * 모델이 출력 상한에 걸려 말을 끊은 턴도·모델이 거절한 턴도 전부 초록 "끝남"으로 남았다.
 * 그 사실들은 결과 문자열(`[Stopped by user]`)·세션 깃발(`usageLimit`)·오류 코드(`maxTurns`)로
 * 흩어져 있었고, 모델이 스스로 적어 보내는 끝 사유(assistant 줄 `message.stop_reason`)는
 * 아예 읽히지 않았다.
 *
 * **판정은 여기 한 곳에서만.** 턴을 닫는 경로가 여럿이라(persistent·legacy·agent-view·코덱스·로컬)
 * 경로마다 따로 정하면 한쪽만 고쳐지는 날이 온다(`usageLimitStop.ts` 와 같은 규율).
 *
 * **상태를 바꾸지 않는다.** 이 값은 `status`·`error` 곁에 붙는 직교 필드다 — 무엇을 실패로 볼지는
 * 종전 그대로이고, 이 칸은 "왜 멈췄나"만 말한다.
 */

/** 턴이 끝난 이유 — 일곱 가지. 모르면 값을 비운다(짐작해 `end_turn` 을 적지 않는다). */
export type TurnStopReason =
  /** 모델이 할 말을 다 하고 끝냈다. */
  | 'end_turn'
  /** 모델 출력이 토큰 상한에 걸려 잘렸다. */
  | 'max_tokens'
  /** 턴(도구 왕복) 상한에 걸려 우리가 또는 CLI 가 멈췄다. */
  | 'max_turns'
  /** 모델이 응답을 거절했다. */
  | 'refusal'
  /** 사용자가 멈췄다. */
  | 'cancelled'
  /** 요금제 사용 한도에 닿아 멈췄다(§2.4 한도 정지). */
  | 'usage_limit'
  /**
   * **응답이 끊겨 우리가 마감했다** — 끝 신호가 끝내 오지 않았다(§2.4 세션 생존 판정 autoClose).
   *
   * 종전에는 이 마감이 평범한 `completed` 와 한 글자도 다르지 않아, 사용자는 그 턴이 제대로
   * 끝난 것인지 끊긴 것인지 알 길이 없었다. 실패(`status: error`)로 적지 않는 이유는 그 턴이
   * 실제로 일을 마쳤을 수도 있기 때문이다 — 우리가 아는 것은 "끝 신호를 못 받았다" 하나뿐이다.
   */
  | 'disconnected';

export const TURN_STOP_REASONS: readonly TurnStopReason[] = [
  'end_turn', 'max_tokens', 'max_turns', 'refusal', 'cancelled', 'usage_limit', 'disconnected',
];

/** 모델이 적어 보내는 끝 사유 중 **턴의 끝**을 뜻하는 것 — 접은 뒤의 세 낱말. */
export type ModelStopReason = 'end_turn' | 'max_tokens' | 'refusal';

/**
 * 모델·엔진이 쓰는 끝 사유 낱말을 우리 세 낱말로 접는다.
 *
 * - Anthropic: `end_turn`·`stop_sequence` → `end_turn`, `max_tokens`·`model_context_window_exceeded`
 *   → `max_tokens`, `refusal` → `refusal`
 * - OpenAI 호환(로컬 엔진): `stop` → `end_turn`, `length` → `max_tokens`, `content_filter` → `refusal`
 *
 * `tool_use`·`pause_turn`·`tool_calls` 는 **끝이 아니라** 턴이 이어진다는 뜻이라 `undefined`.
 * 모르는 낱말도 `undefined` 다 — 모르는 것을 끝으로 치면 거짓 사유가 남는다.
 */
export function normalizeModelStopReason(raw: unknown): ModelStopReason | undefined {
  if (typeof raw !== 'string') return undefined;
  switch (raw) {
    case 'end_turn':
    case 'stop_sequence':
    case 'stop':
      return 'end_turn';
    case 'max_tokens':
    case 'model_context_window_exceeded':
    case 'length':
      return 'max_tokens';
    case 'refusal':
    case 'content_filter':
      return 'refusal';
    default:
      return undefined;
  }
}

/** Claude 스트림 한 줄에서 읽은 끝 신호. 둘 다 비었으면 이 줄은 끝에 대해 말하지 않았다. */
export interface TurnStopSignal {
  /** assistant 줄 `message.stop_reason`(또는 결과 줄 `stop_reason`)을 접은 값. */
  modelStop?: ModelStopReason;
  /** 결과 줄이 턴 상한으로 끝났다고 신고했는가(`subtype: error_max_turns`). */
  maxTurns?: boolean;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
}

/**
 * Claude CLI stream-json 한 줄(또는 트랜스크립트 JSONL 한 줄)에서 끝 신호를 읽는다.
 * 실측(트랜스크립트): assistant 줄의 `message.stop_reason` 이 `tool_use` / `end_turn` 으로 온다.
 */
export function readTurnStopSignal(line: unknown): TurnStopSignal | undefined {
  const obj = asRecord(line);
  if (!obj) return undefined;
  if (obj['type'] === 'assistant') {
    const modelStop = normalizeModelStopReason(asRecord(obj['message'])?.['stop_reason']);
    return modelStop ? { modelStop } : undefined;
  }
  if (obj['type'] === 'result') {
    const signal: TurnStopSignal = {};
    if (obj['subtype'] === 'error_max_turns') signal.maxTurns = true;
    const modelStop = normalizeModelStopReason(obj['stop_reason']);
    if (modelStop) signal.modelStop = modelStop;
    return signal.maxTurns || signal.modelStop ? signal : undefined;
  }
  return undefined;
}

/** 턴을 닫는 자리가 아는 사실들. */
export interface TurnStopFacts {
  /** 사용자가 멈췄다(`stoppedByUser`). */
  userStopped?: boolean;
  /** 이 턴에 한도 정지를 알아봤다(`sub.usageLimit` — `execute` 가 턴 시작에 비운다). */
  usageLimited?: boolean;
  /** 턴 상한에 걸렸다(우리 킬 · CLI 결과 줄 · 로컬 왕복 상한). */
  maxTurns?: boolean;
  /** 턴 동안 마지막으로 읽은 모델 끝 사유. */
  modelStop?: ModelStopReason;
  /** 턴이 실패로 닫힌다(`status === 'error'`). */
  failed?: boolean;
  /**
   * 끝 신호를 못 받은 채 **우리가** 턴을 닫는다(세션 생존 판정 autoClose · 스트림 정지 워치독).
   * 사용자 중지·한도 정지보다는 약하다 — 그 둘은 왜 멈췄는지를 우리가 **알고** 적는 사유다.
   */
  disconnected?: boolean;
}

/**
 * 사실들로 턴의 끝 이유를 정한다. **앞선 것이 이긴다**:
 * 사용자 중지 > 한도 정지 > 응답 끊김 > 턴 상한 > 모델 거절 > 출력 상한 > 평범한 끝.
 *
 * 응답 끊김이 턴 상한보다 앞선 이유 — 끝 신호를 못 받고 닫은 턴에는 상한 신호가 애초에 올 수 없다.
 * 그 자리에 남아 있는 상한 표식은 **앞 턴의 것**이라, 뒤에 두면 끊긴 턴이 남의 사유를 입는다.
 *
 * 실패로 닫히는데 위 어느 것도 아니면 `undefined` — 그 턴의 이유는 오류 코드가 말한다.
 */
export function resolveTurnStopReason(facts: TurnStopFacts): TurnStopReason | undefined {
  if (facts.userStopped) return 'cancelled';
  if (facts.usageLimited) return 'usage_limit';
  if (facts.disconnected) return 'disconnected';
  if (facts.maxTurns) return 'max_turns';
  if (facts.modelStop === 'refusal') return 'refusal';
  if (facts.modelStop === 'max_tokens') return 'max_tokens';
  if (facts.failed) return undefined;
  return 'end_turn';
}

/** 화면이 따로 말해야 하는 끝인가 — 평범한 끝과 모르는 끝은 조용히 둔다. */
export function isNotableTurnStop(reason: TurnStopReason | undefined): reason is Exclude<TurnStopReason, 'end_turn'> {
  return reason !== undefined && reason !== 'end_turn';
}
