import { createHash } from 'node:crypto';
import {
  CHAT_LOG_AGENT_MAX, CHAT_PAIR_ATTEMPT_MAX, CHAT_PENDING_ACTION_MAX, CHAT_PICK_TOKEN_HEX,
  CHAT_UNPAIRED_NOTICE_MS,
} from '@vibisual/shared';
import type { ChatCard, ChatChannelKind, ChatVerbosity, SessionGoal } from '@vibisual/shared';
import { passesVerbosity } from './cards';

// §4 메신저 원격제어 브리지 — 판정만 모은 곳. `index.ts` 는 electron·fs·net 을 안아 시험에서 import 할 수 없는데, 이 축에서 가장 조용히 틀리는 것이 판정이다
// (끄기가 안 먹힘·안내 무제한·맵 증가·진행률 스팸). 그래서 판정은 부작용 없는 순수 함수로 여기 두고 `index.ts` 는 따르기만 한다 — 전부 policy.test.ts 로 고정.

/** 카드 한 장이 이 peer 로 나갈 수 있는가. */
export interface SendGateInput {
  /** 카드 종류(전송량 정책에 걸리는 축). */
  kind: ChatCard['kind'];
  /** 지금 전송량 정책. */
  verbosity: ChatVerbosity;
  /** 그 peer 가 속한 채널이 켜져 있는가. */
  channelEnabled: boolean;
}

/**
 * **카드가 나가는 유일한 문.** 전송량(`verbosity`)과 채널 on/off 를 함께 본다 — 드라이버 `stop()` 은 수신(long-poll/Gateway)만 끊고 `sendCard` 는 REST 라,
 * on/off 를 안 보면 끈 뒤에도 토큰이 남은 한 권한 요청·작업 신고가 메신저로 계속 흐른다.
 */
export function canSend(input: SendGateInput): boolean {
  if (!input.channelEnabled) return false;
  return passesVerbosity(input.kind, input.verbosity);
}

/** 페어링을 받을 수 있는 대화인가 — 1:1 DM 뿐이다(§4 ④). */
export function canPair(direct: boolean): boolean {
  return direct;
}

/**
 * 화이트리스트 밖 발신자에게 안내를 보내도 되는가. 되면 `true` 를 돌려주고 맵에 적는다(같은 발신자는 `CHAT_UNPAIRED_NOTICE_MS` 동안 다시 못 받는다).
 * 침묵이 원칙이지만 예외 둘(텔레그램 자동 `/start`, 만료된 티켓으로 온 시도)엔 안내한다 — 상한이 없으면 무제한 답장이 되어 봇이 노출되고 rate limit 이 소진된다(429 → 정상 채널도 흔들림).
 */
export function takeNoticeSlot(
  seen: Map<string, number>,
  key: string,
  now: number,
  cooldownMs = CHAT_UNPAIRED_NOTICE_MS,
): boolean {
  const last = seen.get(key);
  if (last !== undefined && now - last < cooldownMs) return false;
  seen.set(key, now);
  // 이 맵도 키 개수가 자란다 — 쿨다운이 지난 것은 그때그때 흘려보낸다.
  for (const [k, at] of seen) {
    if (now - at >= cooldownMs && k !== key) seen.delete(k);
  }
  return true;
}

/**
 * 만료 시각을 가진 맵을 상한 안으로 줄인다 — **만료된 것부터, 그래도 넘치면 가장 이른 것부터.** 키 개수를 안 묶으면 오래 켜 둔 앱에서 계속 자란다
 * (대기 버튼 맵은 권한 요청마다 2건이 들고 폰에서 누를 때만 지워진다).
 */
