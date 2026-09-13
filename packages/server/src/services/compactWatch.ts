// SCENARIO.md §5.26 (F) — 자동압축 미발동 감시.
//
// **CLI 안에서는 이 판정 자체가 불가능하다.** Claude Code 는 컨텍스트 토큰 수를 훅에 주지 않아
// (anthropics/claude-code#44790) 세션 안에서는 "지금 몇 % 찼는지"를 알 길이 없다. 우리는 §5.5
// 상태바가 쓰는 증분 스캐너로 그 수를 이미 재고 있으므로, 밖에서 보면 판정이 선다.
//
// **증거만 본다 — 모델을 부르지 않는다.** §2.4 세션 생존 판정이 모델을 쓰는 이유는 "무엇을
// 기다리는가"가 기록의 *뜻*을 읽어야 나오기 때문인데, 여기서 묻는 것은 숫자 셋의 대소 관계뿐이다.
//
// 순수 함수인 이유: 시각·비율·임계를 전부 인자로 받아야 한 대의 개발기에서 모든 갈래를 시험할 수
// 있다. `Date.now()` 를 안에서 읽으면 "3분 뒤" 를 시험할 방법이 사라진다.

import type { CompactWatchLevel, CompactWatchState } from '@vibisual/shared';
import {
  INSURANCE_COMPACT_SEND_TIMEOUT_MS,
  INSURANCE_OVERDUE_GROWTH_BYTES,
  INSURANCE_OVERDUE_MS,
  INSURANCE_OVERDUE_RATIO,
  INSURANCE_STALL_RATIO,
} from '@vibisual/shared';

/** 판정이 세션 하나에 대해 알아야 하는 전부 — 그래프 구현을 통째로 물지 않는다. */
export interface CompactWatchInput {
  sessionId: string;
  subAgentId?: string;
  agentId?: string;
  /** 마지막 턴 하나의 입력 크기(§5.5 정의 — 누적이 아니다). */
  contextUsed?: number;
  /** 그 모델의 창 크기. `stalled`(CLI 가 곧 멈춘다)의 분모. */
  contextMax?: number;
  /**
   * §5.26 (F)(a) — **접기로 한 선**(= `autoCompactThresholdTokens` 의 답). `overdue` 의 분모다.
   *
   * 모델 창과 같은 수가 아니다 — 1M 창에 자동압축 400k 를 걸어 둔 세션에서 322k 는 창 대비 32%
   * 라 `overdue` 에 못 미치지만, 사용자가 정한 선으로 재면 81% 다. 없으면(끔·판정 불가) 창으로
   * 되돌아간다 — 그때는 종전과 같은 값이다.
   */
  autoCompactTokens?: number;
  /**
   * §5.26 (F)(b) — 우리가 이 세션에 `/compact` 를 마지막으로 **보낸** 시각.
   *
   * 도착(`lastCompactAt`)과 짝을 이룬다: 보냈는데 그 뒤로 도착이 없으면 명령이 실행되지 않은 것이다.
   */
  compactSentAt?: number;
  /** 마지막 `PreCompact` 시각. 압축이 한 번도 없었으면 세션이 처음 움직인 시각. */
  lastCompactAt?: number;
  /** 그 시각 이후 트랜스크립트가 자란 바이트 — "아직 일하는 중"의 유일한 관측 사실. */
  grownBytes?: number;
  /** 우리가 프롬프트를 보낼 수 있는 세션인가(= [압축 보내기] 손잡이를 그릴지). */
  canSendCompact: boolean;
  /**
   * 사용자가 이 세션의 자동압축을 **껐는가**.
   *
   * 껐으면 `overdue` 를 띄우지 않는다 — 끈 것을 고장으로 신고하면 늑대소년이 되고,
   * 정작 진짜로 안 도는 세션(#66144)에서 아무도 안 본다. `stalled`(창이 거의 다 참)는
   * 끄고 켜고와 무관한 사실이라 그대로 띄운다.
   */
  autoCompactOff: boolean;
  /** 지금 실제로 돌고 있는가. 멈춰 선 세션은 벽으로 가고 있지 않다. */
  running: boolean;
}

/** 임계를 밖에서 갈아 끼울 수 있게 — 시험이 경계값을 직접 찍는다. */
export interface CompactWatchThresholds {
  overdueRatio: number;
  stallRatio: number;
  overdueMs: number;
  growthBytes: number;
  /** §5.26 (F)(b) — 보낸 뒤 `PreCompact` 를 이만큼 기다렸는데 안 오면 `rejected`. */
  sendTimeoutMs: number;
}

export const DEFAULT_COMPACT_WATCH_THRESHOLDS: CompactWatchThresholds = {
  overdueRatio: INSURANCE_OVERDUE_RATIO,
  stallRatio: INSURANCE_STALL_RATIO,
  overdueMs: INSURANCE_OVERDUE_MS,
  growthBytes: INSURANCE_OVERDUE_GROWTH_BYTES,
  sendTimeoutMs: INSURANCE_COMPACT_SEND_TIMEOUT_MS,
};

/**
 * 세션 하나의 감시 판정.
 *
 * 판정 순서가 곧 규율이다.
 *  ① 비율을 못 재면 **아무 말도 하지 않는다**(`ok`) — 모르는 것을 고장으로 읽지 않는다.
 *  ② `stalled` 가 나머지를 이긴다 — 창이 거의 다 찼다는 것은 압축 설정과 무관한 사실이다.
 *  ③ `rejected` 가 `overdue` 를 이긴다 — 예측보다 **이미 일어난 실패**가 먼저다((F)(b)).
 *  ④ `overdue` 는 셋이 **동시에** 참일 때만이다(꽉 찼다 · 아직 자란다 · 압축이 안 왔다).
 */