export function trimExpiring<T extends { expiresAt: number }>(
  map: Map<string, T>,
  now: number,
  max = CHAT_PENDING_ACTION_MAX,
): void {
  for (const [k, v] of map) if (v.expiresAt <= now) map.delete(k);
  if (map.size <= max) return;
  const byExpiry = [...map.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  for (const [k] of byExpiry.slice(0, map.size - max)) map.delete(k);
}

/** 삽입 순서가 곧 오래된 순인 맵을 키 개수 상한으로 줄인다(Map 은 삽입 순서를 지킨다). */
export function trimOldest<T>(map: Map<string, T>, max: number): void {
  if (map.size <= max) return;
  const drop = map.size - max;
  let i = 0;
  for (const k of [...map.keys()]) {
    if (i >= drop) break;
    map.delete(k);
    i += 1;
  }
}

/** `/log` 버퍼 맵 상한 — 값(줄 수)과 짝이 되는 **키 개수** 쪽 상한이다. */
export function trimLogBuffers(map: Map<string, string[]>): void {
  trimOldest(map, CHAT_LOG_AGENT_MAX);
}

/** 페어링 실패 누적 맵 상한 — 밴이 풀린 것부터 흘려보내고, 그래도 넘치면 오래된 것부터. */
export function trimPairAttempts(map: Map<string, { count: number; bannedUntil: number }>, now: number): void {
  for (const [k, v] of map) if (v.bannedUntil !== 0 && v.bannedUntil <= now) map.delete(k);
  trimOldest(map, CHAT_PAIR_ATTEMPT_MAX);
}

/** 목표 카드의 **지문** — 바뀔 때만 카드 한 장이 나간다(스냅샷마다 보내면 진행률이 스팸). 사람이 알아차릴 변화(문장·완료 단계 수·퍼센트·상태)만 넣는다. */
export function goalSignature(goal: SessionGoal): string {
  const steps = goal.steps ?? [];
  const done = steps.filter((s) => s.status === 'done').length;
  return [goal.subAgentId, goal.status, String(goal.percent), `${String(done)}/${String(steps.length)}`, goal.text].join('|');
}

/** 페어링 실패 누적·안내 쿨다운의 키. 전역 잠금이 아니라 발신자별(소유자 lockout 방지). */
export function peerKey(kind: ChatChannelKind, chatId: string): string {
  return `${kind}:${chatId}`;
}

// 3단계 선택 버튼 값. 버튼이 실을 글자엔 바깥 상한이 있다 — 텔레그램 `callback_data` 는 64바이트, 프로젝트 표시명은 폴더 이름이라 길이·문자를 못 정하고
// 한글은 UTF-8 3바이트라 스무 자면 넘친다. 넘치면 텔레그램이 **카드 전체를 거절**해 목록이 아예 안 뜬다(조용히 실패하는 자리라 순수 함수·시험으로 고정).
// 그래서 값은 해시로 접어 보내고 눌렸을 때 **그 시점 목록에서 대조로** 되찾는다 — 사라진 항목은 못 찾고("사라졌다" 안내), 인덱스와 달리 엉뚱한 대상이 골라질 수 없다.

/** 긴 값을 버튼에 실을 수 있는 짧은 토큰으로 접는다. 되돌릴 수 없고, 되찾기는 대조로 한다. */
export function pickToken(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, CHAT_PICK_TOKEN_HEX);
}

/** 선택 버튼 하나의 `actionId`. `<접두사>:<토큰>` — 접두사가 어느 단계인지 말한다. */
export function pickActionId(prefix: string, value: string): string {
  return `${prefix}:${pickToken(value)}`;
}

/**
 * 눌린 버튼이 가리키는 값을 **지금 목록에서** 되찾는다. 없으면 `null`(사라진 항목).
 * 원문도 받는 것은 하위호환 — 옛 `/agents` 카드(`a:<agentId>` 로 agentId 를 그대로 실음)가 폰의 대화 기록에 남아 있다.
 */
export function resolvePick(actionId: string, prefix: string, candidates: readonly string[]): string | null {
  const head = `${prefix}:`;
  if (!actionId.startsWith(head)) return null;
  const token = actionId.slice(head.length);
  if (!token) return null;
  for (const c of candidates) if (c === token || pickToken(c) === token) return c;
  return null;
}