export function judgeCompactWatch(
  input: CompactWatchInput,
  now: number,
  thresholds: CompactWatchThresholds = DEFAULT_COMPACT_WATCH_THRESHOLDS,
): CompactWatchState {
  const base: CompactWatchState = {
    sessionId: input.sessionId,
    level: 'ok',
    canSendCompact: input.canSendCompact,
  };
  if (input.subAgentId) base.subAgentId = input.subAgentId;
  if (input.agentId) base.agentId = input.agentId;

  // 창 대비 — `stalled` 전용. CLI 가 스스로 멈추는 자리는 우리가 정한 선과 무관하다.
  const windowRatio = safeRatio(input.contextUsed, input.contextMax);
  if (windowRatio === undefined) return base; // ① 모르면 말하지 않는다
  // §5.26 (F)(a) — `overdue` 의 분모는 **접기로 한 선**이다. 없으면 창으로 되돌아간다(종전 값).
  const ratio = safeRatio(input.contextUsed, input.autoCompactTokens) ?? windowRatio;
  base.ratio = ratio;

  const sinceCompactMs = input.lastCompactAt !== undefined && Number.isFinite(input.lastCompactAt)
    ? Math.max(0, now - input.lastCompactAt)
    : undefined;
  if (sinceCompactMs !== undefined) base.sinceCompactMs = sinceCompactMs;
  const grown = Number.isFinite(input.grownBytes) ? Math.max(0, input.grownBytes as number) : 0;
  base.grownBytes = grown;

  // ② 창이 거의 다 찼다 — 자동압축을 껐든 켰든 이건 사실이다.
  if (windowRatio >= thresholds.stallRatio) {
    base.level = 'stalled';
    return base;
  }

  // ③ 보냈는데 안 왔다 — §5.26 (F)(b). 비율·성장·나이를 묻지 않는다(이미 일어난 실패다).
  //   자동압축을 끈 세션에서도 판정한다: [압축 보내기] 손잡이로 손수 보낸 것이 거절될 수 있고,
  //   그것은 사용자가 방금 누른 버튼이 안 먹었다는 뜻이라 반드시 말해야 한다.
  const sentAt = input.compactSentAt;
  if (sentAt !== undefined && Number.isFinite(sentAt)) {
    const sinceSentMs = Math.max(0, now - sentAt);
    // 보낸 뒤에 도착한 `PreCompact` 가 있으면 그 명령은 실제로 돈 것이다.
    const arrived = input.lastCompactAt !== undefined
      && Number.isFinite(input.lastCompactAt)
      && (input.lastCompactAt as number) >= sentAt;
    if (!arrived) {
      base.sinceSentMs = sinceSentMs;
      if (sinceSentMs >= thresholds.sendTimeoutMs) {
        base.level = 'rejected';
        return base;
      }
      // 아직 기다리는 중 — 이 턴에는 `overdue` 도 띄우지 않는다. 방금 보낸 압축이
      //   도착하기 전에 "압축이 안 온다"고 적으면 우리가 우리 명령을 고장으로 신고하는 꼴이다.
      return base;
    }
  }

  // ④ 셋이 동시에 참일 때만.
  if (input.autoCompactOff) return base;
  if (!input.running) return base;
  if (ratio < thresholds.overdueRatio) return base;
  if (grown < thresholds.growthBytes) return base;
  // ⚠ **압축을 한 번도 안 한 세션이 이 기능의 머리 사례다.** 종전에는 `lastCompactAt` 이 없으면
  //   여기서 `ok` 로 떨어졌는데, 그러면 "창이 95% 인데 압축이 **아예** 안 돈다"는 바로 그 상황에서
  //   경고가 영영 안 나온다(마커가 없다는 것이 곧 그 증거인데도). 없으면 "무한히 오래됐다"로 읽는다 —
  //   나머지 둘(비율·성장)이 함께 참일 때만 여기까지 오므로 거짓 경보가 되지 않는다.
  if (sinceCompactMs !== undefined && sinceCompactMs < thresholds.overdueMs) return base;

  base.level = 'overdue';
  return base;
}

/** 여러 세션을 한 번에 — `ok` 는 전선에 싣지 않는다(화면이 그릴 것이 없다). */
export function judgeAll(
  inputs: readonly CompactWatchInput[],
  now: number,
  thresholds: CompactWatchThresholds = DEFAULT_COMPACT_WATCH_THRESHOLDS,
): CompactWatchState[] {
  const out: CompactWatchState[] = [];
  for (const input of inputs) {
    const state = judgeCompactWatch(input, now, thresholds);
    if (state.level !== 'ok') out.push(state);
  }
  return out;
}

/**
 * 표시 서열 — 한 화면에 여럿이 걸리면 더 나쁜 것이 위로.
 *
 * `rejected` 가 `overdue` 위인 이유: 후자는 "곧 벽이다"라는 예측이고 전자는 **이미 안 된 것**이라,
 * 사용자가 지금 손대야 하는 쪽이다(§5.26 (F)(b)). `stalled` 는 CLI 가 곧 멈추는 자리라 그 위다.
 */
export function compactWatchRank(level: CompactWatchLevel): number {
  return level === 'stalled' ? 3 : level === 'rejected' ? 2 : level === 'overdue' ? 1 : 0;
}

/**
 * 0 으로 나누기·음수·비유한값을 전부 여기서 막는다.
 * 1 을 넘겨 받는 일이 실제로 있다(창 크기를 모르는 모델에 폴백 창을 물렸을 때) — 잘라서 쓴다.
 */
function safeRatio(used?: number, max?: number): number | undefined {
  if (!Number.isFinite(used) || !Number.isFinite(max)) return undefined;
  const u = used as number;
  const m = max as number;
  if (m <= 0 || u < 0) return undefined;
  return Math.min(1, u / m);
}
